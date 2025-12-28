"""
Test utility to compare old parser vs new parser V2.

This script allows testing with mock Vision API responses to validate
parser behavior without making actual API calls.
"""

from dataclasses import dataclass
from typing import List
from parser import parse_receipt_items
from parser_v2 import parse_receipt_items_v2


@dataclass
class MockVertex:
    """Mock bounding polygon vertex."""
    x: int
    y: int


@dataclass
class MockBoundingPoly:
    """Mock bounding polygon."""
    vertices: List[MockVertex]


@dataclass
class MockAnnotation:
    """Mock text annotation from Vision API."""
    description: str
    bounding_poly: MockBoundingPoly


@dataclass
class MockVisionResponse:
    """Mock Vision API response."""
    text_annotations: List[MockAnnotation]


def create_mock_receipt_1():
    """
    Create mock receipt with simple layout:

    Burger          $12.99
    Fries           $4.99
    Drink           $2.99
    Subtotal        $20.97
    Tax             $1.68
    Total           $22.65
    """
    # Full text (first annotation)
    full_text = """Burger          $12.99
Fries           $4.99
Drink           $2.99
Subtotal        $20.97
Tax             $1.68
Total           $22.65"""

    # Individual word annotations with bounding boxes
    annotations = [
        # Full text
        MockAnnotation(full_text, MockBoundingPoly([
            MockVertex(0, 0),
            MockVertex(300, 0),
            MockVertex(300, 200),
            MockVertex(0, 200)
        ])),

        # Line 1: Burger $12.99
        MockAnnotation("Burger", MockBoundingPoly([
            MockVertex(10, 10),
            MockVertex(100, 10),
            MockVertex(100, 30),
            MockVertex(10, 30)
        ])),
        MockAnnotation("$12.99", MockBoundingPoly([
            MockVertex(200, 10),
            MockVertex(280, 10),
            MockVertex(280, 30),
            MockVertex(200, 30)
        ])),

        # Line 2: Fries $4.99
        MockAnnotation("Fries", MockBoundingPoly([
            MockVertex(10, 40),
            MockVertex(80, 40),
            MockVertex(80, 60),
            MockVertex(10, 60)
        ])),
        MockAnnotation("$4.99", MockBoundingPoly([
            MockVertex(200, 40),
            MockVertex(280, 40),
            MockVertex(280, 60),
            MockVertex(200, 60)
        ])),

        # Line 3: Drink $2.99
        MockAnnotation("Drink", MockBoundingPoly([
            MockVertex(10, 70),
            MockVertex(90, 70),
            MockVertex(90, 90),
            MockVertex(10, 90)
        ])),
        MockAnnotation("$2.99", MockBoundingPoly([
            MockVertex(200, 70),
            MockVertex(280, 70),
            MockVertex(280, 90),
            MockVertex(200, 90)
        ])),

        # Line 4: Subtotal $20.97 (should be filtered)
        MockAnnotation("Subtotal", MockBoundingPoly([
            MockVertex(10, 100),
            MockVertex(120, 100),
            MockVertex(120, 120),
            MockVertex(10, 120)
        ])),
        MockAnnotation("$20.97", MockBoundingPoly([
            MockVertex(200, 100),
            MockVertex(280, 100),
            MockVertex(280, 120),
            MockVertex(200, 120)
        ])),

        # Line 5: Tax $1.68 (should be filtered)
        MockAnnotation("Tax", MockBoundingPoly([
            MockVertex(10, 130),
            MockVertex(60, 130),
            MockVertex(60, 150),
            MockVertex(10, 150)
        ])),
        MockAnnotation("$1.68", MockBoundingPoly([
            MockVertex(200, 130),
            MockVertex(280, 130),
            MockVertex(280, 150),
            MockVertex(200, 150)
        ])),

        # Line 6: Total $22.65 (should be filtered)
        MockAnnotation("Total", MockBoundingPoly([
            MockVertex(10, 160),
            MockVertex(80, 160),
            MockVertex(80, 180),
            MockVertex(10, 180)
        ])),
        MockAnnotation("$22.65", MockBoundingPoly([
            MockVertex(200, 160),
            MockVertex(280, 160),
            MockVertex(280, 180),
            MockVertex(200, 180)
        ])),
    ]

    return MockVisionResponse(annotations)


