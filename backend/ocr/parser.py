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
    r'^food$',                          # Line that just says "food"
    r'^drink',                          # Line that just says "drink/drinks"
    r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',  # Dates (MM/DD/YYYY)
    r'\d{3}[-.:]\d{3}[-.:]\d{4}',      # Phone numbers (including colon and dot)
    r'card\s*#',
    r'receipt\s*#',
    r'transaction\s*#',
    r'thank\s*you',
    r'www\.',                           # URLs
    r'\.com',                           # Domain names
    r'tbl\s+\d+',                       # Table numbers
    r'ch\s+\d+',                        # Check numbers
    r'gst\s+\d+',                       # Guest numbers
]

# Price detection patterns (in order of preference)
PRICE_PATTERNS = [
    r'\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})',           # $12.99 or $ 12.99
    r'(\d{1,3}(?:,\d{3})*\.\d{2})\s?(?:USD|usd)',  # 12.99 USD
    r'(?<!\d[-.:\d])(\d{1,3}\.\d{2})(?!\d)',       # 12.99 (not part of phone/longer number)
]


def parse_receipt_items(vision_response) -> List[Dict[str, any]]:
    """
    Parse Google Cloud Vision OCR response into items with descriptions and prices.

    Uses the full text from Vision API and parses line-by-line to extract
    item-price pairs. Filters out noise patterns (totals, tax, etc.).

    Args:
        vision_response: Google Cloud Vision AnnotateImageResponse object
                        with text_annotations list

    Returns:
        List of items: [{"description": str, "price": int}, ...]
        where price is in cents
    """
    if not vision_response or not vision_response.text_annotations:
        return []

    # Get full text from first annotation (contains entire document text)
    full_text = vision_response.text_annotations[0].description
    lines = full_text.split('\n')

    items = []

    # First pass: try same-line item/price pairs (e.g., "Burger $12.99")
    for line in lines:
        line = line.strip()
        if not line or is_noise_line(line):
            continue

        price_match, price_cents = extract_price(line)
        if price_match and price_cents and 1 <= price_cents <= 99999:
            description = clean_description(line[:price_match.start()])
            if description and len(description) >= 2:
                items.append({'description': description, 'price': price_cents})

    # If no same-line items found, try multi-line parsing
    if not items:
        pending_description = None
        for line in lines:
            line = line.strip()
            if not line or is_noise_line(line):
                continue

            price_match, price_cents = extract_price(line)
            if price_match and price_cents and 1 <= price_cents <= 99999:
                non_price_text = line[:price_match.start()].strip()
                if len(non_price_text) < 3 and pending_description:
                    # Price-only line, pair with pending description
                    items.append({'description': pending_description, 'price': price_cents})
                    pending_description = None
                elif non_price_text:
                    # Has both description and price
                    desc = clean_description(non_price_text)
                    if desc and len(desc) >= 2:
                        items.append({'description': desc, 'price': price_cents})
                    pending_description = None
            else:
                # No price - store as potential description (only last one)
                desc = clean_description(line)
                if desc and len(desc) >= 2:
                    pending_description = desc  # Replace, don't accumulate

    return items


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

    Preserves quantities but cleans formatting:
    - Keeps quantities (e.g., "2 Diet" stays as "2 Diet")
    - Removes special characters
    - Removes extra whitespace

    Args:
        text: Raw description text

    Returns:
        Cleaned description
    """
    # Remove trailing special chars
    text = re.sub(r'[\s\-*]+$', '', text)

    # Remove extra whitespace
    text = ' '.join(text.split())

    # Capitalize first letter of each word for consistency
    text = text.strip().title()

    return text
