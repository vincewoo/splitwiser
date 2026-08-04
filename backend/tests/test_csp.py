
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


def test_csp_allows_the_pdf_viewer():
    """A receipt PDF opened in a tab must not be blocked by our own header.

    Chrome wraps a top-level PDF in a plugin document and checks the embedded
    viewer against object-src; falling back to default-src 'none' renders a
    blank tab instead of the receipt.
    """
    response = client.get("/static/receipts/nonexistent.pdf")
    assert "object-src 'self'" in response.headers["content-security-policy"]
