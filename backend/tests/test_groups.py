
def test_create_group(client, auth_headers):
    response = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Test Group", "default_currency": "USD"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test Group"
    assert data["default_currency"] == "USD"
    assert "id" in data

def test_get_groups(client, auth_headers):
    # Create two groups
    client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Group 1", "default_currency": "USD"}
    )
    client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Group 2", "default_currency": "EUR"}
    )

    response = client.get("/groups/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 2
    names = [g["name"] for g in data]
    assert "Group 1" in names
    assert "Group 2" in names

def test_get_group_details(client, auth_headers, test_user):
    # Create a group
    create_response = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Detail Group", "default_currency": "USD"}
    )
    group_id = create_response.json()["id"]

    response = client.get(f"/groups/{group_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Detail Group"
    assert len(data["members"]) == 1
    assert data["members"][0]["email"] == test_user.email
