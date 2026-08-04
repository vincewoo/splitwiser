"""
Merging a guest onto an account that is already in the group.

The situation these cover: somebody tracked as a guest signs up and joins the
group as themselves instead of claiming the guest, so half their history hangs
off a guest id and half off their user id. The owner merges the two.
"""

import models


def register(client, email, name):
    client.post("/register", json={"email": email, "password": "password123", "full_name": name})
    token = client.post(
        "/token", data={"username": email, "password": "password123"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def user_id(db_session, email):
    return db_session.query(models.User).filter(models.User.email == email).first().id


def make_group(client, headers, name="Trip"):
    return client.post("/groups", json={"name": name}, headers=headers).json()["id"]


def add_guest(client, headers, group_id, name):
    return client.post(f"/groups/{group_id}/guests", json={"name": name}, headers=headers).json()["id"]


def add_member(client, headers, group_id, email):
    return client.post(f"/groups/{group_id}/members", json={"email": email}, headers=headers)


def test_merge_moves_guest_history_onto_the_account(client, db_session):
    owner_headers = register(client, "owner@example.com", "Owner")
    register(client, "bob@example.com", "Bob")
    owner_id = user_id(db_session, "owner@example.com")
    bob_id = user_id(db_session, "bob@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob@example.com")

    # An old expense split with the guest, and one the guest paid for.
    client.post("/expenses", json={
        "description": "Hotel",
        "amount": 2000,
        "date": "2024-01-01",
        "payer_id": owner_id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": owner_id, "amount_owed": 1000, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 1000, "is_guest": True},
        ],
    }, headers=owner_headers)

    client.post("/expenses", json={
        "description": "Petrol",
        "amount": 1000,
        "date": "2024-01-02",
        "payer_id": guest_id,
        "payer_is_guest": True,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": owner_id, "amount_owed": 500, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 500, "is_guest": True},
        ],
    }, headers=owner_headers)

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["expenses_transferred"] == 1
    assert body["splits_moved"] == 2
    assert body["splits_merged"] == 0

    db_session.expire_all()

    # Nothing points at the guest any more.
    assert db_session.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == guest_id,
        models.ExpenseSplit.is_guest == True
    ).count() == 0
    assert db_session.query(models.Expense).filter(
        models.Expense.payer_id == guest_id,
        models.Expense.payer_is_guest == True
    ).count() == 0

    bob_splits = db_session.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == bob_id,
        models.ExpenseSplit.is_guest == False
    ).all()
    assert sorted(s.amount_owed for s in bob_splits) == [500, 1000]

    guest = db_session.query(models.GuestMember).filter(models.GuestMember.id == guest_id).first()
    assert guest.claimed_by_id == bob_id

    # And the group stops offering the guest as a separate person.
    group = client.get(f"/groups/{group_id}", headers=owner_headers).json()
    assert [g["id"] for g in group["guests"]] == []
    assert bob_id in [m["user_id"] for m in group["members"]]


def test_merge_keeps_the_group_total_and_lands_one_balance(client, db_session):
    owner_headers = register(client, "owner2@example.com", "Owner")
    register(client, "bob2@example.com", "Bob")
    owner_id = user_id(db_session, "owner2@example.com")
    bob_id = user_id(db_session, "bob2@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob2@example.com")

    # Half the history under the guest...
    client.post("/expenses", json={
        "description": "Hotel",
        "amount": 2000,
        "date": "2024-01-01",
        "payer_id": owner_id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": owner_id, "amount_owed": 1000, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 1000, "is_guest": True},
        ],
    }, headers=owner_headers)

    # ...half under the account he joined with.
    client.post("/expenses", json={
        "description": "Dinner",
        "amount": 3000,
        "date": "2024-01-03",
        "payer_id": owner_id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": owner_id, "amount_owed": 1500, "is_guest": False},
            {"user_id": bob_id, "amount_owed": 1500, "is_guest": False},
        ],
    }, headers=owner_headers)

    before = client.get(f"/groups/{group_id}/balances", headers=owner_headers).json()
    total_before = sum(b["amount"] for b in before)

    client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )

    after = client.get(f"/groups/{group_id}/balances", headers=owner_headers).json()
    assert sum(b["amount"] for b in after) == total_before

    bob_rows = [b for b in after if b["user_id"] == bob_id and not b["is_guest"]]
    assert len(bob_rows) == 1
    assert bob_rows[0]["amount"] == -2500
    assert not [b for b in after if b["is_guest"]]


