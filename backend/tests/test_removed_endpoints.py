"""The four API routes removed as unused must no longer be routed."""

import pytest


@pytest.mark.parametrize("method, path", [
    ("post", "/auth/google/link"),
    ("delete", "/auth/google/unlink"),
    ("post", "/auth/set-password"),
    ("get", "/friends/status/1"),
])
def test_removed_endpoint_is_not_routed(client, auth_headers, method, path):
    if method == "post":
        response = client.request(method.upper(), path, json={}, headers=auth_headers)
    else:
        response = client.request(method.upper(), path, headers=auth_headers)
    assert response.status_code == 404
