"""A closed tab's expense carries the tab's lines, so it can be edited.

Closing used to write an ITEMIZED expense with splits but no items. The edit
form builds an itemized expense from its items, so it started from nothing.
"""

import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from migrations.backfill_tab_expense_items import migrate as backfill
from tests.test_tabs import make_tab, register


def _close_with_maya_and_an_orphan(client):
    """Vince opens; Maya (no account) claims the pizza; the rest is unclaimed."""
    headers = register(client, "vince@example.com", "Vince Woo")
    tab = make_tab(client, headers)
    token = tab["share_token"]
    maya = client.post(
        f"/public/tabs/{token}/join", json={"display_name": "Maya"}
    ).json()
    client.post(
        f"/public/tabs/{token}/items/{tab['items'][0]['id']}/claim",
        json={"claim_token": maya["claim_token"], "claimed": True},
    )
    closed = client.post(f"/tabs/{tab['id']}/close", json={}, headers=headers)
    assert closed.status_code == 200, closed.text
    return headers, closed.json()


def test_closing_writes_the_lines_with_who_had_them(client):
    headers, closed = _close_with_maya_and_an_orphan(client)

    expense = client.get(f"/expenses/{closed['expense_id']}", headers=headers).json()
    lines = {
        i["description"]: (
            i["price"],
            i["is_tax_tip"],
            sorted(a["user_name"] for a in i["assignments"]),
        )
        for i in expense["items"]
    }

    assert lines == {
        "Pizza margherita": (2800, False, ["Maya"]),
        # Unclaimed lines went to the whole table at close.
        "Vinho Verde": (3400, False, ["Maya", "Vince Woo"]),
        "Polvo grelhado": (3100, False, ["Maya", "Vince Woo"]),
        "Tax": (900, True, []),
        "Tip": (1000, True, []),
    }
    maya = expense["expense_guests"][0]
    pizza = next(i for i in expense["items"] if i["description"] == "Pizza margherita")
    assert pizza["assignments"][0]["expense_guest_id"] == maya["id"]


def test_a_closed_tabs_expense_can_be_edited_from_its_lines(client):
    """Resend the lines as the edit form would: the total and shares hold."""
    headers, closed = _close_with_maya_and_an_orphan(client)
    expense_id = closed["expense_id"]
    before = client.get(f"/expenses/{expense_id}", headers=headers).json()

    def assignment(a):
        if a.get("expense_guest_id"):
            return {"is_guest": False, "expense_guest_id": a["expense_guest_id"]}
        return {"user_id": a["user_id"], "is_guest": False}

    update = {
        "description": "Bar Sol, renamed",
        "amount": before["amount"],
        "currency": "USD",
        "date": before["date"],
        "payer_id": before["payer_id"],
        "group_id": None,
        "split_type": "ITEMIZED",
        "splits": [
            {"user_id": s["user_id"], "amount_owed": 0, "is_guest": False}
            for s in before["splits"]
        ],
        "items": [
            {
                "description": i["description"],
                "price": i["price"],
                "is_tax_tip": i["is_tax_tip"],
                "assignments": [assignment(a) for a in i["assignments"]],
            }
            for i in before["items"]
        ],
    }
    response = client.put(f"/expenses/{expense_id}", headers=headers, json=update)
    assert response.status_code == 200, response.text

    after = client.get(f"/expenses/{expense_id}", headers=headers).json()
    assert after["amount"] == before["amount"]
    owed_before = sum(s["amount_owed"] for s in before["splits"]) + sum(
        g["amount_owed"] for g in before["expense_guests"]
    )
    owed_after = sum(s["amount_owed"] for s in after["splits"]) + sum(
        g["amount_owed"] for g in after["expense_guests"]
    )
    assert owed_after == owed_before == before["amount"]
    # Re-allocated from the lines, each share moves by a rounding cent at most.
    maya_before = before["expense_guests"][0]["amount_owed"]
    assert abs(after["expense_guests"][0]["amount_owed"] - maya_before) <= 1


def test_closed_tabs_say_when_they_closed(client):
    headers, closed = _close_with_maya_and_an_orphan(client)

    assert closed["closed_at"] is not None
    listed = client.get("/tabs", headers=headers).json()
    assert [t["closed_at"] is not None for t in listed] == [True]


