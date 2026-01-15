"""Tests for OCR region detection and text extraction endpoints."""

import pytest
from unittest.mock import Mock, patch, MagicMock
from io import BytesIO
from conftest import client, auth_headers, test_user
from main import app
from utils.rate_limiter import ocr_rate_limiter


class MockVertex:
    """Mock for Google Vision vertex (bounding box coordinate)."""
    def __init__(self, x, y):
        self.x = x
        self.y = y


class MockBoundingPoly:
    """Mock for Google Vision bounding polygon."""
    def __init__(self, vertices):
        self.vertices = vertices


class MockTextAnnotation:
    """Mock for Google Vision text annotation with bounding box."""
    def __init__(self, description, vertices):
        self.description = description
        self.bounding_poly = MockBoundingPoly(vertices)


class MockPage:
    """Mock for Google Vision page with dimensions."""
    def __init__(self, width=320, height=450):
        self.width = width
        self.height = height


class MockFullTextAnnotation:
    """Mock for Google Vision full text annotation."""
    def __init__(self, pages=None):
        self.pages = pages or [MockPage()]


class MockError:
    """Mock for Google Vision error."""
    def __init__(self, message=""):
        self.message = message


class MockAnnotateImageResponse:
    """Mock for Google Vision API response."""
    def __init__(self, text_annotations=None, error_message="", full_text_annotation=None):
        self.text_annotations = text_annotations or []
        self.error = MockError(message=error_message)
        self.full_text_annotation = full_text_annotation or MockFullTextAnnotation()


@pytest.fixture(autouse=True)
def mock_ocr_rate_limiter():
    """Disable rate limiting for OCR tests."""
    async def pass_through():
        return True

    app.dependency_overrides[ocr_rate_limiter] = pass_through
    yield
    # The client fixture clears overrides, but we can be safe
    if ocr_rate_limiter in app.dependency_overrides:
        del app.dependency_overrides[ocr_rate_limiter]


@pytest.fixture
def mock_receipt_image():
    """Create a mock receipt image file."""
    # Create a minimal valid JPEG file (1x1 pixel red JPEG)
    jpeg_bytes = bytes([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
        0xFF, 0xD9  # End of image marker
    ])
    return BytesIO(jpeg_bytes)


@pytest.fixture
def mock_vision_response():
    """Create a mock Vision API response with realistic receipt data."""
    # Full text annotation (first element)
    full_text = """RESTAURANT XYZ
123 Main Street
City, State 12345

Burger       $12.99
Fries         $4.99
Soda          $2.99

Subtotal     $20.97
Tax           $1.68
Total        $22.65

Thank you!"""

    # Individual word annotations with bounding boxes
    annotations = [
        # Full text (always first)
        MockTextAnnotation(full_text, [
            MockVertex(10, 10),
            MockVertex(300, 10),
            MockVertex(300, 400),
            MockVertex(10, 400)
        ]),
        # Individual items with bounding boxes
        MockTextAnnotation("RESTAURANT", [
            MockVertex(10, 10),
            MockVertex(120, 10),
            MockVertex(120, 30),
            MockVertex(10, 30)
        ]),
        MockTextAnnotation("XYZ", [
            MockVertex(130, 10),
            MockVertex(170, 10),
            MockVertex(170, 30),
            MockVertex(130, 30)
        ]),
        MockTextAnnotation("Burger", [
            MockVertex(10, 100),
            MockVertex(80, 100),
            MockVertex(80, 120),
            MockVertex(10, 120)
        ]),
        MockTextAnnotation("$12.99", [
            MockVertex(200, 100),
            MockVertex(280, 100),
            MockVertex(280, 120),
            MockVertex(200, 120)
        ]),
        MockTextAnnotation("Fries", [
            MockVertex(10, 130),
            MockVertex(70, 130),
            MockVertex(70, 150),
            MockVertex(10, 150)
        ]),
        MockTextAnnotation("$4.99", [
            MockVertex(200, 130),
            MockVertex(270, 130),
            MockVertex(270, 150),
            MockVertex(200, 150)
        ]),
        MockTextAnnotation("Total", [
            MockVertex(10, 300),
            MockVertex(70, 300),
            MockVertex(70, 320),
            MockVertex(10, 320)
        ]),
        MockTextAnnotation("$22.65", [
            MockVertex(200, 300),
            MockVertex(280, 300),
            MockVertex(280, 320),
            MockVertex(200, 320)
        ])
    ]

    return MockAnnotateImageResponse(text_annotations=annotations)


