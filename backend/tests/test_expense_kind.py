"""Write-path compat for ``Expense.kind`` and its ``is_settlement`` alias.

Responses always carry both fields, derived from one another so they can
never disagree. Writes accept either: a stale PWA client sends only the
boolean, a current client sends ``kind``. Contradictions are rejected, and
the income-specific constraints (positive amount, no ITEMIZED) are enforced
here where the UI also enforces them.
"""

from datetime import date

from auth import get_password_hash
from models import User


def _make_group(client, auth_headers, db_session):
    group_id = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Kind Group", "default_currency": "USD"},
    ).json()["id"]
    other = User(
        email="kind@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="Kind Friend",
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()
    db_session.refresh(other)
    client.post(
        f"/groups/{group_id}/members", headers=auth_headers, json={"email": other.email}
    )
    return group_id, other


def _payload(group_id, payer_id, other_id, amount=3000, **overrides):
    payload = {
        "description": "Something",
        "amount": amount,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": payer_id,
        "group_id": group_id,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": payer_id, "amount_owed": amount // 2, "is_guest": False},
            {"user_id": other_id, "amount_owed": amount - amount // 2, "is_guest": False},
        ],
    }
    payload.update(overrides)
    return payload


def test_legacy_settlement_payload_still_creates_a_settlement(
    client, auth_headers, db_session, test_user
):
    """A stale client sends only is_settlement; the response carries both."""
    group_id, other = _make_group(client, auth_headers, db_session)

    response = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, is_settlement=True),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "settlement"
    assert body["is_settlement"] is True

    # And the stored row agrees — the read paths filter on kind.
    detail = client.get(f"/expenses/{body['id']}", headers=auth_headers).json()
    assert detail["kind"] == "settlement"
    assert detail["is_settlement"] is True


def test_kind_settlement_alone_sets_the_compat_alias(
    client, auth_headers, db_session, test_user
):
    """A current client need not bother with the alias; it is derived."""
    group_id, other = _make_group(client, auth_headers, db_session)

    response = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="settlement"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "settlement"
    assert response.json()["is_settlement"] is True


def test_plain_expense_defaults_to_kind_expense(
    client, auth_headers, db_session, test_user
):
    group_id, other = _make_group(client, auth_headers, db_session)

    response = client.post(
        "/expenses/", headers=auth_headers, json=_payload(group_id, test_user.id, other.id)
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "expense"
    assert response.json()["is_settlement"] is False

    # Group expense list serializes kind too.
    listed = client.get(f"/groups/{group_id}/expenses", headers=auth_headers).json()
    assert [e["kind"] for e in listed] == ["expense"]


def test_contradictory_kind_and_is_settlement_are_rejected(
    client, auth_headers, db_session, test_user
):
    group_id, other = _make_group(client, auth_headers, db_session)

    for kind in ("income", "expense"):
        response = client.post(
            "/expenses/",
            headers=auth_headers,
            json=_payload(
                group_id, test_user.id, other.id, kind=kind, is_settlement=True
            ),
        )
        assert response.status_code == 422, (kind, response.text)


def test_unknown_kind_is_rejected(client, auth_headers, db_session, test_user):
    group_id, other = _make_group(client, auth_headers, db_session)

    response = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="windfall"),
    )
    assert response.status_code == 422


def test_income_requires_a_positive_amount(client, auth_headers, db_session, test_user):
    group_id, other = _make_group(client, auth_headers, db_session)

    for amount in (0, -3000):
        response = client.post(
            "/expenses/",
            headers=auth_headers,
            json=_payload(group_id, test_user.id, other.id, amount=amount, kind="income"),
        )
        assert response.status_code == 400, (amount, response.text)
        assert "positive" in response.json()["detail"]


def test_income_rejects_itemized_splits(client, auth_headers, db_session, test_user):
    group_id, other = _make_group(client, auth_headers, db_session)

    payload = _payload(
        group_id,
        test_user.id,
        other.id,
        kind="income",
        split_type="ITEMIZED",
        splits=[],
        items=[
            {
                "description": "Line",
                "price": 3000,
                "assignments": [{"user_id": other.id, "is_guest": False}],
            }
        ],
    )
    response = client.post("/expenses/", headers=auth_headers, json=payload)
    assert response.status_code == 400
    assert "itemized" in response.json()["detail"].lower()


