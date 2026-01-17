from fastapi.testclient import TestClient
from main import app
import os

def test_cors_secure():
    client = TestClient(app)

    # 1. Simulate a request from a malicious origin
    headers_evil = {
        "Origin": "http://evil.com",
        "Access-Control-Request-Method": "GET"
    }

    response_evil = client.options("/groups/public", headers=headers_evil)

    # Starlette/FastAPI middleware omits the header if origin is not allowed
    assert "access-control-allow-origin" not in response_evil.headers

    # 2. Simulate a request from an allowed origin (using default)
    headers_good = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET"
    }

    response_good = client.options("/groups/public", headers=headers_good)

    assert response_good.status_code == 200
    assert response_good.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response_good.headers["access-control-allow-credentials"] == "true"
