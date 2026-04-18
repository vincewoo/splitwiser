from datetime import date
from models import User, Group, GroupMember, GuestMember
from auth import get_password_hash
from utils.balances import _fold_managed_relationships

def test_simple_balance(client, auth_headers, db_session, test_user):
    # Setup: Group with 2 users
    group_resp = client.post("/groups/", headers=auth_headers, json={"name": "Balance Group", "default_currency": "USD"})
    group_id = group_resp.json()["id"]
    
    other_user = User(email="balance@example.com", hashed_password=get_password_hash("pw"), full_name="Balance User", is_active=True)
    db_session.add(other_user)
    db_session.commit()
    client.post(f"/groups/{group_id}/members", headers=auth_headers, json={"email": "balance@example.com"})

    # Expense: Test User pays $20, split equally
    # Test User pays 2000, owes 1000. Net +1000 (owed)
    # Other User pays 0, owes 1000. Net -1000 (owes)
    payload = {
        "description": "Lunch",
        "amount": 2000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": other_user.id, "amount_owed": 1000, "is_guest": False}
        ]
    }
    client.post("/expenses/", headers=auth_headers, json=payload)

    # Check Balances - the /balances endpoint returns group-level balances
    # Each entry has group_name, group_id, and the user's net balance in that group
    response = client.get("/balances/", headers=auth_headers)
    assert response.status_code == 200
    balances = response.json()["balances"]

    # The /balances endpoint returns one entry per group with the current user's net balance.
    # Test User paid 2000 and owes 1000, so net is +1000 (owed by group).
    group_balance = next((b for b in balances if b["group_id"] == group_id), None)
    assert group_balance is not None
    assert group_balance["amount"] == 1000.0

def test_settlement(client, auth_headers, db_session, test_user):
    # Setup as above
    group_resp = client.post("/groups/", headers=auth_headers, json={"name": "Settlement Group", "default_currency": "USD"})
    group_id = group_resp.json()["id"]
    other_user = User(email="settle@example.com", hashed_password=get_password_hash("pw"), full_name="Settle", is_active=True)
    db_session.add(other_user)
    db_session.commit()
    client.post(f"/groups/{group_id}/members", headers=auth_headers, json={"email": "settle@example.com"})

    # Expense 1: Test User lends $10 to Other
    client.post("/expenses/", headers=auth_headers, json={
        "description": "Loan",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "EXACT",
        "splits": [
            {"user_id": test_user.id, "amount_owed": 0, "is_guest": False},
            {"user_id": other_user.id, "amount_owed": 1000, "is_guest": False}
        ]
    })

    # Expense 2: Other User pays back $10 to Test User
    # Settlement is just an expense where payer=Other, and split is 100% on Test User? 
    # Or specifically a "payment". Usually handled as an expense.
    client.post("/expenses/", headers=auth_headers, json={
        "description": "Payment",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": other_user.id,
        "group_id": group_id,
        "split_type": "EXACT",
        "splits": [
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": other_user.id, "amount_owed": 0, "is_guest": False}
        ]
    })

    # Check Balances - should be 0 (or close to 0)
    response = client.get("/balances/", headers=auth_headers)
    balances = response.json()["balances"]
    # If balance is 0, it might not be returned, or returned as 0.
    other_balance = next((b for b in balances if b["user_id"] == other_user.id), None)
    if other_balance:
        assert abs(other_balance["amount"]) < 0.01

def test_guest_balance_aggregation(client, auth_headers, db_session, test_user):
    # Setup Group
    group_resp = client.post("/groups/", headers=auth_headers, json={"name": "Guest Balance Group", "default_currency": "USD"})
    group_id = group_resp.json()["id"]

    # Add Guest and Manage them
    guest_resp = client.post(f"/groups/{group_id}/guests", headers=auth_headers, json={"name": "My Guest"})
    guest_id = guest_resp.json()["id"]
    client.post(f"/groups/{group_id}/guests/{guest_id}/manage", headers=auth_headers, json={"user_id": test_user.id, "is_guest": False})

    # Add another real user
    other_user = User(email="other_b@example.com", hashed_password=get_password_hash("pw"), full_name="Other", is_active=True)
    db_session.add(other_user)
    db_session.commit()
    client.post(f"/groups/{group_id}/members", headers=auth_headers, json={"email": "other_b@example.com"})

    # Expense: Other User pays $30. Split: Other(10), Test(10), Guest(10).
    # Test User owes $10. Guest owes $10.
    # Since Test User manages Guest, Test User aggregate debt should be $20.
    payload = {
        "description": "Dinner",
        "amount": 3000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": other_user.id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": other_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 1000, "is_guest": True}
        ]
    }
    client.post("/expenses/", headers=auth_headers, json=payload)

    # Check Group Balances (Specific endpoint likely /groups/{id}/balances or similar for aggregated view? 
    # The normal /balances/ endpoint might also aggregate depending on implementation)
    
    # Let's check the group-specific balance endpoint if it exists or use the general one.
    # Looking at schemas, GroupBalance has 'managed_guests' list.
    response = client.get(f"/groups/{group_id}/balances", headers=auth_headers)
    assert response.status_code == 200
    group_balances = response.json()

    # We expect to see an entry for Test User with valid negative amount
    my_balance = next((b for b in group_balances if b["user_id"] == test_user.id and not b["is_guest"]), None)
    assert my_balance is not None
    # 'amount' is what the user *is owed*. Since we owe, it should be negative.
    # We owe 10 for self + 10 for guest = 20 total.
    assert my_balance["amount"] == -2000.0
    assert any("My Guest" in g for g in my_balance["managed_guests"])


