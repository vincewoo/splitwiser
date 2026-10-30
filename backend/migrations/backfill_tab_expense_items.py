#!/usr/bin/env python3
"""
Migration: give the expenses closed tabs resolved into their item lines.

Closing a tab used to write an ITEMIZED expense with its splits but no
`expense_items` — the lines only ever lived on the tab. An itemized expense is
edited from its lines, so editing one of these started from nothing: a $0
total, and a save that was refused or flattened everyone's share. Closing now
copies the lines across (`routers/tabs.py::_write_expense_items`); this does
the same for the expenses already written.

An expense is filled in when:

  * a closed tab still links to it (see detach_tabs_from_deleted_expenses.py,
    which runs first and drops links that are not the tab's own);
  * it is still ITEMIZED and has no lines of its own;
  * its amount is still the tab's lines plus tax and tip;
  * every seat can be found on it — an account among its splits, an anonymous
    seat as the one expense guest of the same name.

Anything else is reported and left alone. Splits are not touched: they already
hold what everyone owes. Running it twice does nothing the second time.

A failure is reported but does not fail the boot: this only fills in detail,
and nothing else depends on it having run.

Usage:
  python migrations/backfill_tab_expense_items.py --dry-run
  python migrations/backfill_tab_expense_items.py [--db-path path/to/db.sqlite3]
"""

import argparse
import os
import sqlite3
import sys

DATA_DIR = os.getenv(
    "DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
DEFAULT_DB_PATH = os.path.join(DATA_DIR, "db.sqlite3")


def _candidates(cursor):
    """Closed tabs whose ITEMIZED expense has no lines yet."""
    cursor.execute(
        """
        SELECT tabs.id, tabs.name, tabs.expense_id, tabs.tax, tabs.tip,
               expenses.amount
        FROM tabs
        JOIN expenses ON expenses.id = tabs.expense_id
        WHERE tabs.status = 'closed'
          AND expenses.split_type = 'ITEMIZED'
          AND NOT EXISTS (
              SELECT 1 FROM expense_items
              WHERE expense_items.expense_id = expenses.id
          )
        ORDER BY tabs.id
        """
    )
    return cursor.fetchall()


def _seat_refs(cursor, tab_id, expense_id):
    """
    Each seat as it is named on the expense, or a reason one cannot be found.

    Returns (refs, "") or (None, reason). A ref is ("user", id) or
    ("expense_guest", id).
    """
    cursor.execute(
        "SELECT id, user_id, display_name FROM tab_participants"
        " WHERE tab_id = ? ORDER BY id",
        (tab_id,),
    )
    seats = cursor.fetchall()
    cursor.execute(
        "SELECT user_id FROM expense_splits WHERE expense_id = ? AND is_guest = 0",
        (expense_id,),
    )
    split_users = {uid for (uid,) in cursor.fetchall()}
    cursor.execute(
        "SELECT id, name FROM expense_guests WHERE expense_id = ?", (expense_id,)
    )
    guests: dict = {}
    for gid, name in cursor.fetchall():
        guests.setdefault(name.strip().casefold(), []).append(gid)

    refs = {}
    for seat_id, user_id, display_name in seats:
        if user_id is not None:
            if user_id not in split_users:
                return None, f"{display_name!r} is no longer split on the expense"
            refs[seat_id] = ("user", user_id)
            continue
        matches = guests.get(display_name.strip().casefold(), [])
        if len(matches) != 1:
            return None, f"{len(matches)} expense guests named {display_name!r}"
        refs[seat_id] = ("expense_guest", matches[0])
    if not refs:
        return None, "the tab has nobody seated"
    return refs, ""


def _backfill(cursor, tab_id, expense_id, tax, tip, refs):
    cursor.execute(
        "SELECT id, description, price FROM tab_items WHERE tab_id = ? ORDER BY id",
        (tab_id,),
    )
    items = cursor.fetchall()
    cursor.execute(
        "SELECT item_id, participant_id FROM tab_item_claims WHERE tab_id = ?",
        (tab_id,),
    )
    claims = {}
    for item_id, participant_id in cursor.fetchall():
        claims.setdefault(item_id, []).append(participant_id)

    lines = [(desc, price, False, claims.get(iid, [])) for iid, desc, price in items]
    if tax:
        lines.append(("Tax", tax, True, []))
    if tip:
        lines.append(("Tip", tip, True, []))

    for description, price, is_tax_tip, claimers in lines:
        cursor.execute(
            "INSERT INTO expense_items"
            " (expense_id, description, price, is_tax_tip, split_type)"
            " VALUES (?, ?, ?, ?, 'EQUAL')",
            (expense_id, description, price, is_tax_tip),
        )
        item_id = cursor.lastrowid
        if is_tax_tip:
            continue
        # A line nobody claimed went to everyone at close, so it does here.
        assignees = [p for p in claimers if p in refs] or list(refs)
        for participant_id in assignees:
            kind, ref_id = refs[participant_id]
            cursor.execute(
                "INSERT INTO expense_item_assignments"
                " (expense_item_id, user_id, is_guest, expense_guest_id)"
                " VALUES (?, ?, 0, ?)",
                (
                    item_id,
                    ref_id if kind == "user" else None,
                    ref_id if kind == "expense_guest" else None,
                ),
            )
    return len(lines)


def migrate(db_path: str, dry_run: bool = False) -> int:
    if not os.path.exists(db_path):
        print(f"✗ Database not found: {db_path}")
        return 1

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='tabs'"
        )
        if not cursor.fetchone():
            print("• tabs table not present yet — nothing to do.")
            return 0

        candidates = _candidates(cursor)
        if not candidates:
            print("✓ every closed tab's expense already has its lines")

        for tab_id, name, expense_id, tax, tip, amount in candidates:
            cursor.execute(
                "SELECT COALESCE(SUM(price), 0) FROM tab_items WHERE tab_id = ?",
                (tab_id,),
            )
            tab_total = cursor.fetchone()[0] + (tax or 0) + (tip or 0)
            if tab_total != amount:
                print(
                    f"  skipped tab {tab_id} ({name!r}): expense {expense_id} is"
                    f" {amount} cents but the tab adds up to {tab_total}"
                )
                continue

            refs, reason = _seat_refs(cursor, tab_id, expense_id)
            if refs is None:
                print(f"  skipped tab {tab_id} ({name!r}): {reason}")
                continue

            count = _backfill(cursor, tab_id, expense_id, tax, tip, refs)
            verb = "would write" if dry_run else "✓ wrote"
            print(f"{verb} {count} lines onto expense {expense_id} from tab {tab_id} ({name!r})")

        if dry_run:
            print("\nDry run complete — no changes were written.")
            conn.rollback()
            return 0

        conn.commit()
        print("\n✓ Migration complete: closed tabs' expenses carry their lines.")
        return 0

    except sqlite3.Error as error:
        conn.rollback()
        # Not fatal: see the docstring. The app runs fine without the lines.
        print(f"✗ Backfill failed, database not modified: {error}")
        return 0
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy closed tabs' lines onto the expenses they resolved into."
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Database: {args.db_path}")
    return migrate(args.db_path, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