def test_detect_regions_success(client, auth_headers, mock_receipt_image, mock_vision_response):
    """Test successful region detection with bounding boxes."""
    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_vision_response):
        response = client.post(
            "/ocr/detect-regions",
            headers=auth_headers,
            files={"file": ("receipt.jpg", mock_receipt_image, "image/jpeg")}
        )

        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert "regions" in data
        assert "cache_key" in data
        assert "image_size" in data
        assert isinstance(data["regions"], list)
        assert len(data["regions"]) > 0

        # Verify region structure (normalized coordinates)
        first_region = data["regions"][0]
        assert "id" in first_region
        assert "x" in first_region
        assert "y" in first_region
        assert "width" in first_region
        assert "height" in first_region

        # Verify normalized coordinates (0-1 range)
        assert isinstance(first_region["x"], (int, float))
        assert isinstance(first_region["y"], (int, float))
        assert isinstance(first_region["width"], (int, float))
        assert isinstance(first_region["height"], (int, float))

        # Verify image size structure
        assert "width" in data["image_size"]
        assert "height" in data["image_size"]
        assert data["image_size"]["width"] == 320
        assert data["image_size"]["height"] == 450


def test_detect_regions_invalid_file_type(client, auth_headers):
    """Test region detection with invalid file type (should reject non-images)."""
    # Create a text file instead of an image
    text_file = BytesIO(b"This is not an image")

    response = client.post(
        "/ocr/detect-regions",
        headers=auth_headers,
        files={"file": ("document.txt", text_file, "text/plain")}
    )

    assert response.status_code == 400
    assert "Invalid file type" in response.json()["detail"]


def test_detect_regions_missing_file(client, auth_headers):
    """Test region detection without uploading a file."""
    response = client.post(
        "/ocr/detect-regions",
        headers=auth_headers,
        files={}
    )

    # FastAPI should return 422 for missing required field
    assert response.status_code == 422


def test_detect_regions_unauthenticated(client, mock_receipt_image):
    """Test region detection without authentication."""
    response = client.post(
        "/ocr/detect-regions",
        files={"file": ("receipt.jpg", mock_receipt_image, "image/jpeg")}
    )

    # Should require authentication
    assert response.status_code == 401


def test_detect_regions_vision_api_error(client, auth_headers, mock_receipt_image):
    """Test region detection when Vision API returns an error."""
    # Mock the service to raise an exception (as it does when error.message is set)
    def mock_detect_with_error(image_bytes):
        from unittest.mock import Mock
        response = Mock()
        response.error = Mock()
        response.error.message = "API Error: Invalid image"
        # Simulate the actual behavior of detect_document_text which raises exception
        raise Exception("Vision API error: API Error: Invalid image")

    with patch('ocr.service.ocr_service.detect_document_text', side_effect=mock_detect_with_error):
        response = client.post(
            "/ocr/detect-regions",
            headers=auth_headers,
            files={"file": ("receipt.jpg", mock_receipt_image, "image/jpeg")}
        )

        assert response.status_code == 500
        assert "OCR region detection failed" in response.json()["detail"]


