"""The expense feed and detail only treat an id as a user's when it is one.

Guest ids (group guests and ad-hoc expense guests) share their number space
with user ids. A split or payer row whose id happens to equal a user's id
belongs to that user only when the row says it is not a guest's; otherwise
somebody else's expense lands in the user's feed, or opens for them.
"""

from auth import create_access_token
from models import Expense, ExpenseSplit, User


def _stranger(db_session):
    stranger = User(email="stranger@example.com", hashed_password="x", full_name="Stranger")
    db_session.add(stranger)
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(data={'sub': stranger.email})}"}
    return stranger, headers


def _expense(db_session, owner, **fields):
    expense = Expense(
        description=fields.pop("description", "Dinner"),
        amount=1000,
        currency="USD",
        date="2026-10-30",
        payer_id=fields.pop("payer_id", owner.id),
        created_by_id=owner.id,
        split_type="EQUAL",
        group_id=None,
        **fields,
    )
    db_session.add(expense)
    db_session.commit()
    return expense


def _split(db_session, expense, user_id, is_guest):
    db_session.add(
        ExpenseSplit(expense_id=expense.id, user_id=user_id, is_guest=is_guest, amount_owed=500)
    )
    db_session.commit()


def _feed_ids(client, headers):
    resp = client.get("/expenses", headers=headers)
    assert resp.status_code == 200
    return {e["id"] for e in resp.json()}


def test_guest_split_sharing_a_users_id_stays_out_of_their_feed(
    client, test_user, db_session
):
    stranger, headers = _stranger(db_session)
    expense = _expense(db_session, test_user)
    _split(db_session, expense, test_user.id, is_guest=False)
    _split(db_session, expense, stranger.id, is_guest=True)

    assert expense.id not in _feed_ids(client, headers)
    assert client.get(f"/expenses/{expense.id}", headers=headers).status_code == 403


def test_guest_payer_sharing_a_users_id_stays_out_of_their_feed(
    client, test_user, db_session
):
    stranger, headers = _stranger(db_session)
    expense = _expense(db_session, test_user, payer_id=stranger.id, payer_is_guest=True)
    _split(db_session, expense, test_user.id, is_guest=False)

    assert expense.id not in _feed_ids(client, headers)
    assert client.get(f"/expenses/{expense.id}", headers=headers).status_code == 403


def test_expense_guest_payer_sharing_a_users_id_does_not_open_for_them(
    client, test_user, db_session
):
    stranger, headers = _stranger(db_session)
    expense = _expense(
        db_session, test_user, payer_id=stranger.id, payer_is_expense_guest=True
    )
    _split(db_session, expense, test_user.id, is_guest=False)

    assert expense.id not in _feed_ids(client, headers)
    assert client.get(f"/expenses/{expense.id}", headers=headers).status_code == 403


def test_real_split_and_real_payer_still_reach_the_feed(
    client, test_user, auth_headers, db_session
):
    stranger, headers = _stranger(db_session)
    on_it = _expense(db_session, test_user, description="Shared")
    _split(db_session, on_it, stranger.id, is_guest=False)
    paid = _expense(db_session, test_user, description="Paid", payer_id=stranger.id)

    assert {on_it.id, paid.id} <= _feed_ids(client, headers)
    assert on_it.id in _feed_ids(client, auth_headers)
    assert client.get(f"/expenses/{on_it.id}", headers=headers).status_code == 200
    assert client.get(f"/expenses/{paid.id}", headers=headers).status_code == 200
