"""Tests for the OCR receipt scanning endpoint."""

import io
from unittest.mock import patch

from PIL import Image


def _make_image(fmt="JPEG", size=(100, 100)):
    """Create a minimal in-memory image file."""
    buf = io.BytesIO()
    img = Image.new("RGB", size, color="red")
    img.save(buf, format=fmt)
    buf.seek(0)
    return buf


MOCK_LLM_RESULT = {
    "items": [
        {"description": "Burger", "price_cents": 1299, "quantity": 1},
        {"description": "Fries", "price_cents": 499, "quantity": 2},
    ],
    "tax_cents": 150,
    "tip_cents": 200,
    "total_cents": 2148,
}


class TestScanReceiptHappyPath:
    @patch("routers.ocr.parse_receipt", return_value=MOCK_LLM_RESULT)
    def test_valid_jpeg_returns_items(self, mock_parse, client, auth_headers, tmp_path):
        img = _make_image("JPEG")
        with patch("routers.ocr.RECEIPT_DIR", str(tmp_path)):
            resp = client.post(
                "/ocr/scan-receipt",
                headers=auth_headers,
                files={"file": ("receipt.jpg", img, "image/jpeg")},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["items"][0]["description"] == "Burger"
        assert data["items"][0]["price"] == 1299
        assert data["items"][1]["quantity"] == 2
        assert data["tax"] == 150
        assert data["tip"] == 200
        assert data["total"] == 2148
        assert data["receipt_image_path"].startswith("/static/receipts/")
        assert data["receipt_image_path"].endswith(".jpg")
        mock_parse.assert_called_once()

    @patch("routers.ocr.parse_receipt", return_value=MOCK_LLM_RESULT)
    def test_valid_png(self, mock_parse, client, auth_headers, tmp_path):
        img = _make_image("PNG")
        with patch("routers.ocr.RECEIPT_DIR", str(tmp_path)):
            resp = client.post(
                "/ocr/scan-receipt",
                headers=auth_headers,
                files={"file": ("receipt.png", img, "image/png")},
            )
        assert resp.status_code == 200
        assert resp.json()["receipt_image_path"].endswith(".png")


class TestScanReceiptValidation:
    def test_non_image_file_returns_400(self, client, auth_headers):
        buf = io.BytesIO(b"not an image at all")
        resp = client.post(
            "/ocr/scan-receipt",
            headers=auth_headers,
            files={"file": ("receipt.txt", buf, "text/plain")},
        )
        assert resp.status_code == 400
        assert "Invalid image file" in resp.json()["detail"]

    def test_oversized_file_returns_413(self, client, auth_headers):
        # Create content just over 10 MB
        buf = io.BytesIO(b"\x00" * (10 * 1024 * 1024 + 1))
        resp = client.post(
            "/ocr/scan-receipt",
            headers=auth_headers,
            files={"file": ("big.jpg", buf, "image/jpeg")},
        )
        assert resp.status_code == 413

    def test_unsupported_format_returns_400(self, client, auth_headers):
        # BMP is a valid image but not in FORMAT_MAP
        buf = io.BytesIO()
        img = Image.new("RGB", (10, 10), color="blue")
        img.save(buf, format="BMP")
        buf.seek(0)
        resp = client.post(
            "/ocr/scan-receipt",
            headers=auth_headers,
            files={"file": ("receipt.bmp", buf, "image/bmp")},
        )
        assert resp.status_code == 400
        assert "Unsupported image format" in resp.json()["detail"]


class TestScanReceiptLLMErrors:
    @patch("routers.ocr.parse_receipt", side_effect=RuntimeError("Missing OPENAI_API_KEY"))
    def test_runtime_error_returns_500_generic_message(self, mock_parse, client, auth_headers, tmp_path):
        """RuntimeError should NOT leak the original message (could contain API keys)."""
        img = _make_image("JPEG")
        with patch("routers.ocr.RECEIPT_DIR", str(tmp_path)):
            resp = client.post(
                "/ocr/scan-receipt",
                headers=auth_headers,
                files={"file": ("receipt.jpg", img, "image/jpeg")},
            )
        assert resp.status_code == 500
        detail = resp.json()["detail"]
        assert "OPENAI_API_KEY" not in detail
        assert "not configured" in detail.lower()

    @patch("routers.ocr.parse_receipt", side_effect=Exception("some transient failure"))
    def test_general_exception_returns_502(self, mock_parse, client, auth_headers, tmp_path):
        img = _make_image("JPEG")
        with patch("routers.ocr.RECEIPT_DIR", str(tmp_path)):
            resp = client.post(
                "/ocr/scan-receipt",
                headers=auth_headers,
                files={"file": ("receipt.jpg", img, "image/jpeg")},
            )
        assert resp.status_code == 502
        assert "temporarily unavailable" in resp.json()["detail"].lower()


class TestScanReceiptAuth:
    def test_unauthenticated_returns_401(self, client):
        img = _make_image("JPEG")
        resp = client.post(
            "/ocr/scan-receipt",
            files={"file": ("receipt.jpg", img, "image/jpeg")},
        )
        assert resp.status_code == 401
