"""
Test utility to compare old parser vs new parser V2.

This script allows testing with mock Vision API responses to validate
parser behavior without making actual API calls.
"""

from dataclasses import dataclass
from typing import List
from parser import parse_receipt_items
from parser_v2 import (
    parse_receipt_items_v2,
    extract_price_from_text,
    clean_description,
    should_filter_item,
    detect_receipt_total,
    detect_receipt_tax,
    detect_receipt_subtotal,
    parse_receipt_with_validation
)


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


def test_price_patterns():
    """Test price extraction patterns including prices without $ signs."""
    print("\n" + "=" * 80)
    print("PRICE PATTERN TESTS")
    print("=" * 80)

    test_cases = [
        # (input_text, expected_cents, description)
        ("$12.99", 1299, "Standard dollar sign price"),
        ("$ 12.99", 1299, "Dollar sign with space"),
        ("12.99", 1299, "Exact decimal without $"),
        ("GARLICBREAD 3.95", 395, "Item name followed by price"),
        ("1 Alfredo 14.95", 1495, "Quantity + item + price"),
        (" 6.00 ", 600, "Price with surrounding whitespace"),
        ("33.90", 3390, "Higher price without $"),
        ("12,99", 1299, "European comma decimal"),
        ("$1,234.56", 123456, "Price with thousands separator"),
        ("Check #49", None, "Should NOT match check numbers"),
        ("Table 12", None, "Should NOT match table numbers"),
    ]

    passed = 0
    failed = 0

    for input_text, expected, description in test_cases:
        result = extract_price_from_text(input_text)
        status = "✅ PASS" if result == expected else "❌ FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"  {status}: {description}")
        print(f"         Input: '{input_text}' -> Got: {result}, Expected: {expected}")

    print(f"\n  Results: {passed} passed, {failed} failed")
    return failed == 0


def test_quantity_preservation():
    """Test that quantity prefixes are preserved in descriptions."""
    print("\n" + "=" * 80)
    print("QUANTITY PRESERVATION TESTS")
    print("=" * 80)

    test_cases = [
        # (input_text, expected_output, description)
        ("2 Diet", "2 Diet", "Simple quantity preserved"),
        ("4 Pint Guinness", "4 Pint Guinness", "Quantity with multi-word item"),
        ("1 GARLICBREAD", "1 Garlicbread", "Single quantity (title cased)"),
        ("2x Burger", "2 Burger", "Multiplication syntax normalized"),
        ("2X Pizza", "2 Pizza", "Uppercase X normalized"),
        ("2 for 1 Deal", "2 For 1 Deal", "Quantity in item name preserved"),
    ]

    passed = 0
    failed = 0

    for input_text, expected, description in test_cases:
        result = clean_description(input_text)
        status = "✅ PASS" if result == expected else "❌ FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"  {status}: {description}")
        print(f"         Input: '{input_text}' -> Got: '{result}', Expected: '{expected}'")

    print(f"\n  Results: {passed} passed, {failed} failed")
    return failed == 0


def test_category_subtotal_filtering():
    """Test smart filtering of category subtotals vs real items."""
    print("\n" + "=" * 80)
    print("CATEGORY SUBTOTAL FILTERING TESTS")
    print("=" * 80)

    # Mock a simple line for testing
    class MockBlock:
        def __init__(self, text):
            self.text = text

    test_cases = [
        # (description, price_cents, should_be_filtered, reason)
        ("Food", 7975, True, "Single-word 'Food' with high price = subtotal"),
        ("Food", 1299, False, "Single-word 'Food' with low price = could be item"),
        ("Food Court Combo", 1299, False, "Multi-word with 'Food' = real item"),
        ("Drinks", 5000, True, "Single-word 'Drinks' with high price = subtotal"),
        ("Beverages", 3500, True, "Single-word 'Beverages' with high price = subtotal"),
        ("Subtotal", 8000, True, "Subtotal keyword always filtered"),
        ("Total", 9000, True, "Total keyword always filtered"),
        ("Tax", 778, True, "Tax keyword always filtered"),
        ("Admin Fee", 711, True, "Admin Fee keyword filtered"),
        ("Admin Fee ( 3.00 % )", 711, True, "Admin Fee with percentage filtered"),
        ("Service Fee", 500, True, "Service Fee keyword filtered"),
        ("Convenience Fee", 300, True, "Convenience Fee keyword filtered"),
        ("Processing Fee", 250, True, "Processing Fee keyword filtered"),
        ("Burger", 1299, False, "Regular item not filtered"),
        ("Caesar Salad", 1499, False, "Regular multi-word item not filtered"),
    ]

    passed = 0
    failed = 0

    for description, price_cents, expected_filtered, reason in test_cases:
        mock_line = [MockBlock(description), MockBlock(f"${price_cents/100:.2f}")]
        result = should_filter_item(description, mock_line, price_cents)
        status = "✅ PASS" if result == expected_filtered else "❌ FAIL"
        if result == expected_filtered:
            passed += 1
        else:
            failed += 1
        print(f"  {status}: {reason}")
        print(f"         '{description}' ${price_cents/100:.2f} -> Filtered: {result}, Expected: {expected_filtered}")

    print(f"\n  Results: {passed} passed, {failed} failed")
    return failed == 0