# ---------------------------------------------------------------------------
# Backfill for expenses closed before the lines were written
# ---------------------------------------------------------------------------


def _legacy_db(path, *, expense_amount=11200, guest_name="Maya"):
    """A tab closed the old way: splits and a guest, but no expense items."""
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add_all(
        [
            models.Expense(
                id=50, description="Bar Sol", amount=expense_amount, currency="USD",
                date="2026-10-01", payer_id=7, group_id=None, created_by_id=7,
                split_type="ITEMIZED",
            ),
            models.ExpenseSplit(expense_id=50, user_id=7, amount_owed=6000),
            models.ExpenseGuest(
                id=3, expense_id=50, name=guest_name, amount_owed=5200,
                created_by_id=7,
            ),
            models.Tab(
                id=1, name="Bar Sol", currency="USD", status="closed", tax=900,
                tip=1000, total=11200, created_by_id=7, payer_id=7, expense_id=50,
                share_token="t", token_expires_at=datetime(2026, 10, 8),
            ),
            models.TabParticipant(
                id=10, tab_id=1, display_name="Vince Woo", user_id=7,
                claim_token="a",
            ),
            models.TabParticipant(
                id=11, tab_id=1, display_name="Maya", user_id=None, claim_token="b",
            ),
            models.TabItem(id=20, tab_id=1, description="Pizza", price=2800),
            models.TabItem(id=21, tab_id=1, description="Vinho", price=3400),
            models.TabItem(id=22, tab_id=1, description="Polvo", price=3100),
            models.TabItemClaim(tab_id=1, item_id=20, participant_id=11),
            models.TabItemClaim(tab_id=1, item_id=21, participant_id=10),
        ]
    )
    session.commit()
    session.close()
    engine.dispose()


def _lines(path):
    with sqlite3.connect(path) as connection:
        rows = connection.execute(
            """
            SELECT i.description, i.price, i.is_tax_tip,
                   group_concat(COALESCE('u' || a.user_id, 'g' || a.expense_guest_id))
            FROM expense_items i
            LEFT JOIN expense_item_assignments a ON a.expense_item_id = i.id
            WHERE i.expense_id = 50
            GROUP BY i.id ORDER BY i.id
            """
        ).fetchall()
    # group_concat has no defined order; who holds a line is a set.
    return [
        (desc, price, tax_tip, ",".join(sorted(who.split(","))) if who else None)
        for desc, price, tax_tip, who in rows
    ]


def test_backfill_writes_the_lines_once(tmp_path):
    db_path = tmp_path / "splitwiser.sqlite3"
    _legacy_db(db_path)

    assert backfill(str(db_path)) == 0
    assert backfill(str(db_path)) == 0

    assert _lines(db_path) == [
        ("Pizza", 2800, 0, "g3"),
        ("Vinho", 3400, 0, "u7"),
        # Unclaimed: the whole table.
        ("Polvo", 3100, 0, "g3,u7"),
        ("Tax", 900, 1, None),
        ("Tip", 1000, 1, None),
    ]


def test_backfill_skips_an_expense_edited_away_from_the_tab(tmp_path):
    db_path = tmp_path / "splitwiser.sqlite3"
    _legacy_db(db_path, expense_amount=9999)

    assert backfill(str(db_path)) == 0
    assert _lines(db_path) == []


def test_backfill_skips_a_tab_whose_guest_cannot_be_found(tmp_path):
    db_path = tmp_path / "splitwiser.sqlite3"
    _legacy_db(db_path, guest_name="Somebody else")

    assert backfill(str(db_path)) == 0
    assert _lines(db_path) == []


def test_backfill_dry_run_writes_nothing(tmp_path):
    db_path = tmp_path / "splitwiser.sqlite3"
    _legacy_db(db_path)

    assert backfill(str(db_path), dry_run=True) == 0
    assert _lines(db_path) == []


def test_backfill_on_a_database_without_tabs(tmp_path):
    db_path = tmp_path / "splitwiser.sqlite3"
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")

    assert backfill(str(db_path)) == 0


def test_startup_runs_the_backfill():
    start_script = (Path(__file__).parents[2] / "start.sh").read_text()
    assert (
        'python migrations/backfill_tab_expense_items.py --db-path "$DATABASE_PATH"'
        in start_script
    )
