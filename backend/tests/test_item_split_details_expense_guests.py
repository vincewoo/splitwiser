"""Per-item split_details for ad-hoc expense guests.

At create time the client only knows its temp ids, so non-equal item details
arrive keyed ``expense_guest_{temp_id}``. Validation and allocation read them
that way (``get_assignment_key`` gives temp ids precedence), but the stored
JSON must carry the real guest ids — hydrating an edit later looks keys up by
``expense_guest_{real_id}``, so persisting temp keys would orphan the details
on the first edit.
"""

from datetime import date


def _base_payload(test_user, items, expense_guests):
    return {
        "description": "Dinner with guest",
        "amount": sum(i["price"] for i in items),
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": test_user.id,
        "group_id": None,
        "split_type": "ITEMIZED",
        "splits": [
            {"user_id": test_user.id, "amount_owed": 0, "is_guest": False},
        ],
        "expense_guests": expense_guests,
        "items": items,
    }


def test_create_remaps_temp_split_detail_keys_to_real_guest_ids(client, auth_headers, test_user):
    payload = _base_payload(
        test_user,
        items=[
            {
                "description": "Pasta",
                "price": 1000,
                "is_tax_tip": False,
                "split_type": "SHARES",
                "split_details": {
                    f"user_{test_user.id}": {"shares": 1},
                    "expense_guest_g1": {"shares": 3},
                },
                "assignments": [
                    {"user_id": test_user.id, "is_guest": False},
                    {"temp_guest_id": "g1"},
                ],
            },
        ],
        expense_guests=[{"temp_id": "g1", "name": "Ad-hoc Guest"}],
    )

    resp = client.post("/expenses", headers=auth_headers, json=payload)
    assert resp.status_code == 200
    expense_id = resp.json()["id"]

    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()

    # The 1:3 shares actually allocated — the guest owes 750 of the 1000.
    guest = details["expense_guests"][0]
    assert guest["amount_owed"] == 750
    my_split = next(s for s in details["splits"] if s["user_id"] == test_user.id)
    assert my_split["amount_owed"] == 250

    # The stored details are keyed by the real guest id, not the temp id, so
    # an edit-mode hydration (which sees real expense_guest_ids) finds them.
    item = next(i for i in details["items"] if not i["is_tax_tip"])
    stored = item["split_details"]
    assert f"expense_guest_{guest['id']}" in stored
    assert stored[f"expense_guest_{guest['id']}"]["shares"] == 3
    assert "expense_guest_g1" not in stored
    assert stored[f"user_{test_user.id}"]["shares"] == 1


def test_update_passes_real_guest_id_keys_through(client, auth_headers, test_user):
    create = _base_payload(
        test_user,
        items=[
            {
                "description": "Pasta",
                "price": 1000,
                "is_tax_tip": False,
                "split_type": "SHARES",
                "split_details": {
                    f"user_{test_user.id}": {"shares": 1},
                    "expense_guest_g1": {"shares": 3},
                },
                "assignments": [
                    {"user_id": test_user.id, "is_guest": False},
                    {"temp_guest_id": "g1"},
                ],
            },
        ],
        expense_guests=[{"temp_id": "g1", "name": "Ad-hoc Guest"}],
    )
    created = client.post("/expenses", headers=auth_headers, json=create)
    assert created.status_code == 200
    expense_id = created.json()["id"]
    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
    guest_id = details["expense_guests"][0]["id"]

    # Edit flow: assignments and details reference the real guest id.
    update = {
        **create,
        "expense_guests": [],
        "items": [
            {
                "description": "Pasta",
                "price": 1000,
                "is_tax_tip": False,
                "split_type": "SHARES",
                "split_details": {
                    f"user_{test_user.id}": {"shares": 1},
                    f"expense_guest_{guest_id}": {"shares": 1},
                },
                "assignments": [
                    {"user_id": test_user.id, "is_guest": False},
                    {"expense_guest_id": guest_id, "is_guest": False},
                ],
            },
        ],
    }
    resp = client.put(f"/expenses/{expense_id}", headers=auth_headers, json=update)
    assert resp.status_code == 200

    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
    assert details["expense_guests"][0]["amount_owed"] == 500
    item = next(i for i in details["items"] if not i["is_tax_tip"])
    assert item["split_details"][f"expense_guest_{guest_id}"]["shares"] == 1
