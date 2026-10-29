"""Adding an ad-hoc guest while editing a non-group expense.

The edit form sends a guest the expense doesn't have yet the way the create
form does: by name in expense_guests, referenced from item assignments by its
temp id. The update creates it, then treats it like any saved guest.
"""

from datetime import date


def _itemized(test_user, assignments, expense_guests, group_id=None):
    return {
        "description": "Dinner",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": group_id,
        "split_type": "ITEMIZED",
        "splits": [{"user_id": test_user.id, "amount_owed": 0, "is_guest": False}],
        "expense_guests": expense_guests,
        "items": [
            {"description": "Pasta", "price": 600, "is_tax_tip": False, "assignments": assignments[0]},
            {"description": "Wine", "price": 400, "is_tax_tip": False, "assignments": assignments[1]},
        ],
    }


def _create(client, auth_headers, test_user):
    payload = _itemized(
        test_user,
        [[{"user_id": test_user.id, "is_guest": False}], [{"temp_guest_id": "a"}]],
        [{"temp_id": "a", "name": "Ana"}],
    )
    resp = client.post("/expenses", headers=auth_headers, json=payload)
    assert resp.status_code == 200
    expense_id = resp.json()["id"]
    ana = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()["expense_guests"][0]
    return expense_id, ana


def test_edit_adds_a_new_guest_and_assigns_them(client, auth_headers, test_user):
    expense_id, ana = _create(client, auth_headers, test_user)

    update = _itemized(
        test_user,
        [
            [{"is_guest": False, "temp_guest_id": "new-1"}],
            [{"is_guest": False, "expense_guest_id": ana["id"]}],
        ],
        [{"temp_id": "new-1", "name": "Ben"}],
    )
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 200, resp.json()

    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
    owed = {g["name"]: g["amount_owed"] for g in details["expense_guests"]}
    assert owed == {"Ana": 400, "Ben": 600}
    pasta = next(i for i in details["items"] if i["description"] == "Pasta")
    assert [a["user_name"] for a in pasta["assignments"]] == ["Ben"]


def test_edit_naming_an_existing_guest_does_not_duplicate_them(client, auth_headers, test_user):
    expense_id, ana = _create(client, auth_headers, test_user)

    update = _itemized(
        test_user,
        [[{"is_guest": False, "temp_guest_id": "t"}], [{"user_id": test_user.id, "is_guest": False}]],
        [{"temp_id": "t", "name": "Ana"}],
    )
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 200, resp.json()

    guests = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()["expense_guests"]
    assert [(g["id"], g["name"], g["amount_owed"]) for g in guests] == [(ana["id"], "Ana", 600)]


def test_edit_refuses_new_guests_on_a_group_expense(client, auth_headers, test_user):
    group = client.post("/groups", headers=auth_headers, json={"name": "G", "default_currency": "USD"}).json()
    create = {
        "description": "Lunch",
        "amount": 1000,
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": group["id"],
        "split_type": "EQUAL",
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}],
    }
    resp = client.post("/expenses", headers=auth_headers, json=create)
    assert resp.status_code == 200, resp.json()

    update = {**create, "expense_guests": [{"temp_id": "x", "name": "Ben"}]}
    resp = client.put(f"/expenses/{resp.json()['id']}", headers=auth_headers, json=update)
    assert resp.status_code == 400
    assert "outside of a group" in resp.json()["detail"]


def test_edit_refuses_new_guests_on_a_non_itemized_split(client, auth_headers, test_user):
    expense_id, _ = _create(client, auth_headers, test_user)

    update = {
        **_itemized(test_user, [[], []], [{"temp_id": "x", "name": "Ben"}]),
        "split_type": "EQUAL",
        "items": None,
        "splits": [{"user_id": test_user.id, "amount_owed": 1000, "is_guest": False}],
    }
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 400
    assert "itemized" in resp.json()["detail"]


def test_edit_matches_an_existing_guest_trimmed_and_ignoring_case(client, auth_headers, test_user):
    expense_id, ana = _create(client, auth_headers, test_user)

    update = _itemized(
        test_user,
        [[{"is_guest": False, "temp_guest_id": "t"}], [{"user_id": test_user.id, "is_guest": False}]],
        [{"temp_id": "t", "name": "  ana "}],
    )
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 200, resp.json()

    guests = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()["expense_guests"]
    assert [(g["id"], g["name"], g["amount_owed"]) for g in guests] == [(ana["id"], "Ana", 600)]


def test_edit_refuses_a_blank_guest_name(client, auth_headers, test_user):
    expense_id, _ = _create(client, auth_headers, test_user)

    update = _itemized(
        test_user,
        [[{"is_guest": False, "temp_guest_id": "t"}], [{"user_id": test_user.id, "is_guest": False}]],
        [{"temp_id": "t", "name": "   "}],
    )
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 400