# ---------------------------------------------------------------------------
# Characterization tests for the _fold_managed_relationships helper.
#
# These pin the scalar folding semantics that calculate_net_balances delegates
# to the helper in single-currency mode. The multi-currency branch is covered
# by the existing test_guest_balance_aggregation integration test above and
# deliberately stays inline in calculate_net_balances.
# ---------------------------------------------------------------------------


def _make_group(db_session, creator_id: int = 1) -> Group:
    """Insert a Group row and return it (with id populated)."""
    group = Group(name="Fold Test Group", created_by_id=creator_id, default_currency="USD")
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)
    return group


def test_fold_managed_guest_scalar(db_session):
    """Managed guest at -50 folded into manager at +30 → manager ends at -20, guest key removed."""
    group = _make_group(db_session)

    # Manager is user_id=10 (not a guest)
    manager_key = (10, False)

    # Guest is managed by user 10
    guest = GuestMember(
        group_id=group.id,
        name="Managed Guest",
        created_by_id=1,
        managed_by_id=10,
        managed_by_type="user",
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    guest_key = (guest.id, True)
    totals = {manager_key: 30.0, guest_key: -50.0}

    _fold_managed_relationships(db_session, group.id, totals)

    # Byte-for-byte pinned expected output
    assert totals == {manager_key: -20.0}


def test_fold_managed_member_scalar(db_session):
    """Same shape as the guest case but using GroupMember.managed_by_id."""
    group = _make_group(db_session)

    # Manager user_id=20. Managed member user_id=21 is managed by user 20.
    manager_key = (20, False)
    managed_member_user_id = 21

    member = GroupMember(
        group_id=group.id,
        user_id=managed_member_user_id,
        managed_by_id=20,
        managed_by_type="user",
    )
    db_session.add(member)
    db_session.commit()

    managed_key = (managed_member_user_id, False)
    totals = {manager_key: 30.0, managed_key: -50.0}

    _fold_managed_relationships(db_session, group.id, totals)

    assert totals == {manager_key: -20.0}


def test_fold_defensive_skip_on_claimed_and_managed_guest(db_session, caplog):
    """A claimed guest that also has managed_by_id set must be skipped (and warn)."""
    group = _make_group(db_session)

    claimer_user_id = 100  # the registered user who claimed the guest
    manager_user_id = 200  # the user the guest would fold into (but won't, due to skip)

    guest = GuestMember(
        group_id=group.id,
        name="Bad Data Guest",
        created_by_id=1,
        claimed_by_id=claimer_user_id,       # claimed …
        managed_by_id=manager_user_id,       # … AND managed. Should skip.
        managed_by_type="user",
    )
    db_session.add(guest)
    db_session.commit()

    # The claimed-guest balance lives under the claimer's key.
    claimer_key = (claimer_user_id, False)
    manager_key = (manager_user_id, False)

    totals = {claimer_key: -50.0, manager_key: 30.0}
    totals_before = dict(totals)

    import logging
    with caplog.at_level(logging.WARNING):
        _fold_managed_relationships(db_session, group.id, totals)

    # Nothing moved: the defensive skip fired.
    assert totals == totals_before
    # And a warning was logged about the data integrity issue.
    assert any("Bad Data Guest" in record.message for record in caplog.records)


def test_fold_iteration_order_independence_two_guests_into_one_manager(db_session):
    """Two managed guests fold into the same manager → same final total regardless of order."""
    group = _make_group(db_session)

    manager_user_id = 50
    manager_key = (manager_user_id, False)

    guest_a = GuestMember(
        group_id=group.id,
        name="Guest A",
        created_by_id=1,
        managed_by_id=manager_user_id,
        managed_by_type="user",
    )
    guest_b = GuestMember(
        group_id=group.id,
        name="Guest B",
        created_by_id=1,
        managed_by_id=manager_user_id,
        managed_by_type="user",
    )
    db_session.add_all([guest_a, guest_b])
    db_session.commit()
    db_session.refresh(guest_a)
    db_session.refresh(guest_b)

    key_a = (guest_a.id, True)
    key_b = (guest_b.id, True)

    # Build totals in one order; helper folds in its own DB query order.
    totals_1 = {manager_key: 100.0, key_a: -40.0, key_b: -25.0}
    _fold_managed_relationships(db_session, group.id, totals_1)

    # Build equivalent totals and run again (helper is idempotent-in-shape
    # for a fresh dict, so this validates commutativity of the fold).
    totals_2 = {manager_key: 100.0, key_b: -25.0, key_a: -40.0}
    _fold_managed_relationships(db_session, group.id, totals_2)

    assert totals_1 == {manager_key: 35.0}
    assert totals_2 == {manager_key: 35.0}
    assert totals_1 == totals_2


def test_fold_helper_accepts_arbitrary_scalar_dict(db_session):
    """The helper is callable with an arbitrary scalar-valued dict (no real prior balance scan)."""
    group = _make_group(db_session)

    manager_user_id = 7
    manager_key = (manager_user_id, False)

    guest = GuestMember(
        group_id=group.id,
        name="Scalar Guest",
        created_by_id=1,
        managed_by_id=manager_user_id,
        managed_by_type="user",
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    # Caller supplies an int-valued dict (the future consumption primitive will
    # use int cents). Helper should fold without assuming float.
    totals = {(guest.id, True): 60, manager_key: 0}

    _fold_managed_relationships(db_session, group.id, totals)

    assert totals == {manager_key: 60}