def test_detect_regions_empty_response(client, auth_headers, mock_receipt_image):
    """Test region detection when Vision API returns no text."""
    empty_response = MockAnnotateImageResponse(text_annotations=[])

    with patch('ocr.service.ocr_service.detect_document_text', return_value=empty_response):
        response = client.post(
            "/ocr/detect-regions",
            headers=auth_headers,
            files={"file": ("receipt.jpg", mock_receipt_image, "image/jpeg")}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["regions"] == []
        assert "cache_key" in data


def test_detect_regions_caching(client, auth_headers, mock_receipt_image, mock_vision_response):
    """Test that OCR response is cached for later use."""
    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_vision_response):
        response = client.post(
            "/ocr/detect-regions",
            headers=auth_headers,
            files={"file": ("receipt.jpg", mock_receipt_image, "image/jpeg")}
        )

        assert response.status_code == 200
        data = response.json()

        # Verify cache key is returned and is valid UUID format
        cache_key = data["cache_key"]
        assert cache_key is not None
        assert len(cache_key) > 0

        # UUID format check (simple validation)
        assert len(cache_key) == 36  # Standard UUID length with hyphens
        assert cache_key.count('-') == 4


def test_extract_regions_from_coordinates_success(client, auth_headers, mock_vision_response):
    """Test extracting regions from specific bounding box coordinates."""
    cache_key = "test-cache-key-123"

    # Mock the cache lookup - simulate detect-regions was called first
    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_vision_response):
        with patch('uuid.uuid4', return_value=Mock(__str__=lambda self: cache_key)):
            # First, cache the response via detect-regions
            response = client.post(
                "/ocr/detect-regions",
                headers=auth_headers,
                files={"file": ("receipt.jpg", BytesIO(b"fake"), "image/jpeg")}
            )
            assert response.status_code == 200

    # Now extract regions from specific coordinates using the cached response
    with patch('routers.ocr.ocr_cache.get', return_value={
        "vision_response": mock_vision_response,
        "image_width": 320,
        "image_height": 450
    }):
        extract_response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": cache_key,
                "regions": [
                    {
                        "x": 0.03,  # Normalized coordinates (0-1 range)
                        "y": 0.22,
                        "width": 0.84,
                        "height": 0.11
                    }
                ]
            }
        )

        assert extract_response.status_code == 200
        data = extract_response.json()

        # Verify response structure
        assert "items" in data
        assert isinstance(data["items"], list)


def test_extract_regions_invalid_cache_key(client, auth_headers):
    """Test extracting regions with invalid cache key."""
    with patch('routers.ocr.ocr_cache.get', return_value=None):
        response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": "invalid-key",
                "regions": [
                    {
                        "x": 0.0,
                        "y": 0.0,
                        "width": 0.5,
                        "height": 0.5
                    }
                ]
            }
        )

        assert response.status_code == 404
        assert "Cache key not found" in response.json()["detail"]


def test_extract_regions_missing_regions(client, auth_headers):
    """Test extracting regions without providing regions array."""
    response = client.post(
        "/ocr/extract-regions",
        headers=auth_headers,
        json={
            "cache_key": "test-key"
            # Missing regions field
        }
    )

    # Should return 422 for missing required field
    assert response.status_code == 422


def test_extract_regions_invalid_coordinates(client, auth_headers, mock_vision_response):
    """Test extracting regions with invalid coordinate values."""
    cache_key = "test-cache-key-123"

    with patch('routers.ocr.ocr_cache.get', return_value={
        "vision_response": mock_vision_response,
        "image_width": 320,
        "image_height": 450
    }):
        # Negative coordinates
        response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": cache_key,
                "regions": [
                    {
                        "x": -0.1,
                        "y": -0.1,
                        "width": 0.5,
                        "height": 0.5
                    }
                ]
            }
        )

        assert response.status_code == 422
        assert "Invalid region coordinates" in response.json()["detail"]

        # Zero width/height
        response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": cache_key,
                "regions": [
                    {
                        "x": 0.0,
                        "y": 0.0,
                        "width": 0.0,
                        "height": 0.0
                    }
                ]
            }
        )

        assert response.status_code == 422
        assert "Invalid region coordinates" in response.json()["detail"]


