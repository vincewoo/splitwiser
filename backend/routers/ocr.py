"""OCR router: Receipt scanning and text detection endpoints."""

from typing import Annotated
import os
import re
import shutil
import uuid
import io
from PIL import Image
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Body
from sqlalchemy.orm import Session
from google.api_core import exceptions as google_exceptions

import models
import schemas
from database import get_db
from dependencies import get_current_user
from ocr.service import ocr_service
from ocr.parser import parse_receipt_items
from utils.rate_limiter import ocr_rate_limiter


# Receipt directory path
DATA_DIR = os.getenv("DATA_DIR", "data")
RECEIPT_DIR = os.path.join(DATA_DIR, "receipts")


# In-memory cache for OCR responses with TTL
class OCRCache:
    def __init__(self, ttl_seconds: int = 300):  # 5 minutes default TTL
        self.cache = {}
        self.ttl_seconds = ttl_seconds

    def set(self, key: str, value: dict):
        """Store OCR response with expiry timestamp."""
        self.cache[key] = {
            "data": value,
            "expires_at": datetime.utcnow() + timedelta(seconds=self.ttl_seconds)
        }

    def get(self, key: str):
        """Retrieve OCR response if not expired."""
        if key not in self.cache:
            return None

        entry = self.cache[key]
        if datetime.utcnow() > entry["expires_at"]:
            del self.cache[key]
            return None

        return entry["data"]

    def cleanup_expired(self):
        """Remove expired entries from cache."""
        now = datetime.utcnow()
        expired_keys = [
            key for key, entry in self.cache.items()
            if now > entry["expires_at"]
        ]
        for key in expired_keys:
            del self.cache[key]


# Global cache instance
ocr_cache = OCRCache()


router = APIRouter(tags=["ocr"])


@router.post("/ocr/scan-receipt", dependencies=[Depends(ocr_rate_limiter)])
async def scan_receipt(
    file: UploadFile = File(...),
    current_user: Annotated[models.User, Depends(get_current_user)] = None
):
    """
    OCR endpoint for receipt scanning using Google Cloud Vision.
    Accepts image upload, returns extracted items with prices AND saves the image locally.

    Args:
        file: Uploaded image file (JPEG, PNG, WebP)
        current_user: Authenticated user (from JWT token)

    Returns:
        JSON with items, total, raw OCR text, and receipt_image_path
    """
    try:
        # Read image file for OCR and validation
        image_content = await file.read()

        # Validate file size (10MB max)
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
        if len(image_content) > MAX_FILE_SIZE:
             raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of 10MB. Uploaded file size: {len(image_content) / (1024 * 1024):.2f}MB"
            )

        # Validate image content using PIL
        try:
            image = Image.open(io.BytesIO(image_content))
            img_format = image.format
            image.verify()  # Check for corruption/invalid format

            # Determine extension from detected format
            format_to_ext = {
                "JPEG": "jpg",
                "PNG": "png",
                "WEBP": "webp"
            }

            if img_format not in format_to_ext:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported image format: {img_format}. Only JPEG, PNG, and WebP are supported."
                )

            file_ext = format_to_ext[img_format]

        except HTTPException:
            raise
        except Exception as e:
            print(f"Image validation failed: {e}")
            raise HTTPException(
                status_code=400,
                detail="Invalid image file."
            )

        # Ensure receipts directory exists
        os.makedirs(RECEIPT_DIR, exist_ok=True)

        # Generate unique filename with SAFE extension
        filename = f"{uuid.uuid4()}.{file_ext}"
        file_path = os.path.join(RECEIPT_DIR, filename)

        # Save file locally
        with open(file_path, "wb") as buffer:
            buffer.write(image_content)
        print(f"Starting receipt scan... Image size: {len(image_content)} bytes")

        # OCR processing
        print("Calling Vision API...")
        vision_response = ocr_service.extract_text(image_content)
        print("Vision API response received")

        # Log response stats
        if vision_response.text_annotations:
            print(f"Number of text annotations: {len(vision_response.text_annotations)}")
            full_text = vision_response.text_annotations[0].description
            print(f"Raw text length: {len(full_text)}")
            print(f"First 100 chars of raw text: {full_text[:100]}...")
            raw_text = full_text
        else:
            print("No text annotations found in response")
            raw_text = ""

        # Parse items
        items = parse_receipt_items(vision_response)
        print(f"Parsed items count: {len(items)}")
        for item in items:
            print(f" - Found item: {item}")

        # Calculate total
        total = sum(item['price'] for item in items)
        print(f"Calculated total from items: {total}")

        return {
            "items": items,
            "total": total,
            "raw_text": raw_text,
            "receipt_image_path": f"/static/receipts/{filename}"
        }

    except HTTPException:
        raise
    except google_exceptions.ServiceUnavailable:
        raise HTTPException(
            status_code=503,
            detail="OCR service is temporarily unavailable, please try again later."
        )
    except google_exceptions.RetryError:
        raise HTTPException(
            status_code=503,
            detail="OCR service request timed out, please try again later."
        )
    except Exception as e:
        print(f"OCR processing error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"OCR processing failed: {str(e)}"
        )


