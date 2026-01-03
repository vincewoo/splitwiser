#!/usr/bin/env python3
"""
Migration script to add indexes to frequently queried columns.
Adds indexes for:
- expenses.group_id
- expense_splits.expense_id
- expense_splits.user_id
"""
import argparse
import sqlite3
import sys
import os

def check_index_exists(cursor, index_name):
    # For SQLite, we check sqlite_master
    cursor.execute(f"SELECT count(*) FROM sqlite_master WHERE type='index' AND name='{index_name}'")
    return cursor.fetchone()[0] > 0

def migrate(db_path, dry_run=False):
    print(f"Database: {db_path}")

    if not os.path.exists(db_path):
        print(f"Error: Database file not found at {db_path}")
        return False

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # List of (index_name, table_name, column_name)
    indexes_to_add = [
        ("ix_expenses_group_id", "expenses", "group_id"),
        ("ix_expense_splits_expense_id", "expense_splits", "expense_id"),
        ("ix_expense_splits_user_id", "expense_splits", "user_id")
    ]

    try:
        changes_pending = False

        # Check existing indexes
        for index_name, table, column in indexes_to_add:
            if check_index_exists(cursor, index_name):
                print(f"✓ Index {index_name} already exists on {table}({column})")
            else:
                changes_pending = True
                print(f"  Pending: Add index {index_name} on {table}({column})")

        if not changes_pending:
            print("No changes needed.")
            return True

        if dry_run:
            print("\nDry run completed. No changes made.")
            return True

        print("\nApplying changes...")

        for index_name, table, column in indexes_to_add:
            if not check_index_exists(cursor, index_name):
                print(f"Adding index {index_name}...")
                cursor.execute(f"CREATE INDEX {index_name} ON {table}({column})")
                print(f"✓ Created index {index_name}")

        conn.commit()
        print("\nMigration completed successfully!")
        return True

    except Exception as e:
        conn.rollback()
        print(f"\nError applying migration: {e}")
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add performance indexes")
    parser.add_argument("--db-path", default="db.sqlite3", help="Path to SQLite database")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")

    args = parser.parse_args()

    # Resolve path relative to backend if running from root
    if not os.path.exists(args.db_path) and os.path.exists(os.path.join("backend", args.db_path)):
        args.db_path = os.path.join("backend", args.db_path)

    success = migrate(args.db_path, args.dry_run)
    sys.exit(0 if success else 1)
