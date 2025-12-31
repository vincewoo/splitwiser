"""
Enhanced receipt parser using bounding box coordinates from Google Cloud Vision.

This parser uses spatial layout information to accurately extract item-price pairs
from receipts, handling various receipt formats and layouts.
"""

import re
import sys
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass


_environment_logged = False


def log_environment_info():
    """Log environment info for debugging library version differences."""
    global _environment_logged
    if _environment_logged:
        return
    _environment_logged = True

    print(f"[V2 DEBUG] Python version: {sys.version}")
    try:
        import google.cloud.vision
        print(f"[V2 DEBUG] google-cloud-vision version: {google.cloud.vision.__version__}")
    except (ImportError, AttributeError):
        print("[V2 DEBUG] Could not get google-cloud-vision version")
    try:
        import google.protobuf
        print(f"[V2 DEBUG] protobuf version: {google.protobuf.__version__}")
    except (ImportError, AttributeError):
        print("[V2 DEBUG] Could not get protobuf version")

# Import old parser for fallback
# Use try/except to handle both package import (server) and direct import (tests)
try:
    from .parser import parse_receipt_items as parse_receipt_items_v1
except ImportError:
    from parser import parse_receipt_items as parse_receipt_items_v1


@dataclass
class TextBlock:
    """Represents a text element with its spatial position."""
    text: str
    x: float  # Left edge x-coordinate
    y: float  # Top edge y-coordinate
    width: float
    height: float

    @property
    def center_y(self) -> float:
        """Vertical center of the text block."""
        return self.y + (self.height / 2)

    @property
    def right_x(self) -> float:
        """Right edge x-coordinate."""
        return self.x + self.width


def extract_bounding_box(vertices, debug: bool = False) -> Tuple[float, float, float, float]:
    """
    Extract bounding box coordinates from Vision API vertices.

    Handles both attribute-style access (v.x) and dict-style access (v['x'])
    for compatibility across different google-cloud-vision library versions.

    Returns:
        (x, y, width, height) where x,y is top-left corner
    """
    def get_coord(v, attr):
        """Get coordinate from vertex, handling both object and dict access."""
        try:
            # Try attribute access first (protobuf objects)
            val = getattr(v, attr, None)
            if val is not None:
                return val
        except (TypeError, AttributeError):
            pass
        try:
            # Try dict-style access
            if isinstance(v, dict):
                return v.get(attr, 0)
        except (TypeError, AttributeError):
            pass
        return 0

    xs = [get_coord(v, 'x') for v in vertices]
    ys = [get_coord(v, 'y') for v in vertices]

    if debug:
        print(f"[V2 DEBUG] Extracted xs: {xs}, ys: {ys}")

    # Handle empty or invalid vertices
    if not xs or not ys or all(x == 0 for x in xs):
        return (0, 0, 0, 0)

    x = min(xs)
    y = min(ys)
    width = max(xs) - x
    height = max(ys) - y

    return (x, y, width, height)