@router.post("/ocr/detect-regions", dependencies=[Depends(ocr_rate_limiter)])
async def detect_regions(
    file: UploadFile = File(...),
    current_user: Annotated[models.User, Depends(get_current_user)] = None
):
    """
    OCR endpoint for detecting text regions/bounding boxes using Google Cloud Vision.
    Groups words into line-level regions for better usability.

    Args:
        file: Uploaded image file (JPEG, PNG, WebP)
        current_user: Authenticated user (from JWT token)

    Returns:
        JSON with regions array (normalized coordinates), cache_key for later use, and image_size
    """
    # Validate file type
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and WebP images are supported."
        )

    try:
        # Read image file for OCR
        image_content = await file.read()
        print(f"Starting region detection... Image size: {len(image_content)} bytes")

        # Validate file size (10MB max)
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes
        if len(image_content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of 10MB. Uploaded file size: {len(image_content) / (1024 * 1024):.2f}MB"
            )

        # OCR processing with DOCUMENT_TEXT_DETECTION
        print("Calling Vision API for document text detection...")
        vision_response = ocr_service.detect_document_text(image_content)
        print("Vision API response received")

        # Extract image dimensions from response
        image_width = 0
        image_height = 0
        if vision_response.full_text_annotation and vision_response.full_text_annotation.pages:
            page = vision_response.full_text_annotation.pages[0]
            image_width = page.width
            image_height = page.height
            print(f"Image dimensions: {image_width}x{image_height}")

        # Group text annotations into lines
        regions = []
        if vision_response.text_annotations and len(vision_response.text_annotations) > 1:
            # Skip first annotation (full text)
            word_annotations = vision_response.text_annotations[1:]

            # Group words by Y-coordinate (words on the same line)
            lines = {}
            # Use a smaller threshold for better line separation (0.5% of image height)
            line_height_threshold = image_height * 0.005 if image_height > 0 else 5

            for annotation in word_annotations:
                if not annotation.bounding_poly or not annotation.bounding_poly.vertices:
                    continue

                vertices = annotation.bounding_poly.vertices
                y_coords = [v.y for v in vertices]
                center_y = sum(y_coords) / len(y_coords)

                # Find which line this word belongs to
                assigned_line = None
                for line_y in lines.keys():
                    if abs(center_y - line_y) < line_height_threshold:
                        assigned_line = line_y
                        break

                # Create new line or add to existing
                if assigned_line is None:
                    lines[center_y] = []
                    assigned_line = center_y

                lines[assigned_line].append({
                    'text': annotation.description,
                    'vertices': vertices,
                    'x_min': min(v.x for v in vertices),
                    'x_max': max(v.x for v in vertices),
                    'y_min': min(v.y for v in vertices),
                    'y_max': max(v.y for v in vertices)
                })

            # Sort lines by Y position
            sorted_lines = sorted(lines.items(), key=lambda x: x[0])

            # Create regions from lines
            region_id = 1
            for line_y, words in sorted_lines:
                if not words:
                    continue

                # Sort words by X position
                words.sort(key=lambda w: w['x_min'])

                # Combine text
                line_text = ' '.join(w['text'] for w in words)

                # Skip very short lines (likely noise)
                if len(line_text.strip()) < 3:
                    continue

                # Calculate bounding box for the entire line
                x_min = min(w['x_min'] for w in words)
                x_max = max(w['x_max'] for w in words)
                y_min = min(w['y_min'] for w in words)
                y_max = max(w['y_max'] for w in words)

                # Normalize coordinates if image dimensions available
                if image_width > 0 and image_height > 0:
                    normalized_x = x_min / image_width
                    normalized_y = y_min / image_height
                    normalized_width = (x_max - x_min) / image_width
                    normalized_height = (y_max - y_min) / image_height
                else:
                    normalized_x = x_min
                    normalized_y = y_min
                    normalized_width = x_max - x_min
                    normalized_height = y_max - y_min

                # Smart filtering to identify item lines
                # STRICTER FILTERING: Only include lines that very likely contain menu items

                # First, skip obvious non-item patterns
                skip_patterns = [
                    # Receipt metadata
                    r'^\d+\s+\w+\s+\w+.*\bDrive\b',  # Address lines like "204 West Las Tunas Drive"
                    r'\b(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd)\b',  # Address indicators
                    r'\b[A-Z]{2}\s+\d{5}',  # US ZIP codes (any state)
                    r'^Server:?\s*',  # Server name
                    r'^Check\s*#',  # Check number
                    r'^Table\s*[#T:\s]',  # Table number (catches "Table: Table 13" and "Table T6")
                    r'Tbl\s+\d+',  # Table in format "Tbl 6/1"
                    r'Chk\s+\d+',  # Check in format "Chk 1750"
                    r'Gst\s+\d+',  # Guest count in format "Gst 4"
                    r'Guest\s+Count',  # Guest count
                    r'Ordered:?\s*\d',  # Order date/time
                    r'\d{1,2}/\d{1,2}/\d{2,4}',  # Dates
                    r'\d{1,2}:\d{2}\s*(AM|PM|am|pm)?',  # Times
                    r'^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$',  # Phone numbers only
                    r'Item\s+Count',  # Item count line
                    r'Balance\s+due',  # Balance due
                    r'Suggested\s+(Gratuity|Tip)',  # Tip suggestions
                    r'%\s+of\s+sale',  # Percentage calculations

                    # Column headers
                    r'^Item\s+Qty\s+Price',
                    r'^Description\s+Amount',

                    # Footer text
                    r'Thank\s+You|Visit\s+Again|Welcome|See\s+You',
                    r'Powered\s+by',
                    r'www\.|\.com',
                    r'Instagram|Facebook|Twitter',  # Social media

                    # Very short lines (likely noise or single numbers)
                    r'^\d{1,2}$',  # Just a number
                ]

                should_skip = any(re.search(pattern, line_text, re.I) for pattern in skip_patterns)
                if should_skip:
                    continue

                # Now check if this looks like an actual item line
                # REQUIRE at least one of these strong signals:
                has_price_with_dollar = bool(re.search(r'\$\s*\d+\.?\d*', line_text))
                has_decimal_price = bool(re.search(r'\b\d+\.\d{2}\b', line_text))

                # For lines with prices, verify they have a description part
                if has_price_with_dollar or has_decimal_price:
                    # Extract the part before the price
                    price_match = re.search(r'(.*?)(\$\s*\d+\.?\d*|\b\d+\.\d{2}\b)', line_text)
                    if price_match:
                        desc_part = price_match.group(1).strip()
                        # Must have at least 2 characters and at least one letter
                        has_description = len(desc_part) >= 2 and any(c.isalpha() for c in desc_part)

                        # If the "description" looks like metadata, skip it
                        metadata_in_desc = bool(re.search(r'^(Subtotal|Total|Tax|Tip|Gratuity|Service|Discount|Admin|Fee|Order|Food)', desc_part, re.I))

                        if has_description and not metadata_in_desc:
                            # This looks like a real item line
                            pass
                        else:
                            # Has price but no valid description - likely total/tax line
                            continue
                    else:
                        # Couldn't parse - skip
                        continue
                else:
                    # No price found - not an item line
                    continue

                # Additional quality check: line should have reasonable length
                if len(line_text) < 5:  # Too short
                    continue
                if len(line_text) > 100:  # Too long (likely multiple items concatenated)
                    continue

                # If we got here, this line passed all filters
                # It has a price, a description, and doesn't match skip patterns

                regions.append({
                    "id": str(region_id),
                    "x": normalized_x,
                    "y": normalized_y,
                    "width": normalized_width,
                    "height": normalized_height,
                    "confidence": 0.95,
                    "text": line_text
                })
                region_id += 1

            print(f"Grouped into {len(regions)} line-level regions")
        else:
            print("No text annotations found in response")

        # Generate cache key and store full OCR response AND regions with text
        cache_key = str(uuid.uuid4())
        ocr_cache.set(cache_key, {
            "vision_response": vision_response,
            "image_width": image_width,
            "image_height": image_height,
            "regions_with_text": regions  # Store the regions with their text
        })
        print(f"Cached OCR response with key: {cache_key}")
        print(f"Cached {len(regions)} regions with text")

        # Cleanup expired cache entries periodically
        ocr_cache.cleanup_expired()

        return {
            "regions": regions,
            "cache_key": cache_key,
            "image_size": {
                "width": image_width,
                "height": image_height
            }
        }

    except HTTPException:
        raise
    except google_exceptions.ServiceUnavailable:
        raise HTTPException(
            status_code=503,
            detail="OCR service is temporarily unavailable, please try again later."
        )
    except google_exceptions.RetryError:
        raise HTTPException(
            status_code=503,
            detail="OCR service request timed out, please try again later."
        )
    except Exception as e:
        print(f"OCR region detection error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"OCR region detection failed: {str(e)}"
        )