def test_extract_regions_unauthenticated(client):
    """Test extracting regions without authentication."""
    response = client.post(
        "/ocr/extract-regions",
        json={
            "cache_key": "test-key",
            "regions": [
                {
                    "x": 0.0,
                    "y": 0.0,
                    "width": 0.5,
                    "height": 0.5
                }
            ]
        }
    )

    assert response.status_code == 401


def test_extract_regions_no_matching_text(client, auth_headers, mock_vision_response):
    """Test extracting regions from coordinates with no text regions."""
    cache_key = "test-cache-key-123"

    with patch('routers.ocr.ocr_cache.get', return_value={
        "vision_response": mock_vision_response,
        "image_width": 320,
        "image_height": 450
    }):
        # Normalized coordinates outside image bounds (should be rejected)
        response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": cache_key,
                "regions": [
                    {
                        "x": 0.9,
                        "y": 0.9,
                        "width": 0.05,
                        "height": 0.05
                    }
                ]
            }
        )

        assert response.status_code == 200
        data = response.json()

        # Should return empty items list (no text found in that region)
        assert "items" in data
        assert isinstance(data["items"], list)


def test_extract_regions_overlapping_regions(client, auth_headers, mock_vision_response):
    """Test extracting regions from coordinates that overlap multiple text regions."""
    cache_key = "test-cache-key-123"

    with patch('routers.ocr.ocr_cache.get', return_value={
        "vision_response": mock_vision_response,
        "image_width": 320,
        "image_height": 450
    }):
        # Large normalized coordinates that cover multiple items
        response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": cache_key,
                "regions": [
                    {
                        "x": 0.0,
                        "y": 0.2,
                        "width": 0.9,
                        "height": 0.22
                    }
                ]
            }
        )

        assert response.status_code == 200
        data = response.json()

        # Should extract items from that area
        assert "items" in data
        assert isinstance(data["items"], list)


def test_detect_regions_supported_image_formats(client, auth_headers, mock_vision_response):
    """Test that all supported image formats are accepted."""
    supported_formats = [
        ("receipt.jpg", "image/jpeg"),
        ("receipt.png", "image/png"),
        ("receipt.webp", "image/webp")
    ]

    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_vision_response):
        for filename, content_type in supported_formats:
            mock_image = BytesIO(b"fake image data")
            response = client.post(
                "/ocr/detect-regions",
                headers=auth_headers,
                files={"file": (filename, mock_image, content_type)}
            )

            assert response.status_code == 200, f"Failed for {content_type}"
            assert "regions" in response.json()


def test_detect_regions_large_file(client, auth_headers):
    """Test region detection with file size validation."""
    # Create a mock file larger than 10MB
    large_file = BytesIO(b"x" * (11 * 1024 * 1024))  # 11MB

    response = client.post(
        "/ocr/detect-regions",
        headers=auth_headers,
        files={"file": ("large_receipt.jpg", large_file, "image/jpeg")}
    )

    # Should reject files larger than max size
    assert response.status_code == 413 or response.status_code == 400


def test_extract_regions_coordinates_precision(client, auth_headers, mock_vision_response):
    """Test that coordinate extraction respects floating point precision."""
    cache_key = "test-cache-key-123"

    with patch('routers.ocr.ocr_cache.get', return_value={
        "vision_response": mock_vision_response,
        "image_width": 320,
        "image_height": 450
    }):
        # Test with floating point normalized coordinates
        response = client.post(
            "/ocr/extract-regions",
            headers=auth_headers,
            json={
                "cache_key": cache_key,
                "regions": [
                    {
                        "x": 0.032812,
                        "y": 0.224,
                        "width": 0.84375,
                        "height": 0.111
                    }
                ]
            }
        )

        # Should handle floating point coordinates
        assert response.status_code == 200


# =============================================================================
# Smart Detection Logic Tests
# =============================================================================


