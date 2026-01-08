from fastapi.testclient import TestClient
from main import app
from utils.rate_limiter import RateLimiter, auth_rate_limiter

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
