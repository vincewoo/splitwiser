import re
from typing import List, Dict


# Noise patterns to filter out (case-insensitive)
NOISE_PATTERNS = [
    r'subtotal',
    r'total',
    r'tax',
    r'tip',
    r'change',
    r'balance',
    r'tender',
    r'cash',
    r'credit',
    r'debit',
    r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Dates (MM/DD/YYYY)
    r'\d{3}[-.]?\d{3}[-.]?\d{4}',      # Phone numbers
    r'card\s*#',
    r'receipt\s*#',
    r'transaction\s*#',
    r'thank\s*you',
]

# Price detection patterns (in order of preference)
PRICE_PATTERNS = [
    r'\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})',           # $12.99 or $ 12.99
    r'(\d{1,3}(?:,\d{3})*\.\d{2})\s?(?:USD|usd)',  # 12.99 USD
    r'(\d{1,3}(?:,\d{3})*\.\d{2})',                # 12.99
]


def parse_receipt_items(ocr_result) -> List[Dict[str, any]]:
    """
    Parse OCR result into items with descriptions and prices.

    Uses spatial text analysis to group text by lines and associate
    descriptions with prices. Filters out noise patterns.

    Args:
        ocr_result: PaddleOCR v3.3.2 result dictionary with keys:
                    - 'dt_polys': bounding boxes
                    - 'rec_text': recognized text
                    - 'rec_score': confidence scores

    Returns:
        List of items: [{"description": str, "price": int}, ...]
        where price is in cents
    """
    if not ocr_result:
        return []

    items = []

    # PaddleOCR v3.3.2 returns a dict format
    if isinstance(ocr_result, dict):
        # Extract text, bounding boxes, and scores (note: keys are plural)
        texts = ocr_result.get('rec_texts', [])
        bboxes = ocr_result.get('dt_polys', [])
        scores = ocr_result.get('rec_scores', [])

        print(f"DEBUG: Found {len(texts)} text items")

        # Create text blocks with Y-coordinates for sorting
        text_blocks = []
        for i in range(len(texts)):
            text = texts[i]
            bbox = bboxes[i] if i < len(bboxes) else None
            score = scores[i] if i < len(scores) else 1.0

            # Get Y-coordinate (top-left corner of bounding box)
            if bbox is not None and len(bbox) > 0:
                # bbox is a numpy array with shape (4, 2) - 4 corners with x,y coords
                y_coord = float(bbox[0][1])  # Top-left Y coordinate
            else:
                y_coord = 0

            text_blocks.append({
                'text': text,
                'bbox': bbox,
                'confidence': score,
                'y': y_coord
            })
    else:
        # Fallback for old format (shouldn't happen with v3.3.2)
        print("DEBUG: Unexpected OCR result format, returning empty")
        return []

    # Sort by Y-coordinate (top to bottom)
    text_blocks.sort(key=lambda b: b['y'])

    # Group text blocks by line (Y-proximity)
    lines = group_by_proximity(text_blocks, y_threshold=15)

    # Process each line to find item-price pairs
    for line in lines:
        line_text = ' '.join([b['text'] for b in line])

        # Skip noise lines
        if is_noise_line(line_text):
            continue

        # Extract price from line
        price_match, price_cents = extract_price(line_text)

        if price_match and price_cents:
            # Validate price range ($0.01 to $999.99)
            if not (1 <= price_cents <= 99999):
                continue

            # Extract description (text before price)
            description = line_text[:price_match.start()].strip()

            # Clean description
            description = clean_description(description)

            # Validate description
            if description and len(description) >= 2:
                items.append({
                    'description': description,
                    'price': price_cents
                })

    return items


def group_by_proximity(blocks: List[Dict], y_threshold: int = 15) -> List[List[Dict]]:
    """
    Group text blocks that are on the same line (similar Y coordinate).

    Args:
        blocks: List of text blocks with 'y' coordinate
        y_threshold: Maximum Y-distance to consider blocks on same line

    Returns:
        List of lines, where each line is a list of text blocks
    """
    if not blocks:
        return []

    lines = []
    current_line = [blocks[0]]
    prev_y = blocks[0]['y']

    for block in blocks[1:]:
        if abs(block['y'] - prev_y) <= y_threshold:
            current_line.append(block)
        else:
            if current_line:
                lines.append(current_line)
            current_line = [block]
        prev_y = block['y']

    # Add last line
    if current_line:
        lines.append(current_line)

    return lines


def is_noise_line(text: str) -> bool:
    """
    Check if line matches noise patterns that should be filtered out.

    Args:
        text: Line text to check

    Returns:
        True if line should be filtered out
    """
    for pattern in NOISE_PATTERNS:
        if re.search(pattern, text, re.I):
            return True
    return False


def extract_price(text: str) -> tuple:
    """
    Extract price from text using multiple patterns.

    Args:
        text: Text to search for price

    Returns:
        Tuple of (match_object, price_in_cents)
        Returns (None, None) if no price found
    """
    for pattern in PRICE_PATTERNS:
        match = re.search(pattern, text)
        if match:
            # Extract numeric part
            price_str = match.group(1).replace(',', '')
            try:
                price_dollars = float(price_str)
                price_cents = int(price_dollars * 100)
                return (match, price_cents)
            except ValueError:
                continue

    return (None, None)


def clean_description(text: str) -> str:
    """
    Clean and format item description.

    Removes:
    - Leading numbers/quantities (e.g., "2x" or "1 ")
    - Special characters
    - Extra whitespace

    Args:
        text: Raw description text

    Returns:
        Cleaned description
    """
    # Remove leading numbers and special chars (quantities like "2x", "1 ")
    text = re.sub(r'^[\d\s\-*x×]+', '', text, flags=re.I)

    # Remove trailing special chars
    text = re.sub(r'[\s\-*]+$', '', text)

    # Remove extra whitespace
    text = ' '.join(text.split())

    # Capitalize first letter of each word for consistency
    text = text.strip().title()

    return text