def create_mock_receipt_2():
    """
    Create mock receipt with problematic layout for old parser:

    Caesar          Salad           $14.99
    Chicken         Wings           $9.99
    Food Court      Combo           $12.99
    """
    # Full text - note items are split across "lines" oddly
    full_text = """Caesar
Salad           $14.99
Chicken
Wings           $9.99
Food Court
Combo           $12.99"""

    # Individual word annotations with bounding boxes
    annotations = [
        # Full text
        MockAnnotation(full_text, MockBoundingPoly([
            MockVertex(0, 0),
            MockVertex(300, 0),
            MockVertex(300, 200),
            MockVertex(0, 200)
        ])),

        # Line 1: Caesar Salad $14.99 (but split in full text)
        MockAnnotation("Caesar", MockBoundingPoly([
            MockVertex(10, 10),
            MockVertex(90, 10),
            MockVertex(90, 30),
            MockVertex(10, 30)
        ])),
        MockAnnotation("Salad", MockBoundingPoly([
            MockVertex(100, 10),
            MockVertex(170, 10),
            MockVertex(170, 30),
            MockVertex(100, 30)
        ])),
        MockAnnotation("$14.99", MockBoundingPoly([
            MockVertex(200, 10),
            MockVertex(280, 10),
            MockVertex(280, 30),
            MockVertex(200, 30)
        ])),

        # Line 2: Chicken Wings $9.99 (split in full text)
        MockAnnotation("Chicken", MockBoundingPoly([
            MockVertex(10, 40),
            MockVertex(100, 40),
            MockVertex(100, 60),
            MockVertex(10, 60)
        ])),
        MockAnnotation("Wings", MockBoundingPoly([
            MockVertex(110, 40),
            MockVertex(180, 40),
            MockVertex(180, 60),
            MockVertex(110, 60)
        ])),
        MockAnnotation("$9.99", MockBoundingPoly([
            MockVertex(200, 40),
            MockVertex(280, 40),
            MockVertex(280, 60),
            MockVertex(200, 60)
        ])),

        # Line 3: Food Court Combo $12.99 (contains "Food" - might be filtered by old parser)
        MockAnnotation("Food", MockBoundingPoly([
            MockVertex(10, 70),
            MockVertex(70, 70),
            MockVertex(70, 90),
            MockVertex(10, 90)
        ])),
        MockAnnotation("Court", MockBoundingPoly([
            MockVertex(80, 70),
            MockVertex(140, 70),
            MockVertex(140, 90),
            MockVertex(80, 90)
        ])),
        MockAnnotation("Combo", MockBoundingPoly([
            MockVertex(150, 70),
            MockVertex(220, 70),
            MockVertex(220, 90),
            MockVertex(150, 90)
        ])),
        MockAnnotation("$12.99", MockBoundingPoly([
            MockVertex(200, 70),
            MockVertex(280, 70),
            MockVertex(280, 90),
            MockVertex(200, 90)
        ])),
    ]

    return MockVisionResponse(annotations)


def run_comparison_test():
    """Run comparison between old and new parser."""

    test_cases = [
        ("Simple Receipt", create_mock_receipt_1(), 3),  # Burger, Fries, Drink
        ("Multi-word Items", create_mock_receipt_2(), 3),  # Caesar Salad, Chicken Wings, Food Court Combo
    ]

    print("=" * 80)
    print("PARSER COMPARISON TEST")
    print("=" * 80)

    for test_name, mock_response, expected_count in test_cases:
        print(f"\n📝 Test: {test_name}")
        print("-" * 80)

        # Run old parser
        items_old = parse_receipt_items(mock_response)
        print(f"\n[OLD PARSER] Found {len(items_old)} items:")
        for item in items_old:
            print(f"  - {item['description']}: ${item['price']/100:.2f}")

        # Run new parser
        items_v2 = parse_receipt_items_v2(mock_response)
        print(f"\n[NEW PARSER V2] Found {len(items_v2)} items:")
        for item in items_v2:
            print(f"  - {item['description']}: ${item['price']/100:.2f}")

        # Analysis
        print(f"\n📊 Analysis:")
        print(f"  Expected: {expected_count} items")
        print(f"  Old Parser: {len(items_old)} items ({'✅ PASS' if len(items_old) == expected_count else '❌ FAIL'})")
        print(f"  New Parser: {len(items_v2)} items ({'✅ PASS' if len(items_v2) == expected_count else '❌ FAIL'})")

        if len(items_v2) > len(items_old):
            print(f"  🎯 V2 found {len(items_v2) - len(items_old)} more items!")
        elif len(items_old) > len(items_v2):
            print(f"  ⚠️  Old parser found {len(items_old) - len(items_v2)} more items")
        else:
            print(f"  ℹ️  Both parsers found same number of items")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    run_comparison_test()
