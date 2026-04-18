"""
Endpoint-level tests for ``GET /groups/{group_id}/summary``.

These exercise the HTTP surface: auth (401/403), existence (404), response
shape, sort order, managed-member folding, and the three-way reconciliation
invariant ``group_total == Σ members[].total == Σ series[].total``. The
heavy numeric coverage of the underlying aggregation primitive lives in
``tests/test_summary_aggregation.py``; intentionally kept light here.
"""

from datetime import date

from models import GroupMember, User
from auth import get_password_hash


# --------------------------------------------------------------------------- #
# Small helpers — mirror the test_balances.py style of building fixtures via  #
# client POSTs so we exercise the real group / expense creation code paths.   #
# --------------------------------------------------------------------------- #


def _make_second_user(db_session, email: str = "other@example.com", name: str = "Other") -> User:
    """Insert a second registered user directly into the session."""
    user = User(
        email=email,
        hashed_password=get_password_hash("password123"),
        full_name=name,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _auth_headers_for(user: User) -> dict:
    """Build an Authorization header for a user without going through /token."""
    from auth import create_access_token
    token = create_access_token(data={"sub": user.email})
    return {"Authorization": f"Bearer {token}"}


def _post_expense(
    client,
    headers,
    *,
    group_id: int,
    amount: int,
    payer_id: int,
    splits: list,
    description: str = "Lunch",
    currency: str = "USD",
    expense_date: str | None = None,
    split_type: str = "EQUAL",
) -> dict:
    """POST /expenses/ with a sensible default for date."""
    payload = {
        "description": description,
        "amount": amount,
        "currency": currency,
        "date": expense_date or str(date.today()),
        "payer_id": payer_id,
        "group_id": group_id,
        "split_type": split_type,
        "splits": splits,
    }
    resp = client.post("/expenses/", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --------------------------------------------------------------------------- #
# Happy-path tests                                                            #
# --------------------------------------------------------------------------- #


def test_happy_path_shape_and_currency(client, auth_headers, db_session, test_user):
    """Authenticated member gets 200 with the expected schema + pass-through currency."""
    # USD group, two members, one non-settlement expense.
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Summary Group", "default_currency": "USD"},
    )
    group_id = group_resp.json()["id"]

    other = _make_second_user(db_session, email="member1@example.com", name="Member One")
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": other.email},
    )

    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=2000,
        payer_id=test_user.id,
        splits=[
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": other.id, "amount_owed": 1000, "is_guest": False},
        ],
    )

    resp = client.get(f"/groups/{group_id}/summary", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()

    # Expected top-level keys (no skipped_unparseable_dates!).
    assert set(body.keys()) == {
        "group_total",
        "currency",
        "granularity",
        "has_synthesized_historical_rate",
        "members",
        "series",
    }
    assert body["currency"] == "USD"
    assert body["granularity"] in {"week", "month", "quarter"}
    assert isinstance(body["has_synthesized_historical_rate"], bool)
    assert body["group_total"] == 2000  # Σ split.amount_owed

    # members[] shape
    assert len(body["members"]) == 2
    for m in body["members"]:
        assert set(m.keys()) == {
            "user_id", "is_guest", "display_name", "total", "managed_members",
        }
        assert isinstance(m["user_id"], int)
        assert isinstance(m["is_guest"], bool)
        assert isinstance(m["display_name"], str)
        assert isinstance(m["total"], int)  # integer cents
        assert isinstance(m["managed_members"], list)

    # series[] shape
    assert len(body["series"]) >= 1
    for s in body["series"]:
        assert set(s.keys()) == {"period_label", "period_start", "total", "per_member"}
        assert isinstance(s["period_label"], str)
        assert isinstance(s["period_start"], str)
        assert isinstance(s["total"], int)
        for pm in s["per_member"]:
            assert set(pm.keys()) == {"user_id", "is_guest", "amount"}
            assert isinstance(pm["amount"], int)


def test_members_sorted_by_total_descending(client, auth_headers, db_session, test_user):
    """members[] must come back sorted by total descending (server-authoritative)."""
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Sort Group", "default_currency": "USD"},
    )
    group_id = group_resp.json()["id"]

    other = _make_second_user(db_session, email="bigspender@example.com", name="Big Spender")
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": other.email},
    )

    # Skewed split: other owes 2500, test_user owes 500. other's total should lead.
    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=3000,
        payer_id=test_user.id,
        split_type="EXACT",
        splits=[
            {"user_id": test_user.id, "amount_owed": 500, "is_guest": False},
            {"user_id": other.id, "amount_owed": 2500, "is_guest": False},
        ],
    )

    body = client.get(f"/groups/{group_id}/summary", headers=auth_headers).json()
    members = body["members"]
    assert len(members) == 2

    totals = [m["total"] for m in members]
    assert totals == sorted(totals, reverse=True)
    # And the lead row is the bigger-spender.
    assert members[0]["user_id"] == other.id
    assert members[0]["total"] == 2500
    assert members[1]["user_id"] == test_user.id
    assert members[1]["total"] == 500