def test_merge_folds_a_collision_into_one_split(client, db_session):
    """Both the guest and the account on the same expense must not survive as two rows."""
    owner_headers = register(client, "owner3@example.com", "Owner")
    register(client, "bob3@example.com", "Bob")
    owner_id = user_id(db_session, "owner3@example.com")
    bob_id = user_id(db_session, "bob3@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob3@example.com")

    client.post("/expenses", json={
        "description": "Taxi",
        "amount": 3000,
        "date": "2024-01-04",
        "payer_id": owner_id,
        "group_id": group_id,
        "split_type": "EXACT",
        "splits": [
            {"user_id": owner_id, "amount_owed": 1000, "is_guest": False},
            {"user_id": bob_id, "amount_owed": 1200, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 800, "is_guest": True},
        ],
    }, headers=owner_headers)

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )
    assert response.status_code == 200
    assert response.json()["splits_merged"] == 1
    assert response.json()["splits_moved"] == 0

    db_session.expire_all()
    bob_splits = db_session.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == bob_id,
        models.ExpenseSplit.is_guest == False
    ).all()
    assert len(bob_splits) == 1
    assert bob_splits[0].amount_owed == 2000

    # The expense still adds up to what was paid.
    expense = client.get(f"/groups/{group_id}/expenses", headers=owner_headers).json()[0]
    assert sum(s["amount_owed"] for s in expense["splits"]) == 3000


def test_merge_moves_item_assignments_and_drops_double_assignment(client, db_session):
    owner_headers = register(client, "owner4@example.com", "Owner")
    register(client, "bob4@example.com", "Bob")
    owner_id = user_id(db_session, "owner4@example.com")
    bob_id = user_id(db_session, "bob4@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob4@example.com")

    client.post("/expenses", json={
        "description": "Dinner",
        "amount": 3000,
        "date": "2024-01-05",
        "payer_id": owner_id,
        "group_id": group_id,
        "split_type": "ITEMIZED",
        "splits": [
            {"user_id": owner_id, "amount_owed": 1000, "is_guest": False},
            {"user_id": bob_id, "amount_owed": 1000, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 1000, "is_guest": True},
        ],
        "items": [
            {"description": "Steak", "price": 1000,
             "assignments": [{"user_id": guest_id, "is_guest": True}]},
            # Shared line: the guest and the account are both on it already.
            {"description": "Wine", "price": 2000,
             "assignments": [
                 {"user_id": owner_id, "is_guest": False},
                 {"user_id": bob_id, "is_guest": False},
                 {"user_id": guest_id, "is_guest": True},
             ]},
        ],
    }, headers=owner_headers)

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )
    assert response.status_code == 200
    assert response.json()["items_moved"] == 1
    assert response.json()["items_merged"] == 1

    db_session.expire_all()
    wine = db_session.query(models.ExpenseItem).filter(
        models.ExpenseItem.description == "Wine"
    ).first()
    bob_on_wine = db_session.query(models.ExpenseItemAssignment).filter(
        models.ExpenseItemAssignment.expense_item_id == wine.id,
        models.ExpenseItemAssignment.user_id == bob_id,
        models.ExpenseItemAssignment.is_guest == False
    ).count()
    assert bob_on_wine == 1

    steak = db_session.query(models.ExpenseItem).filter(
        models.ExpenseItem.description == "Steak"
    ).first()
    steak_assignment = db_session.query(models.ExpenseItemAssignment).filter(
        models.ExpenseItemAssignment.expense_item_id == steak.id
    ).one()
    assert steak_assignment.user_id == bob_id
    assert steak_assignment.is_guest == False


def test_merge_moves_management_the_guest_held(client, db_session):
    """People the guest settled up for are settled up for by the account after."""
    owner_headers = register(client, "owner5@example.com", "Owner")
    register(client, "bob5@example.com", "Bob")
    bob_id = user_id(db_session, "bob5@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    kid_id = add_guest(client, owner_headers, group_id, "Bob's kid")
    add_member(client, owner_headers, group_id, "bob5@example.com")

    client.post(
        f"/groups/{group_id}/guests/{kid_id}/manage",
        json={"user_id": guest_id, "is_guest": True},
        headers=owner_headers,
    )
    # And the account itself was folded into the guest as a stopgap.
    client.post(
        f"/groups/{group_id}/members/{bob_id}/manage",
        json={"user_id": guest_id, "is_guest": True},
        headers=owner_headers,
    )

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )
    assert response.status_code == 200

    db_session.expire_all()
    kid = db_session.query(models.GuestMember).filter(models.GuestMember.id == kid_id).first()
    assert (kid.managed_by_id, kid.managed_by_type) == (bob_id, 'user')

    # Bob is not left managing himself.
    bob_membership = db_session.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == bob_id
    ).first()
    assert bob_membership.managed_by_id is None
    assert bob_membership.managed_by_type is None


