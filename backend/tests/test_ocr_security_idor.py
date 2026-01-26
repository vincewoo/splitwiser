
import pytest
from unittest.mock import patch, Mock
from io import BytesIO
from main import app
from conftest import client, auth_headers, test_user, db_session
from models import User
from auth import create_access_token, get_password_hash
from routers.ocr import ocr_cache

@pytest.fixture
def second_user(db_session):
    user = User(
        email="victim@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Victim User",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

@pytest.fixture
def second_user_headers(second_user):
    token = create_access_token(data={"sub": second_user.email})
    return {"Authorization": f"Bearer {token}"}

class MockAnnotateImageResponse:
    def __init__(self):
        self.text_annotations = []
        self.full_text_annotation = Mock()
        self.full_text_annotation.pages = [Mock(width=100, height=100)]

def test_extract_regions_idor(client, auth_headers, second_user_headers):
    """
    Test IDOR vulnerability in OCR extraction.
    User A (victim) scans a receipt.
    User B (attacker) tries to access User A's cached OCR data.
    """

    # 1. User A (Victim) scans a receipt to generate cache entry
    # We mock the Vision API to return a dummy response
    mock_response = MockAnnotateImageResponse()

    with patch('ocr.service.ocr_service.detect_document_text', return_value=mock_response):
        # User A calls detect-regions
        response = client.post(
            "/ocr/detect-regions",
            headers=second_user_headers, # Victim
            files={"file": ("receipt.jpg", BytesIO(b"fake image"), "image/jpeg")}
        )
        assert response.status_code == 200
        data = response.json()
        cache_key = data["cache_key"]

    # 2. User B (Attacker) tries to use the cache_key to extract regions
    # Currently this succeeds (200), but we want it to fail (404/403)
    response = client.post(
        "/ocr/extract-regions",
        headers=auth_headers, # Attacker (test_user)
        json={
            "cache_key": cache_key,
            "regions": [{"x": 0, "y": 0, "width": 0.5, "height": 0.5}]
        }
    )

    # Assert that access is denied
    # If vulnerability exists, this will be 200 and test will fail (which is what we want to prove first)
    # But for the plan, I should assert what I WANT to happen, so I can see it fail.
    assert response.status_code in [403, 404], f"IDOR vulnerability! Status was {response.status_code}"