def parse_receipt_items_v2(vision_response, debug: bool = False) -> List[Dict[str, any]]:
    """
    Parse Google Cloud Vision OCR response using bounding box coordinates.

    Strategy:
    1. Extract all text blocks with their spatial positions
    2. Identify price blocks (numbers with $ or decimal format)
    3. For each price, find associated description:
       - Look on same line first (right-aligned receipts)
       - If no description on same line, look at lines above (multi-line items)
    4. Apply smart filtering to remove totals, tax, etc.

    Args:
        vision_response: Google Cloud Vision AnnotateImageResponse
        debug: Enable verbose debug logging

    Returns:
        List of items: [{"description": str, "price": int}, ...]
    """
    # Log environment info (once per session) to help debug version differences
    if debug:
        log_environment_info()

    if not vision_response or not vision_response.text_annotations:
        if debug:
            print("[V2 DEBUG] No vision_response or no text_annotations")
        return []

    # Log basic info about the response
    annotation_count = len(vision_response.text_annotations)
    if debug:
        print(f"[V2 DEBUG] Total annotations: {annotation_count}")

    # Skip first annotation (full text), use individual word/phrase annotations
    text_blocks = []
    valid_blocks = 0
    zero_coord_blocks = 0
    first_few_debug = 3  # Log details for first few annotations

    for idx, annotation in enumerate(vision_response.text_annotations[1:]):  # Skip [0] which is full text
        text = annotation.description.strip()
        if not text:
            continue

        # Deep inspection of first few annotations to understand data structure
        if debug and idx < first_few_debug:
            print(f"[V2 DEBUG] Annotation #{idx}: text='{text}'")
            print(f"[V2 DEBUG]   bounding_poly type: {type(annotation.bounding_poly)}")
            vertices = annotation.bounding_poly.vertices
            print(f"[V2 DEBUG]   vertices type: {type(vertices)}, len: {len(vertices) if hasattr(vertices, '__len__') else 'N/A'}")
            if len(vertices) > 0:
                v0 = vertices[0]
                print(f"[V2 DEBUG]   vertices[0] type: {type(v0)}")
                print(f"[V2 DEBUG]   vertices[0] dir: {[a for a in dir(v0) if not a.startswith('_')][:10]}")
                # Try different access methods
                try:
                    print(f"[V2 DEBUG]   vertices[0].x = {v0.x}, vertices[0].y = {v0.y}")
                except Exception as e:
                    print(f"[V2 DEBUG]   vertices[0].x/.y access failed: {e}")
                try:
                    print(f"[V2 DEBUG]   getattr(vertices[0], 'x') = {getattr(v0, 'x', 'NOT_FOUND')}")
                except Exception as e:
                    print(f"[V2 DEBUG]   getattr access failed: {e}")
                if isinstance(v0, dict):
                    print(f"[V2 DEBUG]   vertices[0] is dict: {v0}")

        vertices = annotation.bounding_poly.vertices
        x, y, width, height = extract_bounding_box(vertices, debug=(debug and idx < first_few_debug))

        # Track blocks with zero coordinates (indicates parsing issue)
        if x == 0 and y == 0 and width == 0 and height == 0:
            zero_coord_blocks += 1
            if debug and zero_coord_blocks <= 3:
                print(f"[V2 DEBUG] Zero-coord block #{zero_coord_blocks}: text='{text}'")
            continue  # Skip invalid blocks
        else:
            valid_blocks += 1

        text_blocks.append(TextBlock(
            text=text,
            x=x,
            y=y,
            width=width,
            height=height
        ))

    # Log summary of block processing
    if debug:
        print(f"[V2 DEBUG] Block processing summary: {valid_blocks} valid, {zero_coord_blocks} zero-coord (skipped)")

    # Log if we're losing blocks to coordinate parsing issues
    if zero_coord_blocks > 0:
        print(f"[V2 Parser] Warning: {zero_coord_blocks} blocks had invalid coordinates (skipped), {valid_blocks} valid blocks")

    if not text_blocks:
        if debug:
            print("[V2 DEBUG] No valid text_blocks after processing - returning empty")
        return []

    # Group text blocks into lines based on vertical position
    lines = group_into_lines(text_blocks)

    if debug:
        print(f"[V2 DEBUG] Grouped into {len(lines)} lines")
        # Log first 5 lines to see what we're working with
        for i, line in enumerate(lines[:5]):
            line_text = ' '.join(b.text for b in line)
            print(f"[V2 DEBUG]   Line {i}: '{line_text}' ({len(line)} blocks)")

    # NEW APPROACH: Find prices first, then match descriptions
    items = []
    used_blocks = set()  # Track which blocks we've already used
    prices_found = 0  # Track how many prices we detect

    for line_idx, line in enumerate(lines):
        # Find price on this line
        price_block = None
        price_cents = None

        for block in reversed(line):  # Check from right to left
            extracted_price = extract_price_from_text(block.text)
            if extracted_price is not None:
                price_cents = extracted_price
                price_block = block
                break

        if not price_block or price_cents is None:
            continue

        prices_found += 1
        if debug and prices_found <= 10:
            line_text = ' '.join(b.text for b in line)
            print(f"[V2 DEBUG] Price #{prices_found} found: ${price_cents/100:.2f} in line: '{line_text}'")

        # Validate price range
        if price_cents < 1 or price_cents > 99999:
            continue

        # Mark price block as used
        used_blocks.add(id(price_block))

        # Find description blocks
        description_parts = []

        # Strategy 1: Same-line description (text to left of price)
        same_line_desc = [b for b in line if b.right_x < price_block.x - 5 and id(b) not in used_blocks]

        if same_line_desc:
            # Has description on same line
            description_parts = [b.text for b in same_line_desc]
        else:
            # Strategy 2: Multi-line item - look at previous lines
            # Look at the line DIRECTLY above (not 3 lines up - too risky)
            if line_idx > 0:
                prev_line = lines[line_idx - 1]
                # Take all blocks from previous line that aren't already used
                prev_line_blocks = [b for b in prev_line if id(b) not in used_blocks]

                # IMPORTANT: Check if previous line contains metadata before using it
                prev_line_text = ' '.join(b.text for b in prev_line_blocks)
                if prev_line_blocks and not contains_metadata(prev_line_text):
                    description_parts.extend([b.text for b in prev_line_blocks])
                    # Mark these blocks as used
                    for b in prev_line_blocks:
                        used_blocks.add(id(b))

        if not description_parts:
            continue

        # Combine description parts
        description = ' '.join(description_parts)
        description = clean_description(description)

        if not description or len(description) < 2:
            continue

        # Apply smart filtering (pass price for subtotal detection)
        if should_filter_item(description, line, price_cents):
            continue

        items.append({
            'description': description,
            'price': price_cents
        })

    if debug:
        print(f"[V2 DEBUG] Final summary: {prices_found} prices found, {len(items)} items extracted")
        if items:
            for item in items[:5]:
                print(f"[V2 DEBUG]   Item: '{item['description']}' = ${item['price']/100:.2f}")
            if len(items) > 5:
                print(f"[V2 DEBUG]   ... and {len(items) - 5} more items")

    return items


