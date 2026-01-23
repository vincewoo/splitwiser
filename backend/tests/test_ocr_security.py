
import pytest
from unittest.mock import patch, Mock
from io import BytesIO
from main import app
from utils.rate_limiter import ocr_rate_limiter

# Mock objects needed for the test
class MockVertex:
    def __init__(self, x, y):
        self.x = x
        self.y = y

class MockBoundingPoly:
    def __init__(self, vertices):
        self.vertices = vertices

class MockTextAnnotation:
    def __init__(self, description, vertices):
        self.description = description
        self.bounding_poly = MockBoundingPoly(vertices)

class MockPage:
    def __init__(self, width=100, height=100):
        self.width = width
        self.height = height

class MockFullTextAnnotation:
    def __init__(self, pages=None):
        self.pages = pages or [MockPage()]

class MockError:
    def __init__(self, message=""):
        self.message = message

class MockAnnotateImageResponse:
    def __init__(self, text_annotations=None, error_message="", full_text_annotation=None):
        self.text_annotations = text_annotations or []
        self.error = MockError(message=error_message)
        self.full_text_annotation = full_text_annotation or MockFullTextAnnotation()

@pytest.fixture
def mock_vision_response():
    annotations = [
        MockTextAnnotation("Full Text", [MockVertex(0,0), MockVertex(100,0), MockVertex(100,100), MockVertex(0,100)]),
        MockTextAnnotation("Word", [MockVertex(10,10), MockVertex(20,10), MockVertex(20,20), MockVertex(10,20)])
    ]
    return MockAnnotateImageResponse(text_annotations=annotations)

@pytest.fixture(autouse=True)
def mock_ocr_rate_limiter():
    """Disable rate limiting for OCR tests."""
    async def pass_through():
        return True
    app.dependency_overrides[ocr_rate_limiter] = pass_through
    yield
    if ocr_rate_limiter in app.dependency_overrides:
        del app.dependency_overrides[ocr_rate_limiter]

def test_ocr_idor_vulnerability(client, mock_vision_response):
    """
    Reproduction of IDOR vulnerability:
    User B should NOT be able to access User A's OCR cache.
    """

    # 1. Setup User A
    user_a_email = "usera@example.com"
    client.post("/register", json={"email": user_a_email, "password": "password", "full_name": "User A"})
    login_a = client.post("/token", data={"username": user_a_email, "password": "password"})
    token_a = login_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # 2. Setup User B
    user_b_email = "userb@example.com"
    client.post("/register", json={"email": user_b_email, "password": "password", "full_name": "User B"})
    login_b = client.post("/token", data={"username": user_b_email, "password": "password"})
    token_b = login_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 3. User A uploads a receipt and gets cache_key
    mock_image = BytesIO(b"fake image data")
    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_vision_response):
        response_a = client.post(
            "/ocr/detect-regions",
            headers=headers_a,
            files={"file": ("receipt.jpg", mock_image, "image/jpeg")}
        )
        assert response_a.status_code == 200
        cache_key = response_a.json()["cache_key"]
        print(f"\nUser A obtained cache_key: {cache_key}")

    # 4. User B tries to use User A's cache_key
    # This should now fail with 404 Not Found (simulating cache miss)
    response_b = client.post(
        "/ocr/extract-regions",
        headers=headers_b,
        json={
            "cache_key": cache_key,
            "regions": [{"x": 0.1, "y": 0.1, "width": 0.1, "height": 0.1}]
        }
    )

    print(f"User B access attempt status: {response_b.status_code}")

    # Assert that User B cannot access User A's data
    # The API returns 404 when cache key is not found OR if ownership mismatch (same effect)
    assert response_b.status_code == 404
    assert "Cache key not found" in response_b.json()["detail"]