def test_merge_clears_the_guests_own_manager(client, db_session):
    owner_headers = register(client, "owner6@example.com", "Owner")
    register(client, "bob6@example.com", "Bob")
    owner_id = user_id(db_session, "owner6@example.com")
    bob_id = user_id(db_session, "bob6@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob6@example.com")

    client.post(
        f"/groups/{group_id}/guests/{guest_id}/manage",
        json={"user_id": owner_id, "is_guest": False},
        headers=owner_headers,
    )

    client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )

    db_session.expire_all()
    guest = db_session.query(models.GuestMember).filter(models.GuestMember.id == guest_id).first()
    assert guest.claimed_by_id == bob_id
    assert guest.managed_by_id is None
    assert guest.managed_by_type is None


def test_only_the_owner_can_merge_into_somebody_else(client, db_session):
    owner_headers = register(client, "owner7@example.com", "Owner")
    other_headers = register(client, "other7@example.com", "Other")
    register(client, "bob7@example.com", "Bob")
    bob_id = user_id(db_session, "bob7@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob7@example.com")
    add_member(client, owner_headers, group_id, "other7@example.com")

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=other_headers,
    )
    assert response.status_code == 403

    db_session.expire_all()
    guest = db_session.query(models.GuestMember).filter(models.GuestMember.id == guest_id).first()
    assert guest.claimed_by_id is None


def test_a_member_may_merge_a_guest_into_themselves(client, db_session):
    owner_headers = register(client, "owner8@example.com", "Owner")
    bob_headers = register(client, "bob8@example.com", "Bob")
    bob_id = user_id(db_session, "bob8@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob8@example.com")

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=bob_headers,
    )
    assert response.status_code == 200

    db_session.expire_all()
    guest = db_session.query(models.GuestMember).filter(models.GuestMember.id == guest_id).first()
    assert guest.claimed_by_id == bob_id


def test_merge_refuses_a_non_member(client, db_session):
    owner_headers = register(client, "owner9@example.com", "Owner")
    register(client, "stranger9@example.com", "Stranger")
    stranger_id = user_id(db_session, "stranger9@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": stranger_id},
        headers=owner_headers,
    )
    assert response.status_code == 400
    assert "already in this group" in response.json()["detail"]


def test_merge_refuses_an_already_merged_guest(client, db_session):
    owner_headers = register(client, "owner10@example.com", "Owner")
    register(client, "bob10@example.com", "Bob")
    bob_id = user_id(db_session, "bob10@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob10@example.com")

    first = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )
    assert first.status_code == 200

    second = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": bob_id},
        headers=owner_headers,
    )
    assert second.status_code == 400


def test_merge_requires_group_membership(client, db_session):
    owner_headers = register(client, "owner11@example.com", "Owner")
    outsider_headers = register(client, "outsider11@example.com", "Outsider")
    outsider_id = user_id(db_session, "outsider11@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")

    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/merge",
        json={"user_id": outsider_id},
        headers=outsider_headers,
    )
    assert response.status_code == 403


def test_claim_still_works_and_folds_collisions(client, db_session):
    """The claim path shares the merge helper, so it gained the same dedupe."""
    owner_headers = register(client, "owner12@example.com", "Owner")
    bob_headers = register(client, "bob12@example.com", "Bob")
    owner_id = user_id(db_session, "owner12@example.com")
    bob_id = user_id(db_session, "bob12@example.com")

    group_id = make_group(client, owner_headers)
    guest_id = add_guest(client, owner_headers, group_id, "Bob (guest)")
    add_member(client, owner_headers, group_id, "bob12@example.com")

    client.post("/expenses", json={
        "description": "Taxi",
        "amount": 3000,
        "date": "2024-01-06",
        "payer_id": owner_id,
        "group_id": group_id,
        "split_type": "EXACT",
        "splits": [
            {"user_id": owner_id, "amount_owed": 1000, "is_guest": False},
            {"user_id": bob_id, "amount_owed": 1200, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 800, "is_guest": True},
        ],
    }, headers=owner_headers)

    response = client.post(f"/groups/{group_id}/guests/{guest_id}/claim", headers=bob_headers)
    assert response.status_code == 200
    assert response.json()["transferred_splits"] == 1

    db_session.expire_all()
    bob_splits = db_session.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == bob_id,
        models.ExpenseSplit.is_guest == False
    ).all()
    assert len(bob_splits) == 1
    assert bob_splits[0].amount_owed == 2000
