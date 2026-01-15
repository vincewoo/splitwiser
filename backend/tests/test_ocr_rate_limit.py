import pytest
from fastapi import status
from io import BytesIO
from unittest.mock import patch, Mock

from main import app
from utils.rate_limiter import RateLimiter, ocr_rate_limiter

def test_ocr_rate_limiting(client, auth_headers):
    """Test that OCR endpoints are rate limited."""

    # Create a strict rate limiter for testing (1 request per minute)
    test_limiter = RateLimiter(requests_limit=1, time_window=60)

    # Override the dependency
    app.dependency_overrides[ocr_rate_limiter] = test_limiter

    try:
        # Create a mock file
        mock_file = BytesIO(b"fake image data")
        files = {"file": ("receipt.jpg", mock_file, "image/jpeg")}

        # Mock the OCR service to avoid actual API calls (and errors)
        with patch('ocr.service.ocr_service.detect_document_text') as mock_ocr:
            mock_ocr.return_value = Mock(text_annotations=[])

            # First request should succeed (or fail with 400/500 but NOT 429)
            # We expect 200 because we mocked the service, or 400/500 if other validation fails
            # But definitely not 429.
            response1 = client.post(
                "/ocr/detect-regions",
                headers=auth_headers,
                files={"file": ("receipt.jpg", BytesIO(b"fake"), "image/jpeg")}
            )
            assert response1.status_code != status.HTTP_429_TOO_MANY_REQUESTS

            # Second request should fail with 429
            response2 = client.post(
                "/ocr/detect-regions",
                headers=auth_headers,
                files={"file": ("receipt.jpg", BytesIO(b"fake"), "image/jpeg")}
            )
            assert response2.status_code == status.HTTP_429_TOO_MANY_REQUESTS
            assert "Too many requests" in response2.json()["detail"]

    finally:
        # Clean up dependency override
        app.dependency_overrides = {}

def test_extract_regions_rate_limiting(client, auth_headers):
    """Test that extract-regions endpoint is rate limited."""

    # Create a strict rate limiter for testing (1 request per minute)
    test_limiter = RateLimiter(requests_limit=1, time_window=60)

    # Override the dependency
    app.dependency_overrides[ocr_rate_limiter] = test_limiter

    try:
        # Mock cache get to avoid 404
        with patch('routers.ocr.ocr_cache.get', return_value={
            "vision_response": Mock(text_annotations=[]),
            "image_width": 100,
            "image_height": 100
        }):
            # First request
            response1 = client.post(
                "/ocr/extract-regions",
                headers=auth_headers,
                json={
                    "cache_key": "some-key",
                    "regions": []
                }
            )
            assert response1.status_code != status.HTTP_429_TOO_MANY_REQUESTS

            # Second request
            response2 = client.post(
                "/ocr/extract-regions",
                headers=auth_headers,
                json={
                    "cache_key": "some-key",
                    "regions": []
                }
            )
            assert response2.status_code == status.HTTP_429_TOO_MANY_REQUESTS

    finally:
        # Clean up dependency override
        app.dependency_overrides = {}
