
import pytest
from unittest.mock import Mock, patch
from io import BytesIO
from auth import create_access_token, get_password_hash
from models import User
from routers.ocr import ocr_cache

@pytest.fixture
def attacker(db_session):
    """Create a second user (attacker)."""
    user = User(
        email="attacker@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Attacker User",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def attacker_headers(attacker):
    """Return authorization headers for the attacker."""
    access_token = create_access_token(data={"sub": attacker.email})
    return {"Authorization": f"Bearer {access_token}"}

@pytest.fixture
def mock_vision_response_simple():
    """Create a simple mock Vision API response."""
    from backend.tests.test_ocr import MockAnnotateImageResponse
    return MockAnnotateImageResponse(text_annotations=[])

def test_ocr_idor_vulnerability(client, auth_headers, attacker_headers, mock_vision_response_simple):
    """
    Test that one user cannot access another user's cached OCR data.
    """
    # 1. User A (victim) uploads a receipt and gets a cache key
    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_vision_response_simple):
        # We also need to mock rate limiter or it might block
        with patch('routers.ocr.ocr_rate_limiter', return_value=True):
             response = client.post(
                "/ocr/detect-regions",
                headers=auth_headers,
                files={"file": ("receipt.jpg", BytesIO(b"fake image"), "image/jpeg")}
            )

    assert response.status_code == 200
    cache_key = response.json()["cache_key"]

    # 2. Verify User A can access it
    # We need to ensure the cache is actually populated. The endpoint does that.
    # However, since we are using the TestClient, it runs in the same process, so the global ocr_cache should be shared.

    # We need to mock get_current_user to return the correct user for the subsequent requests
    # But TestClient handles headers -> auth -> user resolution automatically via the app.

    # Let's try to access it as User A first to confirm it works
    response_a = client.post(
        "/ocr/extract-regions",
        headers=auth_headers,
        json={
            "cache_key": cache_key,
            "regions": []
        }
    )
    assert response_a.status_code == 200

    # 3. User B (attacker) tries to access the same cache key
    response_b = client.post(
        "/ocr/extract-regions",
        headers=attacker_headers,
        json={
            "cache_key": cache_key,
            "regions": []
        }
    )

    # THIS SHOULD FAIL (403 or 404) but will PASS (200) currently
    # Asserting 404 to verify the fix later.
    # For now, to confirm vulnerability, I expect 200 if I were just probing.
    # But since I want to verify the FIX, I will assert 404 (or 403).

    assert response_b.status_code in [403, 404], f"IDOR Vulnerability! Attacker accessed victim's data. Status: {response_b.status_code}"
