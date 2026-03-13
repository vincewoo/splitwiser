"""Tests for itemized expense editing and the splits utility functions."""

from datetime import date

from models import User
from auth import get_password_hash
import schemas
from utils.splits import get_assignment_key, calculate_itemized_splits_with_expense_guests


# ── Unit tests for get_assignment_key ────────────────────────────────


class TestGetAssignmentKey:
    def test_regular_user(self):
        a = schemas.ItemAssignment(user_id=1, is_guest=False)
        assert get_assignment_key(a) == "user_1"

    def test_group_guest(self):
        a = schemas.ItemAssignment(user_id=5, is_guest=True)
        assert get_assignment_key(a) == "guest_5"

    def test_temp_guest(self):
        a = schemas.ItemAssignment(temp_guest_id="tmp_abc")
        assert get_assignment_key(a) == "expense_guest_tmp_abc"

    def test_expense_guest_id(self):
        a = schemas.ItemAssignment(expense_guest_id=42)
        assert get_assignment_key(a) == "expense_guest_42"

    def test_expense_guest_id_takes_precedence(self):
        """expense_guest_id is checked first, even if user_id is set."""
        a = schemas.ItemAssignment(user_id=1, is_guest=False, expense_guest_id=10)
        assert get_assignment_key(a) == "expense_guest_10"


# ── Unit tests for calculate_itemized_splits_with_expense_guests ─────


class TestCalculateItemizedSplitsWithExpenseGuests:
    def test_single_user_single_item(self):
        items = [
            schemas.ExpenseItemCreate(
                description="Burger",
                price=1000,
                is_tax_tip=False,
                assignments=[schemas.ItemAssignment(user_id=1, is_guest=False)],
            )
        ]
        splits, eg_amounts = calculate_itemized_splits_with_expense_guests(items)
        assert len(splits) == 1
        assert splits[0].user_id == 1
        assert splits[0].amount_owed == 1000
        assert eg_amounts == {}

    def test_mixed_user_and_expense_guest(self):
        items = [
            schemas.ExpenseItemCreate(
                description="Pizza",
                price=2000,
                is_tax_tip=False,
                assignments=[
                    schemas.ItemAssignment(user_id=1, is_guest=False),
                    schemas.ItemAssignment(temp_guest_id="tmp_bob"),
                ],
            )
        ]
        splits, eg_amounts = calculate_itemized_splits_with_expense_guests(items)
        # User gets half, expense guest gets half
        assert len(splits) == 1
        assert splits[0].user_id == 1
        assert splits[0].amount_owed == 1000
        assert eg_amounts == {"tmp_bob": 1000}

    def test_tax_distributed_proportionally(self):
        items = [
            schemas.ExpenseItemCreate(
                description="Steak",
                price=3000,
                is_tax_tip=False,
                assignments=[schemas.ItemAssignment(user_id=1, is_guest=False)],
            ),
            schemas.ExpenseItemCreate(
                description="Salad",
                price=1000,
                is_tax_tip=False,
                assignments=[schemas.ItemAssignment(user_id=2, is_guest=False)],
            ),
            schemas.ExpenseItemCreate(
                description="Tax",
                price=400,
                is_tax_tip=True,
                assignments=[],
            ),
        ]
        splits, _ = calculate_itemized_splits_with_expense_guests(items)
        amounts = {s.user_id: s.amount_owed for s in splits}
        # User 1: 3000 + 75% of 400 = 3300, User 2: 1000 + 25% of 400 = 1100
        assert amounts[1] + amounts[2] == 4400
        assert amounts[1] == 3300
        assert amounts[2] == 1100

    def test_group_guest_in_splits(self):
        items = [
            schemas.ExpenseItemCreate(
                description="Drink",
                price=600,
                is_tax_tip=False,
                assignments=[schemas.ItemAssignment(user_id=3, is_guest=True)],
            )
        ]
        splits, eg_amounts = calculate_itemized_splits_with_expense_guests(items)
        assert len(splits) == 1
        assert splits[0].is_guest is True
        assert splits[0].user_id == 3
        assert splits[0].amount_owed == 600
        assert eg_amounts == {}


# ── Integration tests for itemized expense editing via API ───────────


def _setup_group_with_members(client, auth_headers, db_session, test_user):
    """Create a group with two members and return (group_id, other_user)."""
    resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Itemized Group", "default_currency": "USD"},
    )
    group_id = resp.json()["id"]

    other = User(
        email="itemized_other@example.com",
        hashed_password=get_password_hash("pw"),
        full_name="Other",
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()
    db_session.refresh(other)
    client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": "itemized_other@example.com"},
    )
    return group_id, other


def _create_itemized_expense(client, auth_headers, group_id, payer_id, items, splits):
    """Helper to create an itemized expense."""
    payload = {
        "description": "Itemized meal",
        "amount": sum(i["price"] for i in items),
        "currency": "USD",
        "date": str(date.today()),
        "payer_id": payer_id,
        "payer_is_guest": False,
        "group_id": group_id,
        "split_type": "ITEMIZED",
        "items": items,
        "splits": splits,
    }
    return client.post("/expenses/", headers=auth_headers, json=payload)


class TestItemizedExpenseEdit:
    def test_edit_itemized_reassigns_splits(self, client, auth_headers, db_session, test_user):
        group_id, other = _setup_group_with_members(client, auth_headers, db_session, test_user)

        # Create with both users split equally on one item
        items = [
            {
                "description": "Shared appetizer",
                "price": 2000,
                "is_tax_tip": False,
                "assignments": [
                    {"user_id": test_user.id, "is_guest": False},
                    {"user_id": other.id, "is_guest": False},
                ],
            }
        ]
        splits = [
            {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
            {"user_id": other.id, "amount_owed": 1000, "is_guest": False},
        ]
        resp = _create_itemized_expense(client, auth_headers, group_id, test_user.id, items, splits)
        assert resp.status_code == 200
        expense_id = resp.json()["id"]

        # Update: reassign everything to test_user only
        updated_items = [
            {
                "description": "Shared appetizer",
                "price": 2000,
                "is_tax_tip": False,
                "assignments": [
                    {"user_id": test_user.id, "is_guest": False},
                ],
            }
        ]
        update_payload = {
            "description": "Itemized meal",
            "amount": 2000,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "payer_is_guest": False,
            "split_type": "ITEMIZED",
            "items": updated_items,
            "splits": [
                {"user_id": test_user.id, "amount_owed": 2000, "is_guest": False},
            ],
        }
        resp = client.put(
            f"/expenses/{expense_id}",
            headers=auth_headers,
            json=update_payload,
        )
        assert resp.status_code == 200

        # Verify splits were recalculated
        detail = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
        assert len(detail["splits"]) == 1
        assert detail["splits"][0]["user_id"] == test_user.id
        assert detail["splits"][0]["amount_owed"] == 2000

    def test_edit_itemized_with_tax_redistributes(self, client, auth_headers, db_session, test_user):
        group_id, other = _setup_group_with_members(client, auth_headers, db_session, test_user)

        # Create with items + tax
        items = [
            {
                "description": "Entree",
                "price": 3000,
                "is_tax_tip": False,
                "assignments": [{"user_id": test_user.id, "is_guest": False}],
            },
            {
                "description": "Side",
                "price": 1000,
                "is_tax_tip": False,
                "assignments": [{"user_id": other.id, "is_guest": False}],
            },
            {
                "description": "Tax",
                "price": 400,
                "is_tax_tip": True,
                "assignments": [],
            },
        ]
        splits = [
            {"user_id": test_user.id, "amount_owed": 3300, "is_guest": False},
            {"user_id": other.id, "amount_owed": 1100, "is_guest": False},
        ]
        resp = _create_itemized_expense(client, auth_headers, group_id, test_user.id, items, splits)
        assert resp.status_code == 200
        expense_id = resp.json()["id"]

        # Update: now both share the entree equally
        updated_items = [
            {
                "description": "Entree",
                "price": 3000,
                "is_tax_tip": False,
                "assignments": [
                    {"user_id": test_user.id, "is_guest": False},
                    {"user_id": other.id, "is_guest": False},
                ],
            },
            {
                "description": "Tax",
                "price": 400,
                "is_tax_tip": True,
                "assignments": [],
            },
        ]
        # Splits will be recalculated server-side for ITEMIZED
        update_payload = {
            "description": "Itemized meal",
            "amount": 3400,
            "currency": "USD",
            "date": str(date.today()),
            "payer_id": test_user.id,
            "payer_is_guest": False,
            "split_type": "ITEMIZED",
            "items": updated_items,
            "splits": [
                {"user_id": test_user.id, "amount_owed": 1700, "is_guest": False},
                {"user_id": other.id, "amount_owed": 1700, "is_guest": False},
            ],
        }
        resp = client.put(
            f"/expenses/{expense_id}",
            headers=auth_headers,
            json=update_payload,
        )
        assert resp.status_code == 200

        detail = client.get(f"/expenses/{expense_id}", headers=auth_headers).json()
        total_split = sum(s["amount_owed"] for s in detail["splits"])
        assert total_split == 3400
        # Verify per-user distribution: each gets 1500 (half of 3000) + 200 (half of 400 tax) = 1700
        amounts = {s["user_id"]: s["amount_owed"] for s in detail["splits"]}
        assert amounts[test_user.id] == 1700
        assert amounts[other.id] == 1700
