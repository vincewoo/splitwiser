#!/usr/bin/env python3
"""
Migration: let an item assignment name an ad-hoc guest without a user id.

An assignment names an ad-hoc expense guest by `expense_guest_id` alone and
leaves `user_id` NULL (the guest's id overlaps user ids, so it never goes in
`user_id`). add_expense_guests.py added `expense_guest_id` but left `user_id`
NOT NULL from the table's original definition, so on a database that predates
it every such assignment is refused — and closing a tab with an anonymous
claimer, which writes exactly those, fails.

SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt
with `user_id` nullable, rows and indexes carried over, in one transaction.
A database created from models.py already has the nullable column and is left
alone. Running it twice does nothing the second time.

A failure is reported and rolled back but does not fail the boot: the app runs
as it did before, with guest assignments still refused.

Usage:
  python migrations/relax_assignment_user_id.py --dry-run
  python migrations/relax_assignment_user_id.py [--db-path path/to/db.sqlite3]
"""

import argparse
import os
import sqlite3
import sys

DATA_DIR = os.getenv(
    "DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
DEFAULT_DB_PATH = os.path.join(DATA_DIR, "db.sqlite3")

TABLE = "expense_item_assignments"

REBUILD = [
    """
    CREATE TABLE expense_item_assignments_new (
        id INTEGER NOT NULL,
        expense_item_id INTEGER NOT NULL,
        user_id INTEGER,
        is_guest BOOLEAN,
        expense_guest_id INTEGER,
        PRIMARY KEY (id)
    )
    """,
    """
    INSERT INTO expense_item_assignments_new
        (id, expense_item_id, user_id, is_guest, expense_guest_id)
    SELECT id, expense_item_id, user_id, is_guest, expense_guest_id
    FROM expense_item_assignments
    """,
    "DROP TABLE expense_item_assignments",
    "ALTER TABLE expense_item_assignments_new RENAME TO expense_item_assignments",
    "CREATE INDEX ix_expense_item_assignments_id ON expense_item_assignments (id)",
    "CREATE INDEX ix_expense_item_assignments_expense_guest_id"
    " ON expense_item_assignments (expense_guest_id)",
]


def _user_id_not_null(cursor):
    """True/False for the column's NOT NULL flag, None if the table is missing."""
    cursor.execute(f"PRAGMA table_info({TABLE})")
    for _cid, name, _type, notnull, _default, _pk in cursor.fetchall():
        if name == "user_id":
            return bool(notnull)
    return None


def migrate(db_path: str, dry_run: bool = False) -> int:
    if not os.path.exists(db_path):
        print(f"✗ Database not found: {db_path}")
        return 1

    # Autocommit mode, so the explicit BEGIN below covers the DDL too.
    conn = sqlite3.connect(db_path, isolation_level=None)
    cursor = conn.cursor()

    try:
        not_null = _user_id_not_null(cursor)
        if not_null is None:
            print(f"• {TABLE} not present yet — nothing to do.")
            return 0
        if not not_null:
            print(f"✓ {TABLE}.user_id is already nullable")
            return 0

        cursor.execute(f"SELECT COUNT(*) FROM {TABLE}")
        rows = cursor.fetchone()[0]
        if dry_run:
            print(f"would rebuild {TABLE} with user_id nullable, keeping {rows} rows")
            print("\nDry run complete — no changes were written.")
            return 0

        cursor.execute("BEGIN")
        for statement in REBUILD:
            cursor.execute(statement)
        cursor.execute(f"SELECT COUNT(*) FROM {TABLE}")
        copied = cursor.fetchone()[0]
        if copied != rows:
            raise sqlite3.DatabaseError(f"copied {copied} of {rows} rows")
        cursor.execute("COMMIT")
        print(f"✓ Rebuilt {TABLE} with user_id nullable, {rows} rows kept")
        return 0

    except sqlite3.Error as error:
        if conn.in_transaction:
            cursor.execute("ROLLBACK")
        # Not fatal: see the docstring.
        print(f"✗ Rebuild failed, database not modified: {error}")
        return 0
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Make expense_item_assignments.user_id nullable."
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Database: {args.db_path}")
    return migrate(args.db_path, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