def extract_text_from_region(
    vision_response,
    region: schemas.RegionBoundingBox,
    image_width: int,
    image_height: int
) -> str:
    """
    Extract text from a specific region of the OCR response.

    Args:
        vision_response: Cached Vision API response
        region: Bounding box coordinates (normalized 0-1)
        image_width: Original image width in pixels
        image_height: Original image height in pixels

    Returns:
        Concatenated text from all annotations that fall within the region
    """
    if not vision_response or not vision_response.text_annotations:
        return ""

    # Convert normalized coordinates to pixel coordinates
    region_x1 = region.x * image_width
    region_y1 = region.y * image_height
    region_x2 = (region.x + region.width) * image_width
    region_y2 = (region.y + region.height) * image_height

    print(f"  Looking for text in pixel region: ({region_x1:.1f}, {region_y1:.1f}) to ({region_x2:.1f}, {region_y2:.1f})")

    # Extract text from annotations that overlap with the region
    extracted_text = []
    words_checked = 0

    # Skip first annotation (full text), iterate over individual words/phrases
    for annotation in vision_response.text_annotations[1:]:
        if not annotation.bounding_poly or not annotation.bounding_poly.vertices:
            continue

        vertices = annotation.bounding_poly.vertices
        words_checked += 1

        # Calculate bounding box center point
        x_coords = [v.x for v in vertices]
        y_coords = [v.y for v in vertices]
        center_x = sum(x_coords) / len(x_coords)
        center_y = sum(y_coords) / len(y_coords)

        # Check if center point falls within the region
        if (region_x1 <= center_x <= region_x2 and
            region_y1 <= center_y <= region_y2):
            extracted_text.append(annotation.description)
            if len(extracted_text) <= 5:  # Log first few words found
                print(f"    Found word '{annotation.description}' at ({center_x:.1f}, {center_y:.1f})")

    print(f"  Checked {words_checked} words, found {len(extracted_text)} in region")
    return " ".join(extracted_text)


