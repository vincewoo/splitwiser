"""
Enhanced receipt parser using bounding box coordinates from Google Cloud Vision.

This parser uses spatial layout information to accurately extract item-price pairs
from receipts, handling various receipt formats and layouts.
"""

import re
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass


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


def extract_bounding_box(vertices) -> Tuple[float, float, float, float]:
    """
    Extract bounding box coordinates from Vision API vertices.

    Returns:
        (x, y, width, height) where x,y is top-left corner
    """
    xs = [v.x for v in vertices]
    ys = [v.y for v in vertices]

    x = min(xs)
    y = min(ys)
    width = max(xs) - x
    height = max(ys) - y

    return (x, y, width, height)


def parse_receipt_items_v2(vision_response) -> List[Dict[str, any]]:
    """
    Parse Google Cloud Vision OCR response using bounding box coordinates.

    Strategy:
    1. Extract all text blocks with their spatial positions
    2. Identify price-like text blocks (numbers with $ or decimal format)
    3. Group text blocks into horizontal lines based on Y-coordinate
    4. For each line with a price, find the description (text to the left)
    5. Apply smart filtering to remove totals, tax, etc.

    Args:
        vision_response: Google Cloud Vision AnnotateImageResponse

    Returns:
        List of items: [{"description": str, "price": int}, ...]
    """
    if not vision_response or not vision_response.text_annotations:
        return []

    # Skip first annotation (full text), use individual word/phrase annotations
    text_blocks = []
    for annotation in vision_response.text_annotations[1:]:  # Skip [0] which is full text
        text = annotation.description.strip()
        if not text:
            continue

        vertices = annotation.bounding_poly.vertices
        x, y, width, height = extract_bounding_box(vertices)

        text_blocks.append(TextBlock(
            text=text,
            x=x,
            y=y,
            width=width,
            height=height
        ))

    if not text_blocks:
        return []

    # Group text blocks into lines based on vertical position
    lines = group_into_lines(text_blocks)

    # Extract items from lines
    items = []
    for line in lines:
        item = extract_item_from_line(line)
        if item:
            items.append(item)

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

    # Apply smart filtering
    if should_filter_item(description, line):
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
    - 12.99
    - 12,99 (European format)
    - 12 (whole dollars)

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

    # Pattern 2: 12.99 (no $, must have decimal)
    match = re.search(r'^(\d{1,3}\.\d{2})$', text)
    if match:
        return parse_price_to_cents(match.group(1))

    # Pattern 3: 12,99 (European comma decimal)
    match = re.search(r'^(\d{1,3}),(\d{2})$', text)
    if match:
        price_str = f"{match.group(1)}.{match.group(2)}"
        return parse_price_to_cents(price_str)

    # Pattern 4: Just a number on right side (likely a price)
    # Only if it's a standalone number that could be a price
    match = re.search(r'^(\d{1,3})$', text)
    if match:
        # Whole dollars (e.g., "12" -> $12.00)
        dollars = int(match.group(1))
        if 1 <= dollars <= 999:
            return dollars * 100

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

    - Removes special characters
    - Normalizes whitespace
    - Title cases for consistency
    """
    # Remove common quantity markers if they're standalone
    # But keep them if part of name (e.g., "2 for 1 Deal")
    text = re.sub(r'^(\d+)\s*x\s*', '', text, flags=re.I)  # "2x Burger" -> "Burger"

    # Remove trailing special characters
    text = re.sub(r'[*\-\.]+$', '', text)

    # Remove extra whitespace
    text = ' '.join(text.split())

    # Title case
    text = text.strip().title()

    return text


def should_filter_item(description: str, line: List[TextBlock]) -> bool:
    """
    Smart filtering to remove non-item lines (totals, tax, etc.).

    Uses context from the entire line, not just the description.

    Args:
        description: Cleaned item description
        line: All text blocks on the line

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
    ]

    for keyword in exact_filters:
        if keyword == desc_lower or keyword in line_text:
            return True

    # Filter lines that are just category headers
    if desc_lower in ['food', 'drinks', 'beverages', 'appetizers', 'entrees', 'desserts']:
        return True

    # Filter receipt metadata
    metadata_patterns = [
        r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Dates
        r'\d{1,2}:\d{2}\s?(?:am|pm)?',      # Times
        r'receipt\s*#',
        r'transaction\s*#',
        r'order\s*#',
        r'table\s*#',
        r'server:',
        r'cashier:',
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