def group_into_lines(blocks: List[TextBlock], y_threshold: float = 10.0) -> List[List[TextBlock]]:
    """
    Group text blocks into horizontal lines based on Y-coordinate proximity.

    Args:
        blocks: List of TextBlock objects
        y_threshold: Maximum Y-distance for blocks to be on same line

    Returns:
        List of lines, where each line is a list of TextBlocks sorted left-to-right
    """
    if not blocks:
        return []

    # Sort by vertical position
    sorted_blocks = sorted(blocks, key=lambda b: b.center_y)

    lines = []
    current_line = [sorted_blocks[0]]

    for block in sorted_blocks[1:]:
        # Check if this block is on the same line as the current line
        prev_y = current_line[-1].center_y
        if abs(block.center_y - prev_y) <= y_threshold:
            current_line.append(block)
        else:
            # Sort current line left-to-right and save
            current_line.sort(key=lambda b: b.x)
            lines.append(current_line)
            # Start new line
            current_line = [block]

    # Don't forget the last line
    if current_line:
        current_line.sort(key=lambda b: b.x)
        lines.append(current_line)

    return lines


def extract_item_from_line(line: List[TextBlock]) -> Optional[Dict[str, any]]:
    """
    Extract item from a line of text blocks.

    Looks for price on the right side and description on the left.

    Args:
        line: List of TextBlock objects on the same horizontal line

    Returns:
        Dict with 'description' and 'price' (in cents), or None
    """
    if not line:
        return None

    # Find price blocks (rightmost numbers that look like prices)
    price_block = None
    price_cents = None

    # Check blocks from right to left for price pattern
    for block in reversed(line):
        extracted_price = extract_price_from_text(block.text)
        if extracted_price is not None:
            price_cents = extracted_price
            price_block = block
            break

    if not price_block or price_cents is None:
        return None

    # Validate price range (1 cent to $999.99)
    if price_cents < 1 or price_cents > 99999:
        return None

    # Find description blocks (everything to the left of the price)
    description_blocks = [b for b in line if b.right_x < price_block.x - 5]  # 5px gap

    if not description_blocks:
        # Price might have description embedded (e.g., "Burger $12.99")
        # Try to extract description from price block itself
        desc = extract_description_from_price_block(price_block.text)
        if desc:
            description_blocks = [TextBlock(desc, 0, 0, 0, 0)]

    if not description_blocks:
        return None

    # Combine description blocks into single description
    description = ' '.join(b.text for b in description_blocks)
    description = clean_description(description)

    if not description or len(description) < 2:
        return None

    # Apply smart filtering (pass price for subtotal detection)
    if should_filter_item(description, line, price_cents):
        return None

    return {
        'description': description,
        'price': price_cents
    }


