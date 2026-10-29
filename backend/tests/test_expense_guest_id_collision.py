"""A real user and an ad-hoc expense guest can share an id.

Users and expense guests live in separate tables, so their ids overlap. An
edit used to guess that a plain user_id assignment matching one of the
expense's guests *was* that guest, which put the real user on the bill as
somebody's guest. A guest is only ever named by expense_guest_id.
"""

from datetime import date

from models import Friendship, User


def _setup(client, auth_headers, test_user, db_session):
    friend = User(email="friend@example.com", hashed_password="x", full_name="Friend")
    db_session.add(friend)
    db_session.commit()
    db_session.add(Friendship(user_id1=test_user.id, user_id2=friend.id))
    db_session.commit()

    expense_guests = [{"temp_id": f"g{i}", "name": f"Guest {i}"} for i in range(3)]
    create = {
        "description": "Dinner",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": None,
        "split_type": "ITEMIZED",
        "splits": [{"user_id": test_user.id, "amount_owed": 0, "is_guest": False}],
        "expense_guests": expense_guests,
        "items": [
            {
                "description": "Pasta",
                "price": 1000,
                "is_tax_tip": False,
                "assignments": [{"temp_guest_id": g["temp_id"]} for g in expense_guests],
            },
        ],
    }
    resp = client.post("/expenses", headers=auth_headers, json=create)
    assert resp.status_code == 200
    expense_id = resp.json()["id"]
    guests = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()["expense_guests"]
    twin = next((g for g in guests if g["id"] == friend.id), None)
    assert twin is not None, "fixture needs a guest id that collides with the friend"
    return create, expense_id, friend, twin


def test_real_user_sharing_a_guests_id_stays_a_user(client, auth_headers, test_user, db_session):
    create, expense_id, friend, twin = _setup(client, auth_headers, test_user, db_session)

    update = {
        **create,
        "expense_guests": [],
        "splits": [
            {"user_id": test_user.id, "amount_owed": 0, "is_guest": False},
            {"user_id": friend.id, "amount_owed": 0, "is_guest": False},
        ],
        "items": [
            {
                "description": "Pasta",
                "price": 1000,
                "is_tax_tip": False,
                "assignments": [{"user_id": friend.id, "is_guest": False}],
            },
        ],
    }
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 200, resp.json()

    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
    assignment = details["items"][0]["assignments"][0]
    assert assignment["user_id"] == friend.id
    assert assignment["expense_guest_id"] is None
    assert assignment["user_name"] == "Friend"
    owed = {s["user_id"]: s["amount_owed"] for s in details["splits"]}
    assert owed[friend.id] == 1000
    assert next(g for g in details["expense_guests"] if g["id"] == twin["id"])["amount_owed"] == 0


def test_guest_named_by_expense_guest_id_alone(client, auth_headers, test_user, db_session):
    create, expense_id, friend, twin = _setup(client, auth_headers, test_user, db_session)

    update = {
        **create,
        "expense_guests": [],
        "items": [
            {
                "description": "Pasta",
                "price": 1000,
                "is_tax_tip": False,
                "assignments": [{"is_guest": False, "expense_guest_id": twin["id"]}],
            },
        ],
    }
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 200, resp.json()

    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
    assignment = details["items"][0]["assignments"][0]
    assert assignment["expense_guest_id"] == twin["id"]
    assert assignment["user_id"] is None
    owed = {g["id"]: g["amount_owed"] for g in details["expense_guests"]}
    assert owed.pop(twin["id"]) == 1000
    # The guests whose items were taken away owe nothing now.
    assert set(owed.values()) == {0}
    assert all(s["user_id"] != friend.id for s in details["splits"])
