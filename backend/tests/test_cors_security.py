
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_cors_restrict_origins():
    """
    Verify that the application does NOT allow arbitrary origins.
    """
    headers = {
        "Origin": "http://evil.com",
        "Access-Control-Request-Method": "GET"
    }
    response = client.options("/users/me", headers=headers)

    # Secure behavior:
    # Should NOT return allow-origin header for unauthorized origin
    # Note: access-control-allow-credentials might still be sent by the middleware,
    # but without allow-origin, the browser will block the request.
    assert "access-control-allow-origin" not in response.headers

def test_cors_localhost_allowed():
    """Verify localhost is allowed (sanity check)"""
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET"
    }
    response = client.options("/users/me", headers=headers)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
