
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

def test_groups_list_carries_latest_expense_id(client, auth_headers, test_user):
    """GET /groups marks each group with its highest expense id (settlements
    included) so clients can order the list by most recent activity."""
    from datetime import date

    first = client.post(
        "/groups/", headers=auth_headers,
        json={"name": "First Group", "default_currency": "USD"},
    ).json()
    second = client.post(
        "/groups/", headers=auth_headers,
        json={"name": "Second Group", "default_currency": "USD"},
    ).json()

    def add_expense(group_id):
        resp = client.post(
            "/expenses/", headers=auth_headers,
            json={
                "description": "Snack",
                "amount": 1000,
                "currency": "USD",
                "date": str(date.today()),
                "payer_id": test_user.id,
                "group_id": group_id,
                "split_type": "EQUAL",
                "splits": [
                    {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
                ],
            },
        )
        assert resp.status_code == 200
        return resp.json()["id"]

    first_expense = add_expense(first["id"])

    groups = {g["id"]: g for g in client.get("/groups/", headers=auth_headers).json()}
    assert groups[first["id"]]["latest_expense_id"] == first_expense
    assert groups[second["id"]]["latest_expense_id"] is None

    # New activity in the other group overtakes it.
    second_expense = add_expense(second["id"])
    groups = {g["id"]: g for g in client.get("/groups/", headers=auth_headers).json()}
    assert groups[second["id"]]["latest_expense_id"] == second_expense
    assert groups[second["id"]]["latest_expense_id"] > groups[first["id"]]["latest_expense_id"]