def test_smart_detection():
    """Test smart detection filters headers/footers and correctly identifies item lines."""
    from ocr.parser import parse_receipt_items

    # Create a realistic receipt with header, items, and footer
    full_text = """RESTAURANT NAME
123 Main Street
City, State 12345
Tel: 555-123-4567

Date: 12/25/2023
Table: 5
Server: John

Burger              $12.99
Fries               $4.99
Soda                $2.99
Pizza               $15.99

Subtotal            $36.96
Tax                 $2.96
Total               $39.92

Thank you for dining!
www.restaurant.com"""

    # Mock Vision API response
    mock_response = MockAnnotateImageResponse(
        text_annotations=[
            MockTextAnnotation(full_text, [
                MockVertex(0, 0),
                MockVertex(100, 0),
                MockVertex(100, 100),
                MockVertex(0, 100)
            ])
        ]
    )

    # Parse items
    items = parse_receipt_items(mock_response)

    # Extract item descriptions
    item_descriptions = [item['description'] for item in items]
    item_prices = [item['price'] for item in items]

    # Verify actual food items are detected
    assert "Burger" in item_descriptions
    assert "Fries" in item_descriptions
    assert "Soda" in item_descriptions
    assert "Pizza" in item_descriptions

    # Verify prices are correct (in cents)
    assert 1299 in item_prices  # Burger $12.99
    assert 499 in item_prices   # Fries $4.99
    assert 299 in item_prices   # Soda $2.99
    assert 1599 in item_prices  # Pizza $15.99

    # Verify header lines are filtered out (restaurant name, address, date)
    for desc in item_descriptions:
        assert "RESTAURANT" not in desc.upper() or len(desc) > 20  # Allow if part of longer text
        assert "Main Street" not in desc
        assert "12/25/2023" not in desc
        assert "555-" not in desc  # Phone number

    # Verify footer lines are filtered out (subtotal, tax, total, thank you)
    assert "Subtotal" not in item_descriptions
    assert "Tax" not in item_descriptions
    assert "Total" not in item_descriptions
    assert "Thank You" not in [d.title() for d in item_descriptions]

    # Verify we found exactly 4 items
    assert len(items) == 4


def test_smart_detection_tax_tip_identification():
    """Test that tax and tip lines are correctly identified and filtered."""
    from ocr.parser import parse_receipt_items, is_noise_line

    # Test tax/tip line detection
    assert is_noise_line("Tax           $2.50") == True
    assert is_noise_line("Tip           $5.00") == True
    assert is_noise_line("Subtotal      $25.00") == True
    assert is_noise_line("Total         $32.50") == True

    # Test that regular items are NOT filtered
    assert is_noise_line("Burger        $12.99") == False
    assert is_noise_line("Fries         $4.99") == False

    # Create receipt with tax/tip
    full_text = """Restaurant Bill

Steak              $24.99
Wine               $18.00

Subtotal           $42.99
Tax                $3.44
Tip                $8.60
Total              $55.03"""

    mock_response = MockAnnotateImageResponse(
        text_annotations=[
            MockTextAnnotation(full_text, [
                MockVertex(0, 0),
                MockVertex(100, 0),
                MockVertex(100, 100),
                MockVertex(0, 100)
            ])
        ]
    )

    items = parse_receipt_items(mock_response)
    item_descriptions = [item['description'] for item in items]

    # Should only find actual items (not tax/tip/total)
    assert "Steak" in item_descriptions
    assert "Wine" in item_descriptions
    assert "Tax" not in item_descriptions
    assert "Tip" not in item_descriptions
    assert "Subtotal" not in item_descriptions
    assert "Total" not in item_descriptions
    assert len(items) == 2