def test_managed_guest_folded_into_manager_with_breakdown(
    client, auth_headers, db_session, test_user
):
    """Managed guest's consumption lands on the manager's row + appears as a managed_members entry."""
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Managed Group", "default_currency": "USD"},
    )
    group_id = group_resp.json()["id"]

    # Add a second member so we have at least two registered-user consumers.
    other = _make_second_user(db_session, email="managed@example.com", name="Other M")
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": other.email},
    )

    # Create a guest and have test_user manage them.
    guest_resp = client.post(
        f"/groups/{group_id}/guests",
        headers=auth_headers,
        json={"name": "My Guest"},
    )
    guest_id = guest_resp.json()["id"]
    client.post(
        f"/groups/{group_id}/guests/{guest_id}/manage",
        headers=auth_headers,
        json={"user_id": test_user.id, "is_guest": False},
    )

    # Other pays 3000; split evenly among [other, test_user, guest].
    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=3000,
        payer_id=other.id,
        splits=[
            {"user_id": other.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 1000, "is_guest": True},
        ],
    )

    body = client.get(f"/groups/{group_id}/summary", headers=auth_headers).json()

    # After folding: test_user row carries the guest's 1000 → total = 2000.
    # The guest key must NOT appear as its own top-level row.
    members_by_key = {(m["user_id"], m["is_guest"]): m for m in body["members"]}
    assert (guest_id, True) not in members_by_key

    tu_row = members_by_key[(test_user.id, False)]
    assert tu_row["total"] == 2000

    # Breakdown names include the guest.
    managed_names = [mm["display_name"] for mm in tu_row["managed_members"]]
    assert "My Guest" in managed_names
    # And the guest's share is recorded as 1000.
    mm_entry = next(mm for mm in tu_row["managed_members"] if mm["display_name"] == "My Guest")
    assert mm_entry["total"] == 1000


# --------------------------------------------------------------------------- #
# Error paths                                                                 #
# --------------------------------------------------------------------------- #


def test_non_member_gets_403(client, auth_headers, db_session, test_user):
    """A logged-in user who is not a member of the group gets 403 from verify_group_membership."""
    # test_user creates a group (becomes a member via POST /groups/ side effect).
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Private Group", "default_currency": "USD"},
    ).json()["id"]

    # Second registered user NOT added to the group.
    outsider = _make_second_user(db_session, email="outsider@example.com", name="Outsider")
    outsider_headers = _auth_headers_for(outsider)

    resp = client.get(f"/groups/{group_id}/summary", headers=outsider_headers)
    assert resp.status_code == 403


def test_nonexistent_group_returns_404(client, auth_headers):
    """An unknown group_id returns 404 (before the membership check fires)."""
    resp = client.get("/groups/99999/summary", headers=auth_headers)
    assert resp.status_code == 404


def test_unauthenticated_request_returns_401(client, auth_headers):
    """No Authorization header → 401 from get_current_user."""
    # Create a real group so the 401 isn't accidentally a 404.
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Auth Required", "default_currency": "USD"},
    ).json()["id"]

    resp = client.get(f"/groups/{group_id}/summary")
    assert resp.status_code == 401


# --------------------------------------------------------------------------- #
# Integration: three-way reconciliation                                       #
# --------------------------------------------------------------------------- #


def test_three_way_reconciliation_group_members_series(
    client, auth_headers, db_session, test_user
):
    """
    group_total == Σ members[].total == Σ series[].total

    Heavy numeric coverage lives in tests/test_summary_aggregation.py; this
    pins the invariant at the HTTP layer across a realistic fixture with
    multiple expenses on different dates.
    """
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Reconcile Group", "default_currency": "USD"},
    ).json()["id"]

    other = _make_second_user(db_session, email="reconcile@example.com", name="Rec")
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": other.email},
    )

    # Three expenses on three different dates inside a week-granularity span.
    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=2000,
        payer_id=test_user.id,
        expense_date="2026-01-05",
        splits=[
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": other.id, "amount_owed": 1000, "is_guest": False},
        ],
    )
    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=3000,
        payer_id=other.id,
        expense_date="2026-01-15",
        splits=[
            {"user_id": test_user.id, "amount_owed": 1500, "is_guest": False},
            {"user_id": other.id, "amount_owed": 1500, "is_guest": False},
        ],
    )
    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=600,
        payer_id=test_user.id,
        expense_date="2026-01-22",
        split_type="EXACT",
        splits=[
            {"user_id": test_user.id, "amount_owed": 200, "is_guest": False},
            {"user_id": other.id, "amount_owed": 400, "is_guest": False},
        ],
    )

    body = client.get(f"/groups/{group_id}/summary", headers=auth_headers).json()

    members_sum = sum(m["total"] for m in body["members"])
    series_sum = sum(s["total"] for s in body["series"])

    assert body["group_total"] == members_sum
    assert body["group_total"] == series_sum
    assert body["group_total"] == 5600  # 2000 + 3000 + 600