def test_total_detection():
    """Test detection of receipt totals from raw text."""
    print("\n" + "=" * 80)
    print("RECEIPT TOTAL DETECTION TESTS")
    print("=" * 80)

    test_cases = [
        # (raw_text, expected_total_cents, description)
        ("Total $145.86", 14586, "Standard 'Total $X.XX'"),
        ("TOTAL DUE 87.53", 8753, "Uppercase 'TOTAL DUE X.XX'"),
        ("Amount Due: $50.00", 5000, "Amount Due with colon"),
        ("Grand Total $1,234.56", 123456, "Grand total with thousands"),
        ("Balance Due $25.00", 2500, "Balance Due format"),
        ("Just some random text", None, "No total present"),
        ("Subtotal $50.00\nTax $5.00\nTotal $55.00", 5500, "Full receipt finds Total"),
        ("Total $61.50\nSales tax $5.51\nGrand Total $67.01", 6701, "Grand Total preferred over Total"),
    ]

    passed = 0
    failed = 0

    for raw_text, expected, description in test_cases:
        result = detect_receipt_total(raw_text)
        status = "✅ PASS" if result == expected else "❌ FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"  {status}: {description}")
        print(f"         Got: {result}, Expected: {expected}")

    print(f"\n  Results: {passed} passed, {failed} failed")
    return failed == 0


def test_tax_detection():
    """Test detection of tax amounts from raw text."""
    print("\n" + "=" * 80)
    print("TAX DETECTION TESTS")
    print("=" * 80)

    test_cases = [
        # (raw_text, expected_tax_cents, description)
        ("Tax $7.78", 778, "Standard 'Tax $X.XX'"),
        ("TAX: 13.86", 1386, "Uppercase TAX with colon"),
        ("Sales Tax $5.00", 500, "Sales Tax format"),
        ("GST $10.00", 1000, "GST format"),
        ("HST $15.00", 1500, "HST format"),
        ("VAT $20.00", 2000, "VAT format"),
        ("No tax here", None, "No tax present"),
    ]

    passed = 0
    failed = 0

    for raw_text, expected, description in test_cases:
        result = detect_receipt_tax(raw_text)
        status = "✅ PASS" if result == expected else "❌ FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"  {status}: {description}")
        print(f"         Got: {result}, Expected: {expected}")

    print(f"\n  Results: {passed} passed, {failed} failed")
    return failed == 0


def test_subtotal_detection():
    """Test detection of subtotals from raw text."""
    print("\n" + "=" * 80)
    print("SUBTOTAL DETECTION TESTS")
    print("=" * 80)

    test_cases = [
        # (raw_text, expected_subtotal_cents, description)
        ("Subtotal $114.00", 11400, "Standard 'Subtotal $X.XX'"),
        ("SubTotal: 114.00", 11400, "CamelCase SubTotal with colon"),
        ("Sub Total $50.00", 5000, "Sub Total with space"),
        ("Sub-total $75.50", 7550, "Sub-total with hyphen"),
        ("SUBTOTAL $200.00", 20000, "Uppercase SUBTOTAL"),
        ("subtotal 45.99", 4599, "Lowercase without $"),
        ("Just some random text", None, "No subtotal present"),
        ("Total $100.00", None, "Total without Sub prefix"),
    ]

    passed = 0
    failed = 0

    for raw_text, expected, description in test_cases:
        result = detect_receipt_subtotal(raw_text)
        status = "✅ PASS" if result == expected else "❌ FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"  {status}: {description}")
        print(f"         Got: {result}, Expected: {expected}")

    print(f"\n  Results: {passed} passed, {failed} failed")
    return failed == 0


def run_all_unit_tests():
    """Run all unit tests for parser functions."""
    print("\n" + "=" * 80)
    print("RUNNING ALL UNIT TESTS")
    print("=" * 80)

    results = []
    results.append(("Price Patterns", test_price_patterns()))
    results.append(("Quantity Preservation", test_quantity_preservation()))
    results.append(("Category Subtotal Filtering", test_category_subtotal_filtering()))
    results.append(("Total Detection", test_total_detection()))
    results.append(("Tax Detection", test_tax_detection()))
    results.append(("Subtotal Detection", test_subtotal_detection()))

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    all_passed = True
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status}: {name}")
        if not passed:
            all_passed = False

    if all_passed:
        print("\n🎉 All tests passed!")
    else:
        print("\n⚠️  Some tests failed!")

    return all_passed


if __name__ == "__main__":
    run_comparison_test()
    run_all_unit_tests()