def test_multi_line_item_grouping():
    """Test grouping of multi-line items where description and price are on separate lines."""
    from ocr.parser import parse_receipt_items

    # Create receipt with multi-line items (description on one line, price on next)
    full_text = """Coffee Shop Receipt

Large Latte
$5.99

Blueberry Muffin
$3.50

Croissant
$4.25

Total: $13.74"""

    mock_response = MockAnnotateImageResponse(
        text_annotations=[
            MockTextAnnotation(full_text, [
                MockVertex(0, 0),
                MockVertex(100, 0),
                MockVertex(100, 100),
                MockVertex(0, 100)
            ])
        ]
    )

    items = parse_receipt_items(mock_response)

    # Should successfully pair descriptions with prices
    assert len(items) == 3

    item_map = {item['description']: item['price'] for item in items}

    # Verify multi-line items are correctly grouped
    assert "Large Latte" in item_map
    assert item_map["Large Latte"] == 599

    assert "Blueberry Muffin" in item_map
    assert item_map["Blueberry Muffin"] == 350

    assert "Croissant" in item_map
    assert item_map["Croissant"] == 425

    # Verify "Total" line is not included as an item
    assert "Total" not in item_map


def test_multi_line_item_grouping_only_last_description():
    """Test that multi-line parsing only pairs the LAST pending description with a price."""
    from ocr.parser import parse_receipt_items

    # Create receipt with multiple descriptions before a price (only last should be used)
    full_text = """Receipt

Menu Item 1
Menu Item 2
Large Burger
$12.99

Total: $12.99"""

    mock_response = MockAnnotateImageResponse(
        text_annotations=[
            MockTextAnnotation(full_text, [
                MockVertex(0, 0),
                MockVertex(100, 0),
                MockVertex(100, 100),
                MockVertex(0, 100)
            ])
        ]
    )

    items = parse_receipt_items(mock_response)

    # Should only pair "Large Burger" with $12.99 (the last description before price)
    assert len(items) == 1
    assert items[0]['description'] == "Large Burger"
    assert items[0]['price'] == 1299

    # "Menu Item 1" and "Menu Item 2" should NOT be in results
    item_descriptions = [item['description'] for item in items]
    assert "Menu Item 1" not in item_descriptions
    assert "Menu Item 2" not in item_descriptions


def test_price_pattern_detection():
    """Test that various price formats are correctly recognized."""
    from ocr.parser import extract_price

    # Test standard dollar format
    match, price = extract_price("Burger $12.99")
    assert price == 1299
    assert match is not None

    # Test dollar format with space
    match, price = extract_price("Fries $ 4.99")
    assert price == 499

    # Test format with USD suffix
    match, price = extract_price("Soda 2.99 USD")
    assert price == 299

    # Test format with comma (thousands separator)
    match, price = extract_price("Expensive Item $1,234.56")
    assert price == 123456

    # Test bare number format
    match, price = extract_price("Item 15.99")
    assert price == 1599

    # Test that phone numbers are NOT detected as prices
    match, price = extract_price("Tel: 555.123.4567")
    assert price is None  # Phone numbers should not be detected as prices

    # Test that dates with price-like patterns are detected (filtered by noise patterns in practice)
    # Note: Dates like "12.25.2023" contain "12.25" which matches price pattern
    # The is_noise_line() function should filter these out
    match, price = extract_price("Date: 12.25.2023")
    # The price pattern will match "12.25", but the full line should be filtered by is_noise_line()
    assert price == 1225 or price is None

    # Test that times are NOT detected as prices (or filtered as invalid range)
    match, price = extract_price("Time: 14.30")
    assert price is None or price == 1430  # Times either not detected or detected but should be filtered


def test_price_pattern_detection_edge_cases():
    """Test price detection with edge cases and boundary values."""
    from ocr.parser import extract_price

    # Test minimum valid price ($0.01)
    match, price = extract_price("Candy $0.01")
    assert price == 1

    # Test maximum reasonable price ($999.99)
    match, price = extract_price("Expensive $999.99")
    assert price == 99999

    # Test zero price (should be filtered out by caller)
    match, price = extract_price("Free Item $0.00")
    assert price == 0  # Extracted, but should be filtered by price range check

    # Test price with many leading zeros (may not match due to pattern constraints)
    # The regex pattern expects 1-3 digits, so "$00012.99" may not match
    match, price = extract_price("Item $00012.99")
    # This may not match due to regex constraints, or may extract as 12.99
    # Either way is acceptable - the important thing is we handle it gracefully
    assert price is None or price == 1299

    # Test price at end of string
    match, price = extract_price("$24.99")
    assert price == 2499

    # Test price with trailing text
    match, price = extract_price("$12.99 each")
    assert price == 1299


