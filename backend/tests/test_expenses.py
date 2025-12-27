from datetime import date
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
