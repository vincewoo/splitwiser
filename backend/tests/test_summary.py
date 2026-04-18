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


# --------------------------------------------------------------------------- #
# Public endpoint tests (Unit 4)                                              #
# --------------------------------------------------------------------------- #
#
# These cover `GET /groups/public/{share_link_id}/summary` — the unauthenticated
# counterpart that returns a strictly narrower response (no members, no names,
# no per_member data). The in-memory TTL cache and per-IP rate limiter are
# verified alongside the happy path and error cases.


def _create_shared_group_with_expense(client, auth_headers, db_session, test_user):
    """Helper: build a public group with one expense. Returns (group_id, share_link_id, other_user)."""
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Public Summary Group", "default_currency": "USD"},
    ).json()["id"]

    other = _make_second_user(db_session, email="public1@example.com", name="Public One")
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": other.email},
    )

    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=2400,
        payer_id=test_user.id,
        splits=[
            {"user_id": test_user.id, "amount_owed": 1200, "is_guest": False},
            {"user_id": other.id, "amount_owed": 1200, "is_guest": False},
        ],
    )

    share_resp = client.post(f"/groups/{group_id}/share", headers=auth_headers)
    assert share_resp.status_code == 200
    share_link_id = share_resp.json()["share_link_id"]
    assert share_link_id is not None

    return group_id, share_link_id, other


def test_public_summary_happy_path_narrow_shape(client, auth_headers, db_session, test_user):
    """Unauthenticated GET on a valid public share link returns the narrow schema."""
    _, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )

    resp = client.get(f"/groups/public/{share_link_id}/summary")
    assert resp.status_code == 200
    body = resp.json()

    # Exact top-level key set — NO `members` leak.
    assert set(body.keys()) == {
        "group_total",
        "currency",
        "granularity",
        "has_synthesized_historical_rate",
        "series",
    }
    assert "members" not in body
    assert body["currency"] == "USD"
    assert body["granularity"] in {"week", "month", "quarter"}
    assert isinstance(body["has_synthesized_historical_rate"], bool)
    assert body["group_total"] == 2400

    # series[] shape — period fields only, no per_member anywhere.
    assert len(body["series"]) >= 1
    for s in body["series"]:
        assert set(s.keys()) == {"period_label", "period_start", "total"}
        assert "per_member" not in s
        assert isinstance(s["total"], int)

    # Recursive sweep for any leaked identifying data.
    def _has_forbidden_key(obj):
        if isinstance(obj, dict):
            return (
                "display_name" in obj
                or "per_member" in obj
                or "members" in obj
                or any(_has_forbidden_key(v) for v in obj.values())
            )
        if isinstance(obj, list):
            return any(_has_forbidden_key(v) for v in obj)
        return False

    assert not _has_forbidden_key(body)


def test_public_summary_group_total_matches_authenticated(
    client, auth_headers, db_session, test_user
):
    """Public response's group_total equals the authenticated response's group_total."""
    group_id, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )

    auth_body = client.get(f"/groups/{group_id}/summary", headers=auth_headers).json()
    public_body = client.get(f"/groups/public/{share_link_id}/summary").json()

    assert public_body["group_total"] == auth_body["group_total"]


def test_public_summary_non_public_group_returns_404(
    client, auth_headers, db_session, test_user
):
    """A share_link for a group whose is_public was flipped off returns 404."""
    group_id, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )
    client.delete(f"/groups/{group_id}/share", headers=auth_headers)

    resp = client.get(f"/groups/public/{share_link_id}/summary")
    assert resp.status_code == 404


def test_public_summary_unknown_share_link_returns_404(client):
    """A share_link_id that doesn't exist returns 404."""
    resp = client.get("/groups/public/does-not-exist-uuid/summary")
    assert resp.status_code == 404


def test_public_summary_rate_limit_429(client, auth_headers, db_session, test_user):
    """
    Exceeding the rate limit returns 429.

    Implementation note: several other tests in this suite make the rate
    limiter override path brittle:
      * The autouse ``disable_rate_limits`` fixture replaces the summary
        limiter with a no-op for every test.
      * ``test_cors_security.py`` calls ``importlib.reload(main)``, creating
        a fresh ``FastAPI`` instance. The conftest's ``client`` fixture holds
        a reference to the original instance; routes on that instance still
        Depend on the singleton ``summary_rate_limiter``.

    The most reliable path given both constraints is to reach into the
    conftest module via ``sys.modules['conftest']`` (that's the module name
    pytest registers the conftest under — there's no ``__init__.py`` in
    ``tests/``) so we manipulate the SAME ``app`` / overrides dict the
    ``client`` fixture captured.
    """
    # Grab the SAME `app` reference the `client` fixture used. Pytest loads
    # the conftest without the ``tests.`` package prefix (there's no
    # ``__init__.py``), so ``sys.modules['conftest']`` is the right handle.
    import sys
    conftest_app = sys.modules["conftest"].app
    from utils.rate_limiter import RateLimiter, summary_rate_limiter

    _, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )

    strict = RateLimiter(requests_limit=3, time_window=60)
    prev_override = conftest_app.dependency_overrides.get(summary_rate_limiter)
    conftest_app.dependency_overrides[summary_rate_limiter] = strict

    try:
        # First 3 requests pass.
        for i in range(3):
            r = client.get(f"/groups/public/{share_link_id}/summary")
            assert r.status_code == 200, f"Request {i+1} was unexpectedly blocked"

        # 4th is over the limit.
        r = client.get(f"/groups/public/{share_link_id}/summary")
        assert r.status_code == 429
    finally:
        if prev_override is not None:
            conftest_app.dependency_overrides[summary_rate_limiter] = prev_override
        else:
            conftest_app.dependency_overrides.pop(summary_rate_limiter, None)


