"""An ad-hoc guest owes nothing once their bill is no longer itemized.

Expense guests are charged only through item assignments. Editing such a bill
to another split type puts the whole amount on the new splits, so a guest
keeping their old amount_owed would be counted twice, under Quick settle and
the split breakdown.
"""

from datetime import date

import pytest


def _itemized_with_guest(client, auth_headers, test_user):
    resp = client.post(
        "/expenses",
        headers=auth_headers,
        json={
            "description": "Ramen",
            "amount": 3000,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "group_id": None,
            "split_type": "ITEMIZED",
            "splits": [],
            "expense_guests": [{"temp_id": "t", "name": "Tancy"}],
            "items": [
                {
                    "description": "Shoyu",
                    "price": 1000,
                    "assignments": [{"user_id": test_user.id, "is_guest": False}],
                },
                {"description": "Miso", "price": 2000, "assignments": [{"temp_guest_id": "t"}]},
            ],
        },
    )
    assert resp.status_code == 200
    expense_id = resp.json()["id"]
    guests = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()["expense_guests"]
    assert [(g["name"], g["amount_owed"]) for g in guests] == [("Tancy", 2000)]
    return expense_id


@pytest.mark.parametrize(
    "split_type, split",
    [
        ("EQUAL", {}),
        ("EXACT", {}),
        ("PERCENTAGE", {"percentage": 100}),
        ("SHARES", {"shares": 1}),
    ],
)
def test_guest_owes_nothing_after_edit_away_from_itemized(
    client, auth_headers, test_user, split_type, split
):
    expense_id = _itemized_with_guest(client, auth_headers, test_user)

    resp = client.put(
        f"/expenses/{expense_id}",
        headers=auth_headers,
        json={
            "description": "Ramen",
            "amount": 3000,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "split_type": split_type,
            "splits": [
                {"user_id": test_user.id, "is_guest": False, "amount_owed": 3000, **split}
            ],
        },
    )
    assert resp.status_code == 200, resp.text

    details = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
    assert [s["amount_owed"] for s in details["splits"]] == [3000]
    assert [(g["name"], g["amount_owed"]) for g in details["expense_guests"]] == [("Tancy", 0)]
