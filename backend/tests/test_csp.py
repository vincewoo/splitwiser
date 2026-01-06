
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_csp_headers_api():
    """Verify CSP header is present on API responses"""
    # Assuming /users/me requires auth, it will return 401, but headers should be present
    response = client.get("/users/me")
    assert "content-security-policy" in response.headers
    csp = response.headers["content-security-policy"]
    assert "default-src 'none'" in csp
    # Ensure we allow what is needed
    assert "script-src 'self'" in csp

def test_csp_headers_static():
    """Verify CSP header is present on static file responses"""
    # We can request a non-existent file, it should still return 404 but with headers if middleware wraps it
    response = client.get("/static/receipts/nonexistent.jpg")
    # Middleware applies to the response
    assert "content-security-policy" in response.headers