def extract_price_from_text(text: str) -> Optional[int]:
    """
    Extract price in cents from text.

    Handles formats:
    - $12.99
    - 12.99 (with or without surrounding text)
    - 12,99 (European format)
    - 12 (whole dollars with $ sign only)

    Returns:
        Price in cents, or None if no valid price found
    """
    # Remove whitespace
    text = text.strip()

    # Pattern 1: $12.99 or $12
    match = re.search(r'\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)', text)
    if match:
        price_str = match.group(1).replace(',', '')
        return parse_price_to_cents(price_str)

    # Pattern 2: Exact price (strict) - "12.99"
    match = re.search(r'^(\d{1,3}\.\d{2})$', text)
    if match:
        return parse_price_to_cents(match.group(1))

    # Pattern 2a: Price at end of text with space before - "GARLICBREAD 3.95"
    match = re.search(r'\s(\d{1,3}\.\d{2})$', text)
    if match:
        return parse_price_to_cents(match.group(1))

    # Pattern 2b: Price with optional whitespace around - " 3.95 " or "3.95"
    match = re.search(r'(?:^|\s)(\d{1,3}\.\d{2})(?:\s|$)', text)
    if match:
        return parse_price_to_cents(match.group(1))

    # Pattern 3: 12,99 (European comma decimal)
    match = re.search(r'^(\d{1,3}),(\d{2})$', text)
    if match:
        price_str = f"{match.group(1)}.{match.group(2)}"
        return parse_price_to_cents(price_str)

    # Pattern 4: DISABLED - Too risky
    # Bare numbers like "49" from "Check #49" were being detected as prices
    # Only accept prices with $ symbol or decimal points to avoid false matches

    return None


def parse_price_to_cents(price_str: str) -> Optional[int]:
    """Convert price string to cents."""
    try:
        if '.' in price_str:
            dollars, cents = price_str.split('.')
            return int(dollars) * 100 + int(cents)
        else:
            return int(price_str) * 100
    except (ValueError, AttributeError):
        return None


def extract_description_from_price_block(text: str) -> Optional[str]:
    """
    Extract description when it's combined with price (e.g., "Burger $12.99").
    """
    # Remove price part
    text = re.sub(r'\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)', '', text)
    text = re.sub(r'(\d{1,3}\.\d{2})', '', text)
    text = text.strip()

    if len(text) >= 2:
        return text
    return None


def clean_description(text: str) -> str:
    """
    Clean item description.

    - Preserves quantity prefixes (e.g., "2 Diet" stays as "2 Diet")
    - Normalizes "2x" multiplication syntax to "2 "
    - Removes special characters
    - Normalizes whitespace
    - Title cases for consistency
    """
    # Normalize multiplication syntax but preserve quantity
    # "2x Burger" -> "2 Burger", "2X Burger" -> "2 Burger"
    text = re.sub(r'^(\d+)\s*[xX]\s+', r'\1 ', text)

    # Remove trailing special characters (including $)
    text = re.sub(r'[*\-\.\$\:]+$', '', text)

    # Remove leading special characters
    text = re.sub(r'^[*\-\.\$\:]+', '', text)

    # Remove extra whitespace
    text = ' '.join(text.split())

    # Title case
    text = text.strip().title()

    return text


def contains_metadata(text: str) -> bool:
    """
    Check if text contains receipt metadata patterns.

    Used to prevent metadata lines from being used as item descriptions
    in multi-line matching.

    Args:
        text: Text to check

    Returns:
        True if text contains metadata patterns
    """
    text_lower = text.lower()

    # Metadata patterns to check
    patterns = [
        r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Dates
        r'\d{1,2}:\d{2}\s?(?:am|pm)?',      # Times
        r'receipt\s*#',
        r'transaction\s*#',
        r'order\s*#',
        r'\btable\s+[#t]?\d+\b',              # "Table #5" or "Table T6" (word boundary)
        r'check\s*#',
        r'server[:\s]',                      # "Server:" or "Server Pixie"
        r'cashier[:\s]',
        r'guest\s+count',
        r'ordered[:\s]',
        r'discount',
        r'payment',
        r'thank\s*you',
        r'welcome',
    ]

    for pattern in patterns:
        if re.search(pattern, text_lower):
            return True

    return False


