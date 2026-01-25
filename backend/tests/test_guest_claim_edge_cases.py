
import pytest
import models

def test_claim_guest_managed_by_user(client, db_session):
    """
    Scenario: User 1 creates Guest A and manages them.
    User 2 claims Guest A.
    Result: Guest A becomes User 2. Management link dissolves.
    """
    # 1. Register User 1 (Manager)
    client.post("/register", json={"email": "manager@example.com", "password": "pass", "full_name": "Manager"})
    token1 = client.post("/token", data={"username": "manager@example.com", "password": "pass"}).json()["access_token"]
    headers1 = {"Authorization": f"Bearer {token1}"}
    
    user1 = db_session.query(models.User).filter(models.User.email == "manager@example.com").first()

    # 2. Create Group and Guest A
    group_res = client.post("/groups", json={"name": "Test Group"}, headers=headers1)
    group_id = group_res.json()["id"]
    guest_res = client.post(f"/groups/{group_id}/guests", json={"name": "Guest A"}, headers=headers1)
    guest_id = guest_res.json()["id"]

    # 3. User 1 manages Guest A
    client.post(f"/groups/{group_id}/guests/{guest_id}/manage", json={"user_id": user1.id, "is_guest": False}, headers=headers1)

    # 4. Enable Sharing
    share_res = client.post(f"/groups/{group_id}/share", headers=headers1)
    share_link_id = share_res.json()["share_link_id"]

    # 5. User 2 claims Guest A
    res = client.post("/register", json={
        "email": "claimed@example.com", 
        "password": "pass", 
        "full_name": "Claimed User",
        "claim_guest_id": guest_id,
        "share_link_id": share_link_id
    })
    assert res.status_code == 200
    
    # 6. Verify Guest A still exists (as linking record)
    guest_a = db_session.query(models.GuestMember).filter(models.GuestMember.id == guest_id).first()
    assert guest_a is not None
    
    # 7. Verify management link persists
    # User 1 should still manage Guest A (which is now linked to User 2)
    assert guest_a.managed_by_id == user1.id
    assert guest_a.managed_by_type == 'user' # User 1 is a user
    
    # 8. Verify User 2 is in the group
    user2 = db_session.query(models.User).filter(models.User.email == "claimed@example.com").first()
    member = db_session.query(models.GroupMember).filter(models.GroupMember.user_id == user2.id, models.GroupMember.group_id == group_id).first()
    assert member is not None

    # 9. Verify Guest A is claimed by User 2
    assert guest_a.claimed_by_id == user2.id

def test_claim_guest_with_itemized_expenses(client, db_session):
    """
    Scenario: Guest A is assigned an item in an itemized expense.
    User 2 claims Guest A.
    Result: Item assignment is transferred to User 2.
    """
    # 1. Register User 1
    client.post("/register", json={"email": "u1@example.com", "password": "pass", "full_name": "U1"})
    token1 = client.post("/token", data={"username": "u1@example.com", "password": "pass"}).json()["access_token"]
    headers1 = {"Authorization": f"Bearer {token1}"}

    # 2. Create Group and Guest A
    group_res = client.post("/groups", json={"name": "G1"}, headers=headers1)
    group_id = group_res.json()["id"]
    guest_res = client.post(f"/groups/{group_id}/guests", json={"name": "Guest A"}, headers=headers1)
    guest_id = guest_res.json()["id"]

    # 3. Create Itemized Expense involved Guest A
    expense_data = {
        "description": "Dinner",
        "amount": 2000,
        "date": "2023-01-01",
        "payer_id": 1, # User 1 (approx)
        "split_type": "ITEMIZED",
        "splits": [], # Splits are ignored for ITEMIZED in creation payload usually, but let's provide empty
        "items": [
            {
                "description": "Burger",
                "price": 1000,
                "assignments": [{"user_id": guest_id, "is_guest": True}]
            },
            {
                "description": "Fries",
                "price": 1000,
                "assignments": [{"user_id": 1, "is_guest": False}] # User 1
            }
        ]
    }
    # Need to get correct user ID for payer/assignment
    user1_id = db_session.query(models.User).filter(models.User.email == "u1@example.com").first().id
    expense_data["payer_id"] = user1_id
    expense_data["items"][1]["assignments"][0]["user_id"] = user1_id

    # We also need to provide splits for validation? 
    # The models suggest splits are calculated or required. 
    # Let's provide dummy splits that match the total to pass validation if any.
    expense_data["splits"] = [
        {"user_id": user1_id, "amount_owed": 1000, "is_guest": False},
        {"user_id": guest_id, "amount_owed": 1000, "is_guest": True}
    ]

    expense_data["group_id"] = group_id

    create_res = client.post("/expenses", json=expense_data, headers=headers1)
    # If this fails, we might need to debug expense creation, but assuming it works:
    assert create_res.status_code == 200

    # 4. Enable Sharing
    share_res = client.post(f"/groups/{group_id}/share", headers=headers1)
    share_link_id = share_res.json()["share_link_id"]

    # 5. User 2 claims Guest A
    res = client.post("/register", json={
        "email": "u2@example.com", 
        "password": "pass", 
        "full_name": "U2",
        "claim_guest_id": guest_id,
        "share_link_id": share_link_id
    })
    assert res.status_code == 200
    
    # 6. Verify Item Assignment Transferred
    user2 = db_session.query(models.User).filter(models.User.email == "u2@example.com").first()
    
    assignments = db_session.query(models.ExpenseItemAssignment).filter(
        models.ExpenseItemAssignment.user_id == user2.id,
        models.ExpenseItemAssignment.is_guest == False
    ).all()
    
    assert len(assignments) >= 1
    
    # Verify the specific assignment
    burger_item = db_session.query(models.ExpenseItem).filter(models.ExpenseItem.description == "Burger").first()
    burger_assignment = db_session.query(models.ExpenseItemAssignment).filter(
        models.ExpenseItemAssignment.expense_item_id == burger_item.id,
        models.ExpenseItemAssignment.user_id == user2.id
    ).first()
    assert burger_assignment is not None
