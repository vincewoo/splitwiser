from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_cors_blocks_arbitrary_origin():
    """
    Test that the new configuration BLOCKS arbitrary origins.
    """
    headers = {
        "Origin": "http://evil-site.com",
        "Access-Control-Request-Method": "GET"
    }

    response = client.options("/groups/public/123", headers=headers)

    # After the fix, this should NOT return the origin in the header
    # Or it should be missing entirely
    allow_origin = response.headers.get("access-control-allow-origin")
    assert allow_origin != "http://evil-site.com"
    # In strict mode, it usually returns nothing if origin doesn't match
    assert allow_origin is None

def test_cors_allows_localhost():
    """
    Test that legitimate localhost origins are allowed.
    """
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET"
    }
    response = client.options("/groups/public/123", headers=headers)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert response.headers.get("access-control-allow-credentials") == "true"