def test_public_summary_cache_hit_skips_recompute(
    client, auth_headers, db_session, test_user
):
    """Second request within TTL for the same share_link_id does NOT re-run the primitive."""
    from unittest.mock import patch

    _, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )

    # Warm the underlying call path once with the real function to validate
    # the fixture is well-formed (unrelated to the count assertion below).
    first = client.get(f"/groups/public/{share_link_id}/summary")
    assert first.status_code == 200

    # Now patch the primitive WHERE THE ROUTER IMPORTED IT and make two more
    # requests. The first of these should hit the cache (populated above);
    # both of them should — so the primitive must be called 0 times.
    with patch(
        "routers.groups.calculate_consumption_summary"
    ) as mock_calc:
        r1 = client.get(f"/groups/public/{share_link_id}/summary")
        r2 = client.get(f"/groups/public/{share_link_id}/summary")

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert mock_calc.call_count == 0, (
            "Cache hit should prevent re-running calculate_consumption_summary"
        )


def test_public_summary_cache_ttl_expiry_reinvokes_primitive(
    client, auth_headers, db_session, test_user
):
    """
    After the TTL elapses, the cached entry is discarded and the primitive
    is re-invoked. We simulate time passage by directly manipulating the
    cache dict to age the entry past the TTL.
    """
    from unittest.mock import patch
    from utils import summary_cache

    _, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )

    # Populate the cache.
    assert client.get(f"/groups/public/{share_link_id}/summary").status_code == 200
    assert share_link_id in summary_cache._cache

    # Age the entry past TTL by rewinding its timestamp.
    response, _inserted_at = summary_cache._cache[share_link_id]
    summary_cache._cache[share_link_id] = (
        response,
        _inserted_at - (summary_cache.TTL_SECONDS + 10),
    )

    # Next request must re-invoke the primitive. Patch it to track call count,
    # but delegate to the real function so the response is valid.
    from utils.summary import calculate_consumption_summary as _real_calc

    with patch(
        "routers.groups.calculate_consumption_summary",
        side_effect=_real_calc,
    ) as mock_calc:
        r = client.get(f"/groups/public/{share_link_id}/summary")
        assert r.status_code == 200
        assert mock_calc.call_count == 1, (
            "Stale cache entry should force recomputation"
        )


def test_public_summary_series_totals_match_authenticated_per_member_sum(
    client, auth_headers, db_session, test_user
):
    """
    Managed-member folding does not change bucket totals — it only redistributes
    attribution. So for every period, the public response's ``series[].total``
    equals the authenticated response's ``series[].total``, which itself equals
    ``Σ per_member[].amount``.
    """
    # Build a group with a managed guest so folding is exercised.
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Reconcile Public Group", "default_currency": "USD"},
    ).json()["id"]

    other = _make_second_user(db_session, email="pub-recon@example.com", name="PR")
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": other.email},
    )

    guest_id = client.post(
        f"/groups/{group_id}/guests",
        headers=auth_headers,
        json={"name": "Folded Guest"},
    ).json()["id"]
    client.post(
        f"/groups/{group_id}/guests/{guest_id}/manage",
        headers=auth_headers,
        json={"user_id": test_user.id, "is_guest": False},
    )

    _post_expense(
        client,
        auth_headers,
        group_id=group_id,
        amount=3000,
        payer_id=other.id,
        expense_date="2026-02-10",
        splits=[
            {"user_id": other.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": guest_id, "amount_owed": 1000, "is_guest": True},
        ],
    )

    share_link_id = client.post(
        f"/groups/{group_id}/share", headers=auth_headers
    ).json()["share_link_id"]

    auth_body = client.get(f"/groups/{group_id}/summary", headers=auth_headers).json()
    public_body = client.get(f"/groups/public/{share_link_id}/summary").json()

    # Same number of buckets + equal totals per bucket.
    assert len(auth_body["series"]) == len(public_body["series"])
    for a, p in zip(auth_body["series"], public_body["series"]):
        assert a["period_label"] == p["period_label"]
        per_member_sum = sum(pm["amount"] for pm in a["per_member"])
        assert a["total"] == per_member_sum
        assert p["total"] == per_member_sum


def test_public_summary_cache_invalidated_on_is_public_toggle_off(
    client, auth_headers, db_session, test_user
):
    """
    Flipping ``is_public`` off via DELETE /groups/{id}/share must invalidate
    the cache entry for that share_link_id — subsequent requests return 404
    instead of the stale cached response.
    """
    from utils import summary_cache

    group_id, share_link_id, _ = _create_shared_group_with_expense(
        client, auth_headers, db_session, test_user
    )

    # Populate the cache.
    r1 = client.get(f"/groups/public/{share_link_id}/summary")
    assert r1.status_code == 200
    assert share_link_id in summary_cache._cache

    # Flip is_public off — cache entry must be evicted.
    client.delete(f"/groups/{group_id}/share", headers=auth_headers)
    assert share_link_id not in summary_cache._cache

    # Subsequent request returns 404, not a stale 200.
    r2 = client.get(f"/groups/public/{share_link_id}/summary")
    assert r2.status_code == 404
