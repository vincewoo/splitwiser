"""LLM-based receipt parsing using OpenAI GPT-4o vision."""

import base64
import json
import os
from openai import OpenAI

SYSTEM_PROMPT = """You are a receipt parser. Given an image of a receipt, extract all purchased items.

Rules:
- Extract ONLY individual purchased items (food, drinks, goods, services).
- Do NOT include subtotal, total, tax, tip/gratuity, discounts, payment method, change, or balance lines as items.
- For each item, provide: description (item name as printed), price_cents (total line price in cents as an integer), and quantity (integer, default 1).
- If an item shows a quantity multiplier (e.g., "2x Burger $25.98" or "Burger 2 $25.98"), set quantity to that number and price_cents to the TOTAL line price (not per-unit).
- price_cents must always be a positive integer representing the total price for that line in cents. For example, $12.99 = 1299.
- Extract tax, tip, and total amounts separately if visible on the receipt.
- If the currency is not USD, still use cents (smallest unit). The user will handle currency separately.
- If you cannot read an item clearly, make your best guess and include it.
- Do NOT invent items that are not on the receipt."""

RECEIPT_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "receipt_items",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {
                                "type": "string",
                                "description": "Item name as printed on receipt"
                            },
                            "price_cents": {
                                "type": "integer",
                                "description": "Total line price in cents (e.g., $12.99 = 1299)"
                            },
                            "quantity": {
                                "type": "integer",
                                "description": "Quantity purchased, default 1"
                            }
                        },
                        "required": ["description", "price_cents", "quantity"],
                        "additionalProperties": False
                    }
                },
                "tax_cents": {
                    "type": ["integer", "null"],
                    "description": "Tax amount in cents, or null if not visible"
                },
                "tip_cents": {
                    "type": ["integer", "null"],
                    "description": "Tip/gratuity in cents, or null if not visible"
                },
                "total_cents": {
                    "type": ["integer", "null"],
                    "description": "Total amount in cents, or null if not visible"
                }
            },
            "required": ["items", "tax_cents", "tip_cents", "total_cents"],
            "additionalProperties": False
        }
    }
}


def _get_client() -> OpenAI:
    """Create OpenAI client from environment variable."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY environment variable is not set")
    return OpenAI(api_key=api_key)


def parse_receipt(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Parse a receipt image using OpenAI GPT-4o vision.

    Args:
        image_bytes: Raw image bytes
        mime_type: MIME type of the image (image/jpeg, image/png, image/webp)

    Returns:
        Dict with keys: items (list), tax_cents (int|None), tip_cents (int|None), total_cents (int|None)
        Each item has: description (str), price_cents (int), quantity (int)
    """
    client = _get_client()

    # Encode image as base64 data URL
    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    image_url = f"data:{mime_type};base64,{b64_image}"

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Extract all items from this receipt."
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url, "detail": "high"}
                    }
                ]
            }
        ],
        response_format=RECEIPT_SCHEMA,
        max_tokens=4096,
        temperature=0,
    )

    raw = response.choices[0].message.content
    result = json.loads(raw)

    # Validate items
    for item in result.get("items", []):
        if not isinstance(item.get("price_cents"), int) or item["price_cents"] < 0:
            item["price_cents"] = 0
        if not isinstance(item.get("quantity"), int) or item["quantity"] < 1:
            item["quantity"] = 1
        if not item.get("description") or not isinstance(item["description"], str):
            item["description"] = "Unknown item"

    return result