def should_filter_item(description: str, line: List[TextBlock], price_cents: int = 0) -> bool:
    """
    Smart filtering to remove non-item lines (totals, tax, etc.).

    Uses context from the entire line, not just the description.

    Args:
        description: Cleaned item description
        line: All text blocks on the line
        price_cents: Price in cents (used for subtotal detection)

    Returns:
        True if item should be filtered out
    """
    desc_lower = description.lower()

    # Get all text on the line for context
    line_text = ' '.join(b.text for b in line).lower()

    # Filter exact matches for common non-item keywords
    exact_filters = [
        'subtotal',
        'total',
        'tax',
        'tip',
        'gratuity',
        'service charge',
        'change',
        'amount due',
        'balance',
        'cash',
        'credit',
        'debit',
        'visa',
        'mastercard',
        'amex',
        'admin fee',
        'service fee',
        'convenience fee',
        'processing fee',
    ]

    for keyword in exact_filters:
        # Check if keyword matches description exactly OR is contained in description/line
        if keyword == desc_lower or keyword in desc_lower or keyword in line_text:
            return True

    # Smart category subtotal filtering
    # These are ONLY filtered when they appear to be subtotals, not menu items
    category_keywords = ['food', 'drinks', 'beverages', 'appetizers', 'entrees', 'desserts']

    if desc_lower in category_keywords:
        # If the description has multiple words, it's likely a real item
        # e.g., "Food Court Combo" should NOT be filtered
        word_count = len(description.split())
        if word_count > 1:
            return False  # Don't filter multi-word items

        # Single-word category name with high price is likely a subtotal
        # e.g., "Food $79.75" is a subtotal, "Food $12.99" might be an item
        if price_cents > 2000:  # >$20 threshold for subtotals
            return True

        # Single-word category with low price - could be an item, don't filter
        return False

    # Filter receipt metadata
    metadata_patterns = [
        r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Dates
        r'\d{1,2}:\d{2}\s?(?:am|pm)?',      # Times
        r'receipt\s*#',
        r'transaction\s*#',
        r'order\s*#',
        r'\btable\s+[#t]?\d+\b',
        r'check\s*#',
        r'server:',
        r'server\s+\w+',                    # "Server: Pixie I"
        r'cashier:',
        r'guest\s+count',                   # "Guest Count: 2"
        r'ordered:',                        # "Ordered: 12/18/25"
        r'we\s+offer',                      # "WE OFFER A 3% DISCOUNT"
        r'discount',                        # Discount mentions
        r'payment',                         # Payment instructions
        r'thank\s*you',
        r'welcome',
        r'www\.',
        r'\.com',
    ]

    for pattern in metadata_patterns:
        if re.search(pattern, line_text, re.I):
            return True

    # Filter if description is too short (likely noise)
    if len(description) < 2:
        return True

    # Filter if description is just numbers
    if re.match(r'^\d+$', description):
        return True

    return False


def get_raw_text(vision_response) -> str:
    """
    Extract raw text from Vision response for debugging.

    Args:
        vision_response: Google Cloud Vision AnnotateImageResponse

    Returns:
        Full text from first annotation
    """
    if vision_response and vision_response.text_annotations:
        return vision_response.text_annotations[0].description
    return ""


def detect_receipt_total(raw_text: str) -> Optional[int]:
    """
    Find the receipt total from common patterns in the raw OCR text.

    Looks for lines like:
    - "Total $145.86"
    - "TOTAL DUE 87.53"
    - "Amount Due: $50.00"

    Args:
        raw_text: Full OCR text from receipt

    Returns:
        Total in cents, or None if not found
    """
    if not raw_text:
        return None

    # Patterns to match total lines (case-insensitive)
    # Note: Order matters - more specific patterns first (Grand Total before Total)
    # Also avoid matching "Subtotal" by checking character before "total"
    total_patterns = [
        r'grand\s*total[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',  # "Grand Total" first (most specific)
        r'amount\s*due[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',
        r'balance\s*due[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',
        r'(?:^|[^buS])total\s*(?:due)?[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',  # Avoid "Subtotal"
    ]

    for pattern in total_patterns:
        match = re.search(pattern, raw_text, re.I)
        if match:
            price_str = match.group(1).replace(',', '')
            return parse_price_to_cents(price_str)

    return None


def detect_receipt_tax(raw_text: str) -> Optional[int]:
    """
    Find the tax amount from the raw OCR text.

    Looks for lines like:
    - "Tax $7.78"
    - "TAX: 13.86"
    - "Sales Tax 5.00"

    Args:
        raw_text: Full OCR text from receipt

    Returns:
        Tax in cents, or None if not found
    """
    if not raw_text:
        return None

    # Patterns to match tax lines (case-insensitive)
    tax_patterns = [
        r'(?:sales\s*)?tax[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',
        r'gst[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',
        r'hst[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',
        r'vat[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})',
    ]

    for pattern in tax_patterns:
        match = re.search(pattern, raw_text, re.I)
        if match:
            price_str = match.group(1).replace(',', '')
            return parse_price_to_cents(price_str)

    return None


