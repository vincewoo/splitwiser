from datetime import date

import pytest

from auth import get_password_hash
from models import Expense, ExpenseSplit, Friendship, Group, GroupMember, GuestMember, User
from utils.balances import (
    _detect_managed_cycles,
    _fold_managed_relationships,
    calculate_net_balances,
)


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
    # And a warning was logged about the data integrity issue. The guest's
    # display name is deliberately NOT included in the log (PII); the guest
    # id is the actionable identifier.
    assert any(
        "Data integrity issue" in record.getMessage()
        and str(guest.id) in record.getMessage()
        for record in caplog.records
    )


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


# ---------------------------------------------------------------------------
# Circular managed_by cycle detection
# ---------------------------------------------------------------------------


def test_detect_managed_cycles_empty_when_no_cycle(db_session):
    """No cycle present → detector returns an empty set."""
    group = _make_group(db_session)
    guest = GuestMember(
        group_id=group.id,
        name="G",
        created_by_id=1,
        managed_by_id=50,
        managed_by_type="user",
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    cyclic = _detect_managed_cycles([guest], [])
    assert cyclic == set()


def test_detect_managed_cycles_flags_guest_user_two_node_cycle(db_session):
    """Guest A managed_by user U + user U managed_by guest A → both flagged."""
    group = _make_group(db_session)
    user_id = 999

    guest = GuestMember(
        group_id=group.id,
        name="Cycle Guest",
        created_by_id=1,
        managed_by_id=user_id,
        managed_by_type="user",
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    member = GroupMember(
        group_id=group.id,
        user_id=user_id,
        managed_by_id=guest.id,
        managed_by_type="guest",
    )
    db_session.add(member)
    db_session.commit()

    cyclic = _detect_managed_cycles([guest], [member])
    assert (guest.id, True) in cyclic
    assert (user_id, False) in cyclic


def test_fold_managed_relationships_skips_cyclic_pair(db_session, caplog):
    """
    Scalar fold must leave both cyclic entries intact (no silent data loss) and
    emit a WARNING log.
    """
    import logging

    group = _make_group(db_session)
    user_id = 500

    guest = GuestMember(
        group_id=group.id,
        name="Cyclic Guest",
        created_by_id=1,
        managed_by_id=user_id,
        managed_by_type="user",
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    member = GroupMember(
        group_id=group.id,
        user_id=user_id,
        managed_by_id=guest.id,
        managed_by_type="guest",
    )
    db_session.add(member)
    db_session.commit()

    guest_key = (guest.id, True)
    user_key = (user_id, False)
    totals = {guest_key: -40.0, user_key: 25.0}
    totals_before = dict(totals)

    with caplog.at_level(logging.WARNING):
        _fold_managed_relationships(db_session, group.id, totals)

    # Neither key collapsed; the fold was skipped defensively.
    assert totals == totals_before
    # Total preserved (no silent loss): guest + user = -15, same as before.
    assert sum(totals.values()) == sum(totals_before.values())
    # Warning was logged mentioning the cycle and the group id.
    assert any(
        "Managed_by cycle detected" in record.getMessage()
        and str(group.id) in record.getMessage()
        for record in caplog.records
    )


def test_calculate_net_balances_circular_managed_by_reconciles(
    client, auth_headers, db_session, test_user, caplog
):
    """
    Regression: when a cycle exists, ``calculate_net_balances`` must not crash,
    must log a warning, and the sum of balances must still equal zero — i.e.
    no currency is silently dropped.
    """
    import logging

    # Group with test_user as the owner + a second registered user (payer).
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Cycle Group", "default_currency": "USD"},
    )
    group_id = group_resp.json()["id"]

    payer = User(
        email="payer-cycle@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="Payer",
        is_active=True,
    )
    db_session.add(payer)
    db_session.commit()
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": payer.email},
    )

    # Create a guest managed by test_user (first leg of the cycle).
    guest_resp = client.post(
        f"/groups/{group_id}/guests",
        headers=auth_headers,
        json={"name": "Cycle Guest"},
    )
    guest_id = guest_resp.json()["id"]
    client.post(
        f"/groups/{group_id}/guests/{guest_id}/manage",
        headers=auth_headers,
        json={"user_id": test_user.id, "is_guest": False},
    )

    # Flip test_user's GroupMember to be managed by the guest — closes the cycle.
    tu_member = (
        db_session.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.user_id == test_user.id)
        .first()
    )
    tu_member.managed_by_id = guest_id
    tu_member.managed_by_type = "guest"
    db_session.commit()

    # Payer funds a $30 dinner; split evenly across payer / test_user / guest.
    client.post(
        "/expenses/",
        headers=auth_headers,
        json={
            "description": "Cycle Dinner",
            "amount": 3000,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": payer.id,
            "group_id": group_id,
            "split_type": "EQUAL",
            "splits": [
                {"user_id": payer.id, "amount_owed": 1000, "is_guest": False},
                {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
                {"user_id": guest_id, "amount_owed": 1000, "is_guest": True},
            ],
        },
    )

    # Scalar (single-currency) path.
    with caplog.at_level(logging.WARNING):
        scalar_balances = calculate_net_balances(db_session, group_id, "USD")

    # Total of all balances should be ~zero regardless of the fold outcome
    # (payer +2000, debtors -1000 each). Cycle detection must not drop any
    # amount on the floor.
    assert abs(sum(scalar_balances.values())) < 1e-6
    assert any(
        "Managed_by cycle detected" in record.getMessage()
        and str(group_id) in record.getMessage()
        for record in caplog.records
    )

    # Multi-currency path hits a different inline fold — verify it too.
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        multi_balances = calculate_net_balances(db_session, group_id)

    total_usd = 0.0
    for currencies in multi_balances.values():
        total_usd += currencies.get("USD", 0)
    assert abs(total_usd) < 1e-6
    assert any(
        "Managed_by cycle detected" in record.getMessage()
        and str(group_id) in record.getMessage()
        for record in caplog.records
    )


def test_balances_skips_subcent_conversion_residual(client, auth_headers, db_session, test_user):
    """A settled multi-currency group must not linger as a -$0.00 balance.

    Converting an EUR expense to the group's USD at the stored historical rate
    leaves a fractional-cent debt (558.7 cents here); the settlement is quoted
    and recorded in whole cents (559), so a sub-cent residual survives. The
    /balances endpoint works in cents and must drop anything that rounds to
    zero cents, or the group list shows -$0.00 instead of "all square".
    """
    other = User(
        email="residual@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="Residual User",
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()

    group = Group(name="China 2025", created_by_id=test_user.id, default_currency="USD")
    db_session.add(group)
    db_session.commit()
    db_session.add_all([
        GroupMember(group_id=group.id, user_id=test_user.id),
        GroupMember(group_id=group.id, user_id=other.id),
    ])
    db_session.commit()

    # Other pays 10.00 EUR, split equally; EUR->USD rate 1.1174 makes
    # test_user's debt 500 * 1.1174 = 558.7 USD cents.
    eur_expense = Expense(
        description="Dinner",
        amount=1000,
        currency="EUR",
        date=str(date.today()),
        payer_id=other.id,
        payer_is_guest=False,
        group_id=group.id,
        created_by_id=other.id,
        exchange_rate="1.1174",
        split_type="EQUAL",
    )
    db_session.add(eur_expense)
    db_session.commit()
    db_session.add_all([
        ExpenseSplit(expense_id=eur_expense.id, user_id=test_user.id, amount_owed=500, is_guest=False),
        ExpenseSplit(expense_id=eur_expense.id, user_id=other.id, amount_owed=500, is_guest=False),
    ])
    db_session.commit()

    # Before settling, the debt is real and must be reported.
    res = client.get("/balances", headers=auth_headers)
    assert res.status_code == 200
    rows = [b for b in res.json()["balances"] if b.get("group_id") == group.id]
    assert len(rows) == 1
    assert round(rows[0]["amount"]) == -559

    # Settle for the whole-cent figure the plan quotes: 559 USD cents.
    settlement = Expense(
        description="Settle up",
        amount=559,
        currency="USD",
        date=str(date.today()),
        payer_id=test_user.id,
        payer_is_guest=False,
        group_id=group.id,
        created_by_id=test_user.id,
        exchange_rate="1.0",
        split_type="EXACT",
        is_settlement=True,
    )
    db_session.add(settlement)
    db_session.commit()
    db_session.add(
        ExpenseSplit(expense_id=settlement.id, user_id=other.id, amount_owed=559, is_guest=False)
    )
    db_session.commit()

    # Net is +0.3 cents of conversion dust — the group must drop out entirely.
    res = client.get("/balances", headers=auth_headers)
    assert res.status_code == 200
    rows = [b for b in res.json()["balances"] if b.get("group_id") == group.id]
    assert rows == []


@pytest.mark.parametrize(
    "exchange_rate, split_cents, settle_cents, expect_kept, expected_rounded",
    [
        # Residual after settling = settle - split * rate, in USD cents.
        pytest.param("1.1174", 500, 559, False, None, id="plus-0.3-dropped"),
        # 373 * 1.5 = 559.5 exactly (both floats are binary-exact), so the
        # residual is precisely -0.5 — round() is banker's rounding, which
        # sends half a cent to zero. Pinned on purpose; see utils.balances.is_dust.
        pytest.param("1.5", 373, 559, False, None, id="exact-half-cent-dropped-bankers"),
        pytest.param("1.11898", 500, 560, True, 1, id="plus-0.51-kept-shows-one-cent"),
        # A real 1-cent debt must never be treated as dust: a regression to
        # int() truncation or a strict > comparison would drop it.
        pytest.param("1.5", 500, 749, True, -1, id="real-one-cent-debt-kept"),
        pytest.param("1.1174", 500, 558, True, -1, id="minus-0.7-kept"),
    ],
)
def test_balances_dust_threshold_boundaries(
    client, auth_headers, db_session, test_user,
    exchange_rate, split_cents, settle_cents, expect_kept, expected_rounded,
):
    """Pin the dust boundary on /balances: anything that rounds to zero whole
    cents is dropped, anything that rounds to a cent or more survives.

    Same construction as test_balances_skips_subcent_conversion_residual: an
    EUR expense converted at a chosen stored rate leaves a fractional USD-cent
    debt, then a whole-cent settlement lands the net exactly on the boundary
    value under test.
    """
    other = User(
        email="boundary@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="Boundary User",
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()

    group = Group(name="Boundary Group", created_by_id=test_user.id, default_currency="USD")
    db_session.add(group)
    db_session.commit()
    db_session.add_all([
        GroupMember(group_id=group.id, user_id=test_user.id),
        GroupMember(group_id=group.id, user_id=other.id),
    ])
    db_session.commit()

    # Other pays an EUR expense; test_user's half converts to
    # split_cents * exchange_rate USD cents of debt.
    eur_expense = Expense(
        description="Dinner",
        amount=split_cents * 2,
        currency="EUR",
        date=str(date.today()),
        payer_id=other.id,
        payer_is_guest=False,
        group_id=group.id,
        created_by_id=other.id,
        exchange_rate=exchange_rate,
        split_type="EQUAL",
    )
    db_session.add(eur_expense)
    db_session.commit()
    db_session.add_all([
        ExpenseSplit(expense_id=eur_expense.id, user_id=test_user.id, amount_owed=split_cents, is_guest=False),
        ExpenseSplit(expense_id=eur_expense.id, user_id=other.id, amount_owed=split_cents, is_guest=False),
    ])
    db_session.commit()

    # test_user settles for a whole-cent figure, leaving the residual under test.
    settlement = Expense(
        description="Settle up",
        amount=settle_cents,
        currency="USD",
        date=str(date.today()),
        payer_id=test_user.id,
        payer_is_guest=False,
        group_id=group.id,
        created_by_id=test_user.id,
        exchange_rate="1.0",
        split_type="EXACT",
        is_settlement=True,
    )
    db_session.add(settlement)
    db_session.commit()
    db_session.add(
        ExpenseSplit(expense_id=settlement.id, user_id=other.id, amount_owed=settle_cents, is_guest=False)
    )
    db_session.commit()

    res = client.get("/balances", headers=auth_headers)
    assert res.status_code == 200
    rows = [b for b in res.json()["balances"] if b.get("group_id") == group.id]
    if expect_kept:
        assert len(rows) == 1
        assert round(rows[0]["amount"]) == expected_rounded
    else:
        assert rows == []


def test_balances_convert_to_filters_display_dust(
    client, auth_headers, db_session, test_user, monkeypatch
):
    """With convert_to, the dust decision runs on the CONVERTED amount.

    A balance worth a whole cent in the group's own currency (1 JPY cent
    here) converts to well under half a USD cent, so in the converted view —
    the app's default — it would render as -$0.00. The row must be present in
    group-currency mode and dropped in converted mode. Rates are patched on
    routers.balances (where get_current_exchange_rates was imported into), so
    the suite stays offline.
    """
    other = User(
        email="jpy@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="JPY User",
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()

    group = Group(name="Tokyo", created_by_id=test_user.id, default_currency="JPY")
    db_session.add(group)
    db_session.commit()
    db_session.add_all([
        GroupMember(group_id=group.id, user_id=test_user.id),
        GroupMember(group_id=group.id, user_id=other.id),
    ])
    db_session.commit()

    # Other pays 2 JPY cents, split equally: test_user owes exactly 1 JPY
    # cent — a real balance in the group's currency, no conversion involved.
    expense = Expense(
        description="Gum",
        amount=2,
        currency="JPY",
        date=str(date.today()),
        payer_id=other.id,
        payer_is_guest=False,
        group_id=group.id,
        created_by_id=other.id,
        split_type="EQUAL",
    )
    db_session.add(expense)
    db_session.commit()
    db_session.add_all([
        ExpenseSplit(expense_id=expense.id, user_id=test_user.id, amount_owed=1, is_guest=False),
        ExpenseSplit(expense_id=expense.id, user_id=other.id, amount_owed=1, is_guest=False),
    ])
    db_session.commit()

    import routers.balances as balances_router
    monkeypatch.setattr(
        balances_router,
        "get_current_exchange_rates",
        lambda: {"USD": 1.0, "JPY": 147.0},
    )

    # Group-currency view: the 1 JPY cent debt is real and must be reported.
    res = client.get("/balances", headers=auth_headers)
    assert res.status_code == 200
    rows = [b for b in res.json()["balances"] if b.get("group_id") == group.id]
    assert len(rows) == 1
    assert rows[0]["currency"] == "JPY"
    assert round(rows[0]["amount"]) == -1

    # Converted view: 1 JPY cent is ~0.007 USD cents — display dust, dropped.
    res = client.get("/balances?convert_to=USD", headers=auth_headers)
    assert res.status_code == 200
    rows = [b for b in res.json()["balances"] if b.get("group_id") == group.id]
    assert rows == []


# ---------------------------------------------------------------------------
# Money received (kind="income"): the sign flips at aggregation, so the
# receiver ends up owing the split participants — on every surface that
# reads the ledger.
# ---------------------------------------------------------------------------


def _income_group(client, auth_headers, db_session, test_user):
    """Eliz's Airbnb case: test_user receives a $200 refund split equally
    among four — themselves, two members, and a guest. Expected: receiver
    −150.00, each of the other three +50.00."""
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Refund Group", "default_currency": "USD"},
    ).json()["id"]

    others = []
    for n in (1, 2):
        user = User(
            email=f"income{n}@example.com",
            hashed_password=get_password_hash("pw"),
            full_name=f"Income Friend {n}",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        client.post(
            f"/groups/{group_id}/members", headers=auth_headers, json={"email": user.email}
        )
        others.append(user)

    guest_id = client.post(
        f"/groups/{group_id}/guests", headers=auth_headers, json={"name": "Guest Gia"}
    ).json()["id"]

    response = client.post(
        "/expenses/",
        headers=auth_headers,
        json={
            "description": "Airbnb refund",
            "amount": 20000,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "group_id": group_id,
            "split_type": "EQUAL",
            "kind": "income",
            "splits": [
                {"user_id": test_user.id, "amount_owed": 5000, "is_guest": False},
                {"user_id": others[0].id, "amount_owed": 5000, "is_guest": False},
                {"user_id": others[1].id, "amount_owed": 5000, "is_guest": False},
                {"user_id": guest_id, "amount_owed": 5000, "is_guest": True},
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "income"
    assert response.json()["is_settlement"] is False

    return group_id, others, guest_id


def test_income_flips_sign_in_group_balances(client, auth_headers, db_session, test_user):
    group_id, others, guest_id = _income_group(client, auth_headers, db_session, test_user)

    balances = {
        (b["user_id"], b["is_guest"]): b["amount"]
        for b in client.get(f"/groups/{group_id}/balances", headers=auth_headers).json()
    }

    # Receiver nets −R·3/4; the common case where the receiver is also a
    # participant: −(total − own share) = −(20000 − 5000).
    assert balances[(test_user.id, False)] == -15000
    assert balances[(others[0].id, False)] == 5000
    assert balances[(others[1].id, False)] == 5000
    assert balances[(guest_id, True)] == 5000


def test_income_flips_sign_in_the_balances_endpoint(
    client, auth_headers, db_session, test_user
):
    group_id, _, _ = _income_group(client, auth_headers, db_session, test_user)

    balances = client.get("/balances/", headers=auth_headers).json()["balances"]
    group_balance = next(b for b in balances if b.get("group_id") == group_id)
    assert group_balance["amount"] == -15000


def test_income_flips_sign_in_public_share_link_balances(
    client, auth_headers, db_session, test_user
):
    """The public balances loop is a verbatim copy of the ledger loop — the
    share-link page must agree with the group's own Balances screen."""
    group_id, _, _ = _income_group(client, auth_headers, db_session, test_user)
    share_link_id = client.post(
        f"/groups/{group_id}/share", headers=auth_headers
    ).json()["share_link_id"]

    group_balances = {
        (b["user_id"], b["is_guest"]): b["amount"]
        for b in client.get(f"/groups/{group_id}/balances", headers=auth_headers).json()
    }
    public_balances = {
        (b["user_id"], b["is_guest"]): b["amount"]
        for b in client.get(f"/groups/public/{share_link_id}/balances").json()
    }

    assert public_balances == group_balances


def test_income_flips_sign_in_friend_balance(client, auth_headers, db_session, test_user):
    """The friend paths read group expenses too, so the flip is mandatory
    there regardless of where income can be entered."""
    group_id, others, _ = _income_group(client, auth_headers, db_session, test_user)
    friend = others[0]
    db_session.add(Friendship(user_id1=test_user.id, user_id2=friend.id))
    db_session.commit()

    response = client.get(f"/friends/{friend.id}/balance", headers=auth_headers)
    assert response.status_code == 200
    balances = response.json()

    # Friend's +50.00 is owed by the receiver: from test_user's side, −50.00,
    # in dollars — agreeing with the group balances endpoint's cents.
    group_balances = {
        (b["user_id"], b["is_guest"]): b["amount"]
        for b in client.get(f"/groups/{group_id}/balances", headers=auth_headers).json()
    }
    assert len(balances) == 1
    assert balances[0]["currency"] == "USD"
    # The group says the friend is owed +5000; from test_user's side that
    # is −5000, i.e. −50.00 in the friend endpoint's dollars.
    assert balances[0]["amount"] * 100 == -group_balances[(friend.id, False)]
    assert balances[0]["amount"] == -50.0

    # And the friend expense feed reports the same reversed impact per row.
    expenses = client.get(f"/friends/{friend.id}/expenses", headers=auth_headers).json()
    assert len(expenses) == 1
    assert expenses[0]["kind"] == "income"
    assert expenses[0]["balance_impact"] == -5000


def test_one_to_one_income_flips_sign(client, auth_headers, db_session, test_user):
    """A non-group "money received" entry with a friend."""
    friend = User(
        email="oneonone@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="One On One",
        is_active=True,
    )
    db_session.add(friend)
    db_session.commit()
    db_session.refresh(friend)
    db_session.add(Friendship(user_id1=test_user.id, user_id2=friend.id))
    db_session.commit()

    response = client.post(
        "/expenses/",
        headers=auth_headers,
        json={
            "description": "Ticket resale",
            "amount": 3000,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "group_id": None,
            "split_type": "EQUAL",
            "kind": "income",
            "splits": [
                {"user_id": test_user.id, "amount_owed": 1500, "is_guest": False},
                {"user_id": friend.id, "amount_owed": 1500, "is_guest": False},
            ],
        },
    )
    assert response.status_code == 200, response.text

    # /balances: the receiver owes the friend their share.
    balances = client.get("/balances/", headers=auth_headers).json()["balances"]
    row = next(b for b in balances if b["user_id"] == friend.id and not b.get("group_id"))
    assert row["amount"] == -1500

    # Friend balance agrees (in dollars).
    friend_balances = client.get(f"/friends/{friend.id}/balance", headers=auth_headers).json()
    assert friend_balances == [{"amount": -15.0, "currency": "USD"}]


def test_simplify_includes_income_and_stays_stable_when_paid(
    client, auth_headers, db_session, test_user
):
    """Income is a real ledger event: it is in the simplify plan (receiver
    pays the participants), and — like any plan — recording one suggested
    payment leaves the other transactions untouched."""
    group_id, others, guest_id = _income_group(client, auth_headers, db_session, test_user)

    plan = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    edges = [(t["from_id"], t["from_is_guest"], t["to_id"], t["to_is_guest"], round(t["amount"])) for t in plan]

    # The receiver pays each of the three participants their 50.00.
    assert len(plan) == 3
    assert all(e[0] == test_user.id and not e[1] for e in edges)
    assert {(e[2], e[3]) for e in edges} == {
        (others[0].id, False),
        (others[1].id, False),
        (guest_id, True),
    }
    assert all(e[4] == 5000 for e in edges)

    # Record the first suggested payment exactly as the settle screens do.
    paid = plan[0]
    assert client.post(
        "/expenses/",
        headers=auth_headers,
        json={
            "description": "Payment",
            "amount": round(paid["amount"]),
            "currency": paid["currency"],
            "date": str(date.today()),
            "group_id": group_id,
            "payer_id": paid["from_id"],
            "payer_is_guest": paid["from_is_guest"],
            "split_type": "EQUAL",
            "is_settlement": True,
            "splits": [
                {
                    "user_id": paid["to_id"],
                    "is_guest": paid["to_is_guest"],
                    "amount_owed": round(paid["amount"]),
                }
            ],
        },
    ).status_code == 200

    after = client.get(f"/simplify_debts/{group_id}", headers=auth_headers).json()[
        "transactions"
    ]
    assert [
        (t["from_id"], t["from_is_guest"], t["to_id"], t["to_is_guest"], round(t["amount"]))
        for t in after
    ] == edges[1:]
