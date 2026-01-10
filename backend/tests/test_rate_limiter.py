from fastapi.testclient import TestClient
from main import app
from utils.rate_limiter import RateLimiter, auth_rate_limiter, ocr_rate_limiter

client = TestClient(app)

def test_auth_rate_limiting():
    # Override the rate limiter dependency with a strict one for this test
    # This ensures we don't depend on global state or environmental factors
    test_limiter = RateLimiter(requests_limit=5, time_window=60)
    app.dependency_overrides[auth_rate_limiter] = test_limiter

    try:
        url = "/token"
        # Valid form data structure required by OAuth2PasswordRequestForm
        data = {"username": "test@example.com", "password": "password"}

        # Send 5 requests
        for i in range(5):
            response = client.post(url, data=data)
            # Should not be 429
            assert response.status_code != 429, f"Request {i+1} was rate limited unexpectedly"

        # The 6th request should be rate limited
        response = client.post(url, data=data)
        assert response.status_code == 429, "6th request should have been rate limited"
        assert response.json()["detail"] == "Too many requests. Please try again later."

    finally:
        # Clean up the override
        app.dependency_overrides = {}

def test_register_rate_limiting():
    # Override with a shared limiter for both endpoints to verify they share the limit (or not, depending on implementation)
    # The current implementation uses the SAME instance `auth_rate_limiter` for both.

    test_limiter = RateLimiter(requests_limit=5, time_window=60)
    app.dependency_overrides[auth_rate_limiter] = test_limiter

    try:
        url = "/register"
        data = {"email": "rate_limit@example.com", "password": "password", "full_name": "Rate Limit"}

        # Send 5 requests
        for i in range(5):
            response = client.post(url, json=data)
            assert response.status_code != 429, f"Request {i+1} was rate limited unexpectedly"

        # The 6th request should be rate limited
        response = client.post(url, json=data)
        assert response.status_code == 429

    finally:
        app.dependency_overrides = {}

def test_ocr_rate_limiting():
    # Override the OCR rate limiter with a strict one
    test_limiter = RateLimiter(requests_limit=5, time_window=60)
    app.dependency_overrides[ocr_rate_limiter] = test_limiter

    try:
        url = "/ocr/scan-receipt"

        # We need to send a valid-looking file to pass the initial checks
        # Create a small dummy image
        file_content = b"fake image content"
        files = {"file": ("test.jpg", file_content, "image/jpeg")}

        # Since we're just testing the rate limiter which runs BEFORE the endpoint logic (as a dependency),
        # we don't need to mock the OCR service if the rate limiter triggers first.
        # However, FastAPI dependencies run *before* the path operation function.
        # If the rate limiter allows the request, the path operation runs, and fails on invalid image.
        # That's fine, we just want to see it NOT return 429 for the first 5, and return 429 for the 6th.

        # Send 5 requests
        for i in range(5):
            # We must recreate the file object for each request because it gets closed
            files = {"file": ("test.jpg", file_content, "image/jpeg")}
            response = client.post(url, files=files)

            # Should NOT be 429. It might be 400 (Invalid image) or 500 (OCR failed), but not 429.
            assert response.status_code != 429, f"Request {i+1} was rate limited unexpectedly. Status: {response.status_code}"

        # The 6th request should be rate limited
        files = {"file": ("test.jpg", file_content, "image/jpeg")}
        response = client.post(url, files=files)
        assert response.status_code == 429, "6th request should have been rate limited"
        assert response.json()["detail"] == "Too many requests. Please try again later."

    finally:
        app.dependency_overrides = {}

def test_proxy_rate_limiting():
    """Verify that X-Forwarded-For is respected to prevent shared rate limits behind a proxy"""
    test_limiter = RateLimiter(requests_limit=1, time_window=60)
    app.dependency_overrides[auth_rate_limiter] = test_limiter

    try:
        url = "/token"
        data = {"username": "test@example.com", "password": "password"}

        # Request 1: User A (IP: 10.0.0.1)
        # Nginx sets X-Forwarded-For
        headers_a = {"X-Forwarded-For": "10.0.0.1"}
        response = client.post(url, data=data, headers=headers_a)
        assert response.status_code != 429

        # Request 2: User B (IP: 10.0.0.2) - DIFFERENT USER
        # Should NOT be blocked (this previously failed when using only client.host)
        headers_b = {"X-Forwarded-For": "10.0.0.2"}
        response = client.post(url, data=data, headers=headers_b)
        assert response.status_code != 429, "Rate limiter failed to distinguish users via X-Forwarded-For"

        # Request 3: User A again
        # Should be blocked
        response = client.post(url, data=data, headers=headers_a)
        assert response.status_code == 429, "Rate limiter failed to block repeat request from User A"

    finally:
        app.dependency_overrides = {}