@router.post("/ocr/extract-regions", dependencies=[Depends(ocr_rate_limiter)])
async def extract_regions(
    request: Annotated[schemas.ExtractRegionsRequest, Body()],
    current_user: Annotated[models.User, Depends(get_current_user)] = None
):
    """
    Extract text and parse items from specific regions of a cached OCR response.

    Args:
        request: Contains cache_key and array of region bounding boxes
        current_user: Authenticated user (from JWT token)

    Returns:
        JSON with items array containing region_id, description, price, and text
    """
    try:
        # Retrieve cached OCR response
        cached_data = ocr_cache.get(request.cache_key)
        if not cached_data:
            raise HTTPException(
                status_code=404,
                detail=f"Cache key not found or expired. Please re-upload the image."
            )

        vision_response = cached_data["vision_response"]
        image_width = cached_data["image_width"]
        image_height = cached_data["image_height"]

        # Validate image dimensions
        if image_width <= 0 or image_height <= 0:
            raise HTTPException(
                status_code=422,
                detail="Invalid image dimensions in cached response."
            )

        print(f"Processing {len(request.regions)} regions with image dimensions {image_width}x{image_height}")

        # Extract and parse text from each region
        items = []
        for idx, region in enumerate(request.regions):
            # Validate region coordinates
            if (region.x < 0 or region.y < 0 or
                region.width <= 0 or region.height <= 0 or
                region.x + region.width > 1 or
                region.y + region.height > 1):
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid region coordinates at index {idx}. Coordinates must be normalized (0-1) and within bounds."
                )

            # Always extract text based on the provided coordinates
            # Don't use cached text since regions may have been modified by the user
            region_text = extract_text_from_region(
                vision_response,
                region,
                image_width,
                image_height
            )
            print(f"Extracted text for region {idx}: '{region_text}' from coordinates x:{region.x:.3f} y:{region.y:.3f} w:{region.width:.3f} h:{region.height:.3f}")

            # Always create an item for each region - never skip
            # Users can edit empty/incorrect items in the UI

            # Parse the extracted text to find item-price pairs
            from ocr.parser import extract_price, clean_description, is_noise_line

            # Default values if extraction fails
            item_description = "Item " + str(idx + 1)  # Default description
            item_price = 0  # Default price (user can edit)
            item_confidence = 0.5  # Low confidence for empty/failed extraction
            price_match = None
            price_cents = None

            if region_text.strip():
                # We have text, try to extract price
                price_match, price_cents = extract_price(region_text)

                # If no price found with standard patterns, try to find whole dollar amounts
                # (for receipts that show prices without dollar signs or decimals)
                if not price_match and region_text:
                    # Look for all number patterns in the text
                    # For lines like "Garden Martini 2 $140 $280 TX", we want the last price
                    all_numbers = list(re.finditer(r'\b(\d{2,4})\b', region_text))

                    # Try to find the rightmost number that looks like a price
                    for match in reversed(all_numbers):
                        try:
                            amount = int(match.group(1))
                            # Assume it's a price if it's in a reasonable range
                            # Skip very small numbers (likely quantities) and very large ones
                            if 10 <= amount <= 9999:
                                # Check if this is followed by a currency code or is at the end
                                after_text = region_text[match.end():match.end()+5] if match.end() < len(region_text) else ""
                                if any(curr in after_text for curr in ['TX', 'HK', 'USD', 'EUR', 'GBP']) or match.end() >= len(region_text) - 10:
                                    price_cents = amount * 100  # Convert to cents
                                    price_match = match
                                    print(f"Found whole dollar price: ${amount}")
                                    break
                        except:
                            pass

                # Update values if we successfully extracted data
                if price_match and price_cents and 1 <= price_cents <= 99999:
                    # Found a valid price
                    item_price = price_cents

                    description_text = region_text[:price_match.start()].strip()
                    # If no description before price, use text after price or full text
                    if not description_text or len(description_text) < 2:
                        remaining_text = region_text[price_match.end():].strip()
                        description_text = remaining_text if remaining_text else region_text

                    description = clean_description(description_text)
                    if description and len(description) >= 2 and not is_noise_line(description):
                        item_description = description
                        item_confidence = 0.95 if len(description) > 5 and price_cents > 0 else 0.75
                    else:
                        # Have price but no good description - use default with medium confidence
                        item_confidence = 0.6
                        if region_text:
                            # Use the raw text as description if we have it
                            item_description = region_text[:50] if len(region_text) > 50 else region_text

                    print(f"Extracted from region {idx}: {item_description} - ${item_price/100:.2f}")
                else:
                    # No price found - try to at least get a description
                    if region_text:
                        description = clean_description(region_text)
                        if description and len(description) >= 2:
                            item_description = description
                            item_confidence = 0.3  # Low confidence without price
                        else:
                            # Use raw text if clean failed
                            item_description = region_text[:50] if len(region_text) > 50 else region_text
                            item_confidence = 0.2
                    print(f"Region {idx} - no price found, using: '{item_description}'")
            else:
                # No text at all - use defaults
                print(f"Region {idx} - no text extracted, using defaults")

            # ALWAYS add an item for every region
            # Use idx+1 to match the frontend's 1-based numbering
            items.append({
                "region_id": str(idx + 1),
                "description": item_description,
                "price": item_price,
                "text": region_text if region_text else "",
                "confidence": item_confidence
            })

        print(f"Extracted {len(items)} items from {len(request.regions)} regions")

        return {"items": items}

    except HTTPException:
        raise
    except Exception as e:
        print(f"OCR region extraction error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"OCR region extraction failed: {str(e)}"
        )