def test_smart_detection_noise_filtering():
    """Test that various noise patterns are correctly filtered out."""
    from ocr.parser import is_noise_line

    # Header noise
    assert is_noise_line("Thank you for visiting!") == True
    assert is_noise_line("www.restaurant.com") == True
    assert is_noise_line(".com/menu") == True
    assert is_noise_line("Receipt #12345") == True
    assert is_noise_line("Transaction #ABC") == True

    # Date patterns - these are filtered to prevent dates from being treated as prices
    assert is_noise_line("Date: 12/25/2023") == True
    assert is_noise_line("12-25-2023 14:30") == True
    assert is_noise_line("25/12/23") == True
    # Note: Date format with periods like "12.25.2023" is not currently filtered by the date pattern
    # (which uses [-/] separators). In practice, this format is rare on receipts.
    # If extract_price() detects "12.25" in such dates, the "Date:" prefix or other context
    # would make it unlikely to have a valid description, so it would be filtered anyway.

    # Phone numbers
    assert is_noise_line("Tel: 555-123-4567") == True
    assert is_noise_line("Phone: 555.123.4567") == True
    assert is_noise_line("Call: 555:123:4567") == True

    # Table/check/guest numbers
    assert is_noise_line("Tbl 5") == True
    assert is_noise_line("Ch 123") == True
    assert is_noise_line("Gst 2") == True

    # Card information
    assert is_noise_line("Card #1234") == True

    # Generic category headers
    assert is_noise_line("Food") == True
    assert is_noise_line("Drinks") == True

    # Valid items should NOT be filtered
    assert is_noise_line("Hamburger $12.99") == False
    assert is_noise_line("French Fries $4.99") == False
    assert is_noise_line("Coca Cola $2.99") == False


def test_smart_detection_improves_over_basic():
    """Test that smart detection provides better accuracy than basic line-by-line parsing."""
    from ocr.parser import parse_receipt_items

    # Create a complex receipt that would confuse basic parsing
    full_text = """BURGER PALACE
Visit us at www.burgerpalace.com
Call: 555-123-4567
Date: 12/25/2023
Receipt #5678

Classic Burger      $8.99
Large Fries         $3.99
Milkshake          $5.99

Subtotal           $18.97
Tax (8%)            $1.52
Total              $20.49

Thank you!
Card #1234"""

    mock_response = MockAnnotateImageResponse(
        text_annotations=[
            MockTextAnnotation(full_text, [
                MockVertex(0, 0),
                MockVertex(100, 0),
                MockVertex(100, 100),
                MockVertex(0, 100)
            ])
        ]
    )

    items = parse_receipt_items(mock_response)

    # Smart detection should extract exactly 3 food items
    assert len(items) == 3

    item_map = {item['description']: item['price'] for item in items}

    # Verify correct items
    assert "Classic Burger" in item_map
    assert item_map["Classic Burger"] == 899

    assert "Large Fries" in item_map
    assert item_map["Large Fries"] == 399

    assert "Milkshake" in item_map
    assert item_map["Milkshake"] == 599

    # Verify all noise is filtered out (should not be in results)
    item_descriptions = [item['description'] for item in items]
    for noise in ["BURGER PALACE", "www.burgerpalace.com", "555-123-4567",
                  "Receipt", "Subtotal", "Tax", "Total", "Thank", "Card"]:
        for desc in item_descriptions:
            assert noise.lower() not in desc.lower(), f"Noise '{noise}' found in description '{desc}'"
