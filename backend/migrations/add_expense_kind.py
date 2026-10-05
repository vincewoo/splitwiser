"""
Database migration: generalize the expense/settlement boolean into a kind.

"Money received" (a refund, a returned deposit, sold leftover tickets) is the
dual of an expense: the receiver ends up owing the split participants instead
of the other way round. A second boolean would encode an illegal fourth state
every reader has to guard against, so the two-state ``is_settlement`` flag
becomes a three-state ``kind`` column instead:

    expenses.kind - 'expense' | 'settlement' | 'income'

``is_settlement`` stays for now as a compat alias for stale PWA clients; the
API derives it from ``kind`` at the serialization edge. Existing settlement
rows are backfilled to ``kind='settlement'`` so they keep meaning what they
did; everything else defaults to ``'expense'``.

The column is NOT NULL with a default on purpose: the consumption summary
filters on it in SQL, and a nullable column would silently drop NULL rows
from a ``kind != ...`` comparison.

Usage:
    python migrations/add_expense_kind.py [--dry-run] [--db-path <path>]
"""

import argparse
import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).parent.parent / "db.sqlite3"

COLUMN_DDL = "ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense'"

# Safe to re-run: once a row carries kind='settlement' it no longer matches.
BACKFILL_SQL = "UPDATE expenses SET kind='settlement' WHERE is_settlement=1 AND kind='expense'"


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
        if check_column_exists(cursor, "expenses", "kind"):
            print("✅ expenses.kind already exists. Nothing to add.")
        elif dry_run:
            print(f"   [DRY RUN] Would execute:\n   {COLUMN_DDL}")
        else:
            cursor.execute(COLUMN_DDL)
            print("🔄 Added expenses.kind")

        # Backfill runs even when the column already existed: a migration
        # interrupted between the ALTER and the UPDATE heals on the next boot.
        if dry_run:
            print(f"   [DRY RUN] Would execute:\n   {BACKFILL_SQL}")
        else:
            cursor.execute(BACKFILL_SQL)
            backfilled = cursor.rowcount
            conn.commit()
            print(f"✅ Backfilled {backfilled} settlement row(s) to kind='settlement'.")
            print("   Every other expense keeps kind='expense' — exactly what it meant before.")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Add the three-state kind column to expenses."
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
