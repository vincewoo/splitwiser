
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

def test_groups_list_latest_expense_id_counts_settlements(client, auth_headers, test_user):
    """A settlement is an ordinary expense, so a group whose only activity is
    a recorded payment still gets its id as the recency marker — pinning the
    'settlements included' promise in the schema comment."""
    from datetime import date

    group = client.post(
        "/groups/", headers=auth_headers,
        json={"name": "Settled Group", "default_currency": "USD"},
    ).json()

    resp = client.post(
        "/expenses/", headers=auth_headers,
        json={
            "description": "Settle up",
            "amount": 500,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "group_id": group["id"],
            "split_type": "EXACT",
            "is_settlement": True,
            "splits": [
                {"user_id": test_user.id, "amount_owed": 500, "is_guest": False},
            ],
        },
    )
    assert resp.status_code == 200
    settlement_id = resp.json()["id"]

    groups = {g["id"]: g for g in client.get("/groups/", headers=auth_headers).json()}
    assert groups[group["id"]]["latest_expense_id"] == settlement_id


def test_groups_list_empty_for_user_with_no_groups(client, db_session):
    """A user who belongs to no groups gets [] — the endpoint's empty-ids
    short-circuit must not blow up or leak other users' groups."""
    from auth import create_access_token, get_password_hash
    from models import User

    loner = User(
        email="nogroups@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="No Groups",
        is_active=True,
    )
    db_session.add(loner)
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(data={'sub': loner.email})}"}

    resp = client.get("/groups/", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []
