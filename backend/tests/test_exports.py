"""Endpoint tests for ``GET /groups/{group_id}/balance_sheet.csv``.

Auth, headers, and a round-trip that parses the response with ``csv.reader``
and asserts the maths reconciles. The heavy numeric coverage lives in
``test_utils_balance_sheet.py`` and ``test_balance_sheet_guests.py``.
"""

import csv
import io

from auth import create_access_token, get_password_hash
from models import User

URL = "/groups/{group_id}/balance_sheet.csv"


def _second_user(db_session, email="other@example.com", name="Other"):
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


def _headers_for(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': user.email})}"}


def _make_group(client, auth_headers, name="Tahoe Trip"):
    response = client.post(
        "/groups", json={"name": name, "default_currency": "USD"}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _add_guest(client, auth_headers, group_id, name):
    response = client.post(
        f"/groups/{group_id}/guests", json={"name": name}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _rows(response, section):
    reader = csv.reader(io.StringIO(response.text))
    return [row for row in reader if row and row[0] == section]


class TestAuthorization:
    def test_unauthenticated_is_rejected(self, client, db_session, test_user, auth_headers):
        group_id = _make_group(client, auth_headers)
        assert client.get(URL.format(group_id=group_id)).status_code == 401

    def test_missing_group_is_404(self, client, auth_headers):
        assert client.get(URL.format(group_id=999999), headers=auth_headers).status_code == 404

    def test_non_member_is_403(self, client, db_session, test_user, auth_headers):
        group_id = _make_group(client, auth_headers)
        outsider = _second_user(db_session, "outsider@example.com", "Outsider")
        response = client.get(URL.format(group_id=group_id), headers=_headers_for(outsider))
        assert response.status_code == 403

    def test_there_is_no_public_share_link_variant(self, client, auth_headers):
        """The sheet states everyone's full position; it is members-only."""
        group_id = _make_group(client, auth_headers)
        response = client.get(f"/public/groups/{group_id}/balance_sheet.csv")
        assert response.status_code in (401, 404, 405)


class TestResponseShape:
    def test_content_type_and_filename(self, client, auth_headers):
        group_id = _make_group(client, auth_headers)
        response = client.get(URL.format(group_id=group_id), headers=auth_headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        disposition = response.headers["content-disposition"]
        assert disposition.startswith("attachment; filename=")
        assert "balance-sheet-tahoe-trip-" in disposition
        assert disposition.endswith('.csv"')

    def test_a_group_name_cannot_smuggle_anything_into_the_header(
        self, client, auth_headers
    ):
        group_id = _make_group(client, auth_headers, name='Trip"; DROP TABLE users')
        response = client.get(URL.format(group_id=group_id), headers=auth_headers)
        disposition = response.headers["content-disposition"]
        assert disposition.count('"') == 2
        assert ";" not in disposition[len("attachment; filename="):]

    def test_empty_group_still_renders_every_required_section(self, client, auth_headers):
        group_id = _make_group(client, auth_headers)
        body = client.get(URL.format(group_id=group_id), headers=auth_headers).text
        for section in ("META", "PEOPLE", "EXPENSES", "NET_BALANCE", "SIMPLIFIED", "CHECKS"):
            assert f"# SECTION: {section}" in body


class TestRoundTrip:
    def test_the_sheet_reconciles_for_a_real_group(
        self, client, db_session, test_user, auth_headers
    ):
        group_id = _make_group(client, auth_headers)
        guest_id = _add_guest(client, auth_headers, group_id, "Dave")

        client.post("/expenses", json={
            "description": "Dinner at Nopa",
            "amount": 9000,
            "currency": "USD",
            "date": "2026-07-04",
            "group_id": group_id,
            "payer_id": test_user.id,
            "split_type": "EQUAL",
            "splits": [
                {"user_id": test_user.id, "is_guest": False, "amount_owed": 4500},
                {"user_id": guest_id, "is_guest": True, "amount_owed": 4500},
            ],
        }, headers=auth_headers)

        response = client.get(URL.format(group_id=group_id), headers=auth_headers)
        assert response.status_code == 200

        checks = _rows(response, "CHECKS")
        assert checks, "the sheet must always state its own consistency"
        failures = [c for c in checks if c[2] != "pass"]
        assert not failures, failures

        net = _rows(response, "NET_BALANCE")
        assert len(net) == 2
        # net_cents is the 10th column; see the NET_BALANCE header.
        assert sum(int(row[9]) for row in net) == 0

        simplified = _rows(response, "SIMPLIFIED")
        assert len(simplified) == 1
        assert simplified[0][1] == "Dave"          # from
        assert simplified[0][9] == "45.00"         # amount

    def test_an_itemized_expense_nests_its_lines_under_the_parent(
        self, client, db_session, test_user, auth_headers
    ):
        group_id = _make_group(client, auth_headers)
        guest_id = _add_guest(client, auth_headers, group_id, "Dave")

        created = client.post("/expenses", json={
            "description": "Groceries",
            "amount": 5000,
            "currency": "USD",
            "date": "2026-07-05",
            "group_id": group_id,
            "payer_id": test_user.id,
            "split_type": "ITEMIZED",
            "splits": [],
            "items": [
                {
                    "description": "Cheese",
                    "price": 4000,
                    "is_tax_tip": False,
                    "assignments": [
                        {"user_id": test_user.id, "is_guest": False},
                        {"user_id": guest_id, "is_guest": True},
                    ],
                },
                {
                    "description": "Tax",
                    "price": 1000,
                    "is_tax_tip": True,
                    "assignments": [],
                },
            ],
        }, headers=auth_headers)
        assert created.status_code == 200, created.text
        expense_id = created.json()["id"]

        response = client.get(URL.format(group_id=group_id), headers=auth_headers)

        items = _rows(response, "ITEM")
        shares = _rows(response, "ITEM_SHARE")
        splits = _rows(response, "SPLIT")

        assert {row[7] for row in items} == {"Cheese", "Tax"}
        # Every child row carries its parent expense id, so the grouping holds
        # after somebody sorts the file.
        assert all(row[1] == str(expense_id) for row in items + shares + splits)

        cheese_shares = [row for row in shares if row[7] == "Cheese"]
        assert len(cheese_shares) == 2
        assert all(row[15] == "20.00" for row in cheese_shares)

        assert not _rows(response, "RECONCILIATION")
        assert all(row[2] == "pass" for row in _rows(response, "CHECKS"))

    def test_a_formula_in_an_expense_description_is_neutralised(
        self, client, db_session, test_user, auth_headers
    ):
        group_id = _make_group(client, auth_headers)
        client.post("/expenses", json={
            "description": "=HYPERLINK(\"http://evil\",\"click\")",
            "amount": 1000,
            "currency": "USD",
            "date": "2026-07-06",
            "group_id": group_id,
            "payer_id": test_user.id,
            "split_type": "EQUAL",
            "splits": [{"user_id": test_user.id, "is_guest": False, "amount_owed": 1000}],
        }, headers=auth_headers)

        response = client.get(URL.format(group_id=group_id), headers=auth_headers)
        expense_rows = _rows(response, "EXPENSE")
        assert expense_rows[0][2].startswith("'=HYPERLINK")
