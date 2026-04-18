from datetime import date, timedelta
from models import User
from auth import get_password_hash

def test_create_expense_equal_split(client, auth_headers, db_session, test_user):
    # Setup: Create group and another member
    group_resp = client.post("/groups/", headers=auth_headers, json={"name": "Expense Group", "default_currency": "USD"})
    group_id = group_resp.json()["id"]
    
    other_user = User(email="other@example.com", hashed_password=get_password_hash("pw"), full_name="Other", is_active=True)
    db_session.add(other_user)
    db_session.commit()
    client.post(f"/groups/{group_id}/members", headers=auth_headers, json={"email": "other@example.com"})

    # Create Expense
    payload = {
        "description": "Lunch",
        "amount": 2000, # $20.00
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "payer_is_guest": False,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": other_user.id, "amount_owed": 1000, "is_guest": False}
        ]
    }
    response = client.post("/expenses/", headers=auth_headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["amount"] == 2000
    
    # Fetch details to verify splits
    details = client.get(f"/expenses/{data['id']}", headers=auth_headers).json()
    assert len(details["splits"]) == 2
    assert details["splits"][0]["amount_owed"] == 1000

def test_create_expense_exact_split(client, auth_headers, db_session, test_user):
    # Setup
    group_resp = client.post("/groups/", headers=auth_headers, json={"name": "Exact Group", "default_currency": "USD"})
    group_id = group_resp.json()["id"]
    other_user = User(email="exact@example.com", hashed_password=get_password_hash("pw"), full_name="Exact", is_active=True)
    db_session.add(other_user)
    db_session.commit()
    client.post(f"/groups/{group_id}/members", headers=auth_headers, json={"email": "exact@example.com"})

    # Create Expense
    payload = {
        "description": "Uneven Dinner",
        "amount": 3000, # $30.00
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "payer_is_guest": False,
        "group_id": group_id,
        "split_type": "EXACT",
        "splits": [
            {"user_id": test_user.id, "amount_owed": 2000, "is_guest": False},
            {"user_id": other_user.id, "amount_owed": 1000, "is_guest": False}
        ]
    }
    response = client.post("/expenses/", headers=auth_headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    
    # Fetch details
    details = client.get(f"/expenses/{data['id']}", headers=auth_headers).json()
    splits = {s["user_id"]: s["amount_owed"] for s in details["splits"]}
    assert splits[test_user.id] == 2000
    assert splits[other_user.id] == 1000

def test_update_expense(client, auth_headers, db_session, test_user):
    # Setup
    group_resp = client.post("/groups/", headers=auth_headers, json={"name": "Update Group", "default_currency": "USD"})
    group_id = group_resp.json()["id"]
    
    # Create Expense
    payload = {
        "description": "Original",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}]
    }
    create_resp = client.post("/expenses/", headers=auth_headers, json=payload)
    expense_id = create_resp.json()["id"]

    # Update Expense
    update_payload = payload.copy()
    update_payload["description"] = "Updated"
    update_payload["amount"] = 2000
    update_payload["splits"][0]["amount_owed"] = 2000
    
    response = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update_payload)
    assert response.status_code == 200
    assert response.json()["description"] == "Updated"
    assert response.json()["amount"] == 2000

def _make_group_for_date_tests(client, auth_headers):
    """Helper: create a simple group and return its id."""
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Date Bounds Group", "default_currency": "USD"},
    )
    return group_resp.json()["id"]


def test_create_expense_rejects_far_future_date(client, auth_headers, test_user):
    """A date more than 1 year in the future must be rejected with 400."""
    group_id = _make_group_for_date_tests(client, auth_headers)

    far_future = (date.today() + timedelta(days=365 * 5)).isoformat()
    payload = {
        "description": "Future Expense",
        "amount": 1000,
        "currency": "USD",
        "date": far_future,
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}],
    }
    resp = client.post("/expenses/", headers=auth_headers, json=payload)
    assert resp.status_code == 400
    assert "future" in resp.json()["detail"].lower()


def test_create_expense_rejects_far_past_date(client, auth_headers, test_user):
    """A date more than 100 years in the past must be rejected with 400."""
    group_id = _make_group_for_date_tests(client, auth_headers)

    far_past = "1800-01-01"
    payload = {
        "description": "Ancient Expense",
        "amount": 1000,
        "currency": "USD",
        "date": far_past,
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}],
    }
    resp = client.post("/expenses/", headers=auth_headers, json=payload)
    assert resp.status_code == 400
    assert "past" in resp.json()["detail"].lower()


def test_create_expense_accepts_near_future_date(client, auth_headers, test_user):
    """A legitimate near-future date (today + 30 days) must still be accepted."""
    group_id = _make_group_for_date_tests(client, auth_headers)

    soon = (date.today() + timedelta(days=30)).isoformat()
    payload = {
        "description": "Upcoming Expense",
        "amount": 1000,
        "currency": "USD",
        "date": soon,
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}],
    }
    resp = client.post("/expenses/", headers=auth_headers, json=payload)
    assert resp.status_code == 200, resp.text


def test_update_expense_rejects_far_future_date(client, auth_headers, test_user):
    """PUT /expenses/{id} must also reject out-of-range dates."""
    group_id = _make_group_for_date_tests(client, auth_headers)

    create_payload = {
        "description": "To Update",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}],
    }
    created = client.post("/expenses/", headers=auth_headers, json=create_payload).json()

    update_payload = create_payload.copy()
    update_payload["date"] = "2200-01-01"
    resp = client.put(
        f"/expenses/{created['id']}", headers=auth_headers, json=update_payload
    )
    assert resp.status_code == 400
    assert "future" in resp.json()["detail"].lower()


def test_delete_expense(client, auth_headers, db_session, test_user):
    # Create Expense
    payload = {
        "description": "To Delete",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": None, # Non-group expense
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}]
    }
    create_resp = client.post("/expenses/", headers=auth_headers, json=payload)
    expense_id = create_resp.json()["id"]

    # Delete
    response = client.delete(f"/expenses/{expense_id}", headers=auth_headers)
    assert response.status_code == 200
    
    # Verify retrieval fails (or returns empty/deleted status if implemented differently, but standard is 404 or empty list)
    # Checking via list endpoint
    list_resp = client.get("/expenses/", headers=auth_headers)
    ids = [e["id"] for e in list_resp.json()]
    assert expense_id not in ids