def test_editing_an_income_entry_round_trips_the_kind(
    client, auth_headers, db_session, test_user
):
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="income"),
    ).json()["id"]

    response = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, amount=4000, kind="income"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "income"
    assert response.json()["is_settlement"] is False


def _group_balances(client, auth_headers, group_id):
    return {
        b["user_id"]: b["amount"]
        for b in client.get(
            f"/groups/{group_id}/balances", headers=auth_headers
        ).json()
    }


def test_put_omitting_kind_and_alias_preserves_the_stored_kind(
    client, auth_headers, db_session, test_user
):
    """A PUT that names neither kind nor is_settlement preserves what is
    stored. Letting the schema default decide would downgrade income to a
    plain expense on every such edit — silently reversing the money's
    direction, the one thing an edit must never do by omission."""
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="income"),
    ).json()["id"]

    assert _group_balances(client, auth_headers, group_id) == {
        test_user.id: -1500,
        other.id: 1500,
    }

    response = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id),  # no kind, no is_settlement
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "income"
    assert response.json()["is_settlement"] is False
    assert _group_balances(client, auth_headers, group_id) == {
        test_user.id: -1500,
        other.id: 1500,
    }


def test_explicit_legacy_flag_still_downgrades_income_to_expense(
    client, auth_headers, db_session, test_user
):
    """Documented, accepted edge: a stale PWA client editing an income entry
    sends no kind but an explicit is_settlement=false, which downgrades it to
    a plain expense — and the balances flip back with it. Stale clients
    cannot render income anyway, and the window closes when bundles cycle."""
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="income"),
    ).json()["id"]

    assert _group_balances(client, auth_headers, group_id) == {
        test_user.id: -1500,
        other.id: 1500,
    }

    response = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, is_settlement=False),
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "expense"
    assert response.json()["is_settlement"] is False
    assert _group_balances(client, auth_headers, group_id) == {
        test_user.id: 1500,
        other.id: -1500,
    }


def test_put_can_turn_an_expense_into_income(
    client, auth_headers, db_session, test_user
):
    """The plan's "expense edited to change kind: allowed" edge — an explicit
    kind on PUT flips the row, and the balances with it."""
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id),
    ).json()["id"]

    assert _group_balances(client, auth_headers, group_id) == {
        test_user.id: 1500,
        other.id: -1500,
    }

    response = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="income"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "income"
    assert response.json()["is_settlement"] is False
    assert _group_balances(client, auth_headers, group_id) == {
        test_user.id: -1500,
        other.id: 1500,
    }


def test_put_income_requires_a_positive_amount(
    client, auth_headers, db_session, test_user
):
    """The income rules hold on PUT exactly as on create."""
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="income"),
    ).json()["id"]

    for amount in (0, -3000):
        response = client.put(
            f"/expenses/{expense_id}",
            headers=auth_headers,
            json=_payload(
                group_id, test_user.id, other.id, amount=amount, kind="income"
            ),
        )
        assert response.status_code == 400, (amount, response.text)
        assert "positive" in response.json()["detail"]


def test_put_income_rejects_itemized_splits(
    client, auth_headers, db_session, test_user
):
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, kind="income"),
    ).json()["id"]

    response = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json=_payload(
            group_id,
            test_user.id,
            other.id,
            kind="income",
            split_type="ITEMIZED",
            splits=[],
            items=[
                {
                    "description": "Line",
                    "price": 3000,
                    "assignments": [{"user_id": other.id, "is_guest": False}],
                }
            ],
        ),
    )
    assert response.status_code == 400
    assert "itemized" in response.json()["detail"].lower()


def test_put_with_legacy_settlement_flag_normalizes_kind(
    client, auth_headers, db_session, test_user
):
    """The PUT path normalizes from whichever field the client sent — the old
    footgun where the flag silently drifted from reality is gone."""
    group_id, other = _make_group(client, auth_headers, db_session)
    expense_id = client.post(
        "/expenses/",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id),
    ).json()["id"]

    response = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json=_payload(group_id, test_user.id, other.id, is_settlement=True),
    )
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "settlement"
    assert response.json()["is_settlement"] is True