def detect_receipt_subtotal(raw_text: str) -> Optional[int]:
    """
    Find the subtotal from the raw OCR text.

    Looks for lines like:
    - "Subtotal $114.00"
    - "Sub Total: 114.00"
    - "Sub-total $114.00"

    Args:
        raw_text: Full OCR text from receipt

    Returns:
        Subtotal in cents, or None if not found
    """
    if not raw_text:
        return None

    # Patterns to match subtotal lines (case-insensitive)
    subtotal_patterns = [
        r'sub[-\s]?total[:\s]*\$?\s*(\d{1,4}(?:,\d{3})*\.\d{2})',
    ]

    for pattern in subtotal_patterns:
        match = re.search(pattern, raw_text, re.I)
        if match:
            price_str = match.group(1).replace(',', '')
            return parse_price_to_cents(price_str)

    return None


def parse_receipt_with_validation(vision_response) -> Dict[str, any]:
    """
    Parse receipt items and validate against detected subtotal.

    Returns enhanced structure with validation information:
    {
        "items": [...],
        "detected_total": int or None,
        "detected_subtotal": int or None,
        "detected_tax": int or None,
        "calculated_subtotal": int,
        "validation_warning": str or None
    }

    Args:
        vision_response: Google Cloud Vision AnnotateImageResponse

    Returns:
        Dict with items and validation info
    """
    # Get raw text for total/tax detection (needed for smart fallback)
    raw_text = get_raw_text(vision_response)

    # Detect subtotal early for smart fallback comparison
    detected_subtotal = detect_receipt_subtotal(raw_text)
    detected_total = detect_receipt_total(raw_text)
    detected_tax = detect_receipt_tax(raw_text)

    # Determine expected subtotal for validation
    expected_subtotal = None
    if detected_subtotal is not None:
        expected_subtotal = detected_subtotal
    elif detected_total is not None and detected_tax is not None:
        expected_subtotal = detected_total - detected_tax

    # Parse items using V2 parser first
    items = parse_receipt_items_v2(vision_response)
    items_old = parse_receipt_items_v1(vision_response)

    # Smart fallback: compare V2 and old parser results
    v2_subtotal = sum(item['price'] for item in items)
    old_subtotal = sum(item['price'] for item in items_old)

    use_old_parser = False
    fallback_reason = None

    if not items and items_old:
        # V2 found nothing, old parser found something
        use_old_parser = True
        fallback_reason = f"V2 found 0 items, old parser found {len(items_old)}"
    elif expected_subtotal is not None:
        # Compare which parser is closer to the expected subtotal
        v2_diff = abs(v2_subtotal - expected_subtotal)
        old_diff = abs(old_subtotal - expected_subtotal)

        # Use old parser if it's significantly closer to expected subtotal
        # (at least $2 closer and within $1 of expected)
        if old_diff < v2_diff - 200 and old_diff <= 100:
            use_old_parser = True
            fallback_reason = (
                f"Old parser closer to subtotal: "
                f"V2=${v2_subtotal/100:.2f} (diff=${v2_diff/100:.2f}), "
                f"Old=${old_subtotal/100:.2f} (diff=${old_diff/100:.2f}), "
                f"Expected=${expected_subtotal/100:.2f}"
            )

    if use_old_parser:
        print(f"[V2 Fallback] {fallback_reason}")
        items = items_old

    # Calculate sum of parsed items (for final validation)
    calculated_subtotal = sum(item['price'] for item in items)

    # Validate and generate warning if needed
    validation_warning = None

    if expected_subtotal is not None:
        # Check if our parsed items match expected subtotal
        # Allow 100 cents ($1) tolerance for rounding
        difference = abs(calculated_subtotal - expected_subtotal)

        if difference > 100:
            # Calculate how much is missing
            missing_amount = expected_subtotal - calculated_subtotal
            if missing_amount > 0:
                validation_warning = (
                    f"Some items may be missing. "
                    f"Parsed items total ${calculated_subtotal/100:.2f} "
                    f"but receipt subtotal is ${expected_subtotal/100:.2f} "
                    f"(${missing_amount/100:.2f} difference)."
                )
            else:
                # We have more than expected - probably incorrectly included subtotal/tax
                validation_warning = (
                    f"Some items may be incorrectly included. "
                    f"Parsed items total ${calculated_subtotal/100:.2f} "
                    f"but receipt subtotal is ${expected_subtotal/100:.2f}."
                )

    return {
        "items": items,
        "detected_total": detected_total,
        "detected_subtotal": detected_subtotal,
        "detected_tax": detected_tax,
        "calculated_subtotal": calculated_subtotal,
        "validation_warning": validation_warning
    }
