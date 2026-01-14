
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os
import io
from PIL import Image

# Import app to get dependencies
from main import app, RECEIPT_DIR
from dependencies import get_current_user

# Create client
client = TestClient(app)

# Mock OCR service to avoid calling Google Cloud
@pytest.fixture
def mock_ocr():
    with patch("routers.ocr.ocr_service") as mock:
        mock_response = MagicMock()
        mock_response.text_annotations = []
        mock.extract_text.return_value = mock_response
        yield mock

def test_upload_malicious_extension_fixed(mock_ocr, tmp_path):
    # Override authentication to bypass login
    app.dependency_overrides[get_current_user] = lambda: MagicMock(id=1)

    try:
        # Create a valid minimal JPEG
        valid_jpeg = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x0c\x03\x01\x00\x02\x11\x03\x11\x00?\x00\xbf\x00'

        # Test uploading a valid image but with malicious extension (exploit.html)
        files = {
            "file": ("exploit.html", valid_jpeg, "image/jpeg")
        }

        response = client.post("/ocr/scan-receipt", files=files)

        # Should succeed (200 OK) because content is valid image
        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()

        receipt_path = data["receipt_image_path"]

        # Verify fix: Should NOT end with .html, should be .jpg (detected from content)
        assert not receipt_path.endswith(".html"), "Vulnerability! File saved as .html"
        assert receipt_path.endswith(".jpg"), "File should be saved as .jpg based on content"

        # Cleanup created file
        filename = receipt_path.split("/")[-1]
        full_path = os.path.join(RECEIPT_DIR, filename)
        if os.path.exists(full_path):
            os.remove(full_path)

    finally:
        app.dependency_overrides = {}

def test_upload_non_image_content_rejected(mock_ocr):
    app.dependency_overrides[get_current_user] = lambda: MagicMock(id=1)

    try:
        # Test uploading non-image content (HTML script) disguised as image
        files = {
            "file": ("exploit.html", b"<html><script>alert(1)</script></html>", "image/jpeg")
        }

        response = client.post("/ocr/scan-receipt", files=files)

        # Verify fix: Should be rejected as invalid image (400 Bad Request)
        assert response.status_code == 400
        assert "Invalid image file" in response.json()["detail"]

    finally:
        app.dependency_overrides = {}
