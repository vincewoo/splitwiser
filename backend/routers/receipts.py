"""Receipts router: OCR receipt scanning endpoint."""

from typing import Annotated
import os
import uuid
import io
from PIL import Image, UnidentifiedImageError
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Request
from sqlalchemy.orm import Session

import models
from database import get_db
from dependencies import get_current_user
from ocr.service import ocr_service
from ocr.parser import parse_receipt_items
from ocr.parser_v2 import parse_receipt_items_v2, get_raw_text, parse_receipt_with_validation


# Receipt directory path
DATA_DIR = os.getenv("DATA_DIR", "data")
RECEIPT_DIR = os.path.join(DATA_DIR, "receipts")
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


router = APIRouter(tags=["receipts"])


@router.post("/ocr/scan-receipt")
async def scan_receipt(
    request: Request,
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
    # Validate file type
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and WebP images are supported."
        )

    # Check content length header
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_FILE_SIZE:
                 raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Maximum size is {MAX_FILE_SIZE / (1024 * 1024)}MB."
                )
        except ValueError:
            pass # Ignore malformed header, we'll check actual size

    try:
        # Read image file safely
        # We read one byte more than the max to detect if it exceeds the limit
        image_content = await file.read(MAX_FILE_SIZE + 1)

        if len(image_content) > MAX_FILE_SIZE:
             raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE / (1024 * 1024)}MB."
            )

        # Security: Verify image content and determine extension
        try:
            with Image.open(io.BytesIO(image_content)) as img:
                img.verify()  # Verify integrity
                format_ext_map = {
                    "JPEG": "jpg",
                    "PNG": "png",
                    "WEBP": "webp"
                }
                if img.format not in format_ext_map:
                    # Fallback or strict check
                    if img.format == "MPO": # Multi-Picture Object often used by camera phones, similar to JPEG
                        file_ext = "jpg"
                    else:
                        # Re-open to check if we can save it as one of our supported types or if it's just something else
                        # But img.verify() destroys the object partially.
                        # Simple approach: if not in map, default to safe extension if content-type matches, or fail.
                        # For now, let's trust the mapped formats.
                         raise HTTPException(status_code=400, detail=f"Unsupported image format: {img.format}")
                else:
                    file_ext = format_ext_map[img.format]
        except (UnidentifiedImageError, Exception) as e:
            print(f"Image verification failed: {e}")
            raise HTTPException(status_code=400, detail="Invalid image file")

        # Ensure receipts directory exists
        os.makedirs(RECEIPT_DIR, exist_ok=True)

        # Generate unique filename with safe extension
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

        # Parse items using new spatial layout parser (V2) with validation
        parsed_result = parse_receipt_with_validation(vision_response)
        items = parsed_result["items"]

        print(f"[V2 Parser] Parsed items count: {len(items)}")
        for item in items:
            print(f" - Found item: {item}")

        # For comparison, also run old parser
        items_old = parse_receipt_items(vision_response)
        print(f"[Old Parser] Parsed items count: {len(items_old)}")
        if len(items_old) != len(items):
            print(f"⚠️  Parser difference: V2 found {len(items)} items vs Old found {len(items_old)} items")

        # Log validation results
        print(f"[Validation] Detected subtotal: {parsed_result['detected_subtotal']}, Total: {parsed_result['detected_total']}, Tax: {parsed_result['detected_tax']}")
        print(f"[Validation] Calculated subtotal: {parsed_result['calculated_subtotal']}")
        if parsed_result["validation_warning"]:
            print(f"[Validation] ⚠️  {parsed_result['validation_warning']}")

        return {
            "items": items,
            "total": parsed_result["calculated_subtotal"],
            "detected_subtotal": parsed_result["detected_subtotal"],
            "detected_total": parsed_result["detected_total"],
            "detected_tax": parsed_result["detected_tax"],
            "validation_warning": parsed_result["validation_warning"],
            "raw_text": raw_text,
            "receipt_image_path": f"/static/receipts/{filename}"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"OCR processing error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"OCR processing failed: {str(e)}"
        )
