"""
Database migration: let a tab be paid by somebody who is not a Splitwiser user,
and let the host tick people off as they settle.

The person doing the arithmetic is not always the person who handed over a
card. When a friend with no account picks up the cheque, everybody owes *them*,
directly and outside the app — so the tab needs somewhere to say who that is,
somewhere to put their Venmo handle (they have no User row to hold one), and a
way to record who has already paid them.

Adds:
    tabs.payer_participant_id      - the seat that fronted the bill
    tab_participants.venmo_username - handle for a seat with no account
    tab_participants.paid           - ticked off by the host
    tab_participants.paid_at        - when

All nullable or defaulted, so every existing row keeps its current meaning: no
named payer (the creator is assumed, exactly as before) and nobody marked paid.

Usage:
    python migrations/add_tab_offapp_payer.py [--dry-run] [--db-path <path>]
"""

import argparse
import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).parent.parent / "db.sqlite3"

# (table, column, DDL type + default)
COLUMNS = [
    ("tabs", "payer_participant_id", "INTEGER"),
    ("tab_participants", "venmo_username", "VARCHAR"),
    ("tab_participants", "paid", "BOOLEAN NOT NULL DEFAULT 0"),
    ("tab_participants", "paid_at", "DATETIME"),
]


def check_column_exists(cursor, table_name: str, column_name: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table_name})")
    return column_name in [row[1] for row in cursor.fetchall()]


def run_migration(db_path: str, dry_run: bool = False) -> None:
    if not os.path.exists(db_path):
        print(f"❌ Database file not found: {db_path}")
        sys.exit(1)

    print(f"📂 Using database: {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        added = 0
        for table, column, ddl in COLUMNS:
            if check_column_exists(cursor, table, column):
                print(f"✅ {table}.{column} already exists. Nothing to do.")
                continue

            statement = f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"
            if dry_run:
                print(f"   [DRY RUN] Would execute:\n   {statement}")
            else:
                cursor.execute(statement)
                added += 1
                print(f"🔄 Added {table}.{column}")

        if added and not dry_run:
            conn.commit()
            print(f"✅ Added {added} column(s). Existing tabs are unchanged:")
            print("   no named payer (the creator is assumed), nobody paid.")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Add off-app payer and paid tracking to tabs."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would happen without changing the database",
    )
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help=f"Path to the SQLite database (default: {DEFAULT_DB_PATH})",
    )
    args = parser.parse_args()
    run_migration(args.db_path, args.dry_run)


if __name__ == "__main__":
    main()
