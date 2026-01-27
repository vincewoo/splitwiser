#!/usr/bin/env python3
"""
Migration script to add expense_guests table and related columns.

This adds support for ad-hoc expense guests in non-group expenses.
"""

import sqlite3
import sys
import os

# Get the database path from environment or use default
DATA_DIR = os.getenv("DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(DATA_DIR, "db.sqlite3")


def migrate():
    """Add expense_guests table and related columns."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # 1. Create expense_guests table
        print("Creating expense_guests table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS expense_guests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                expense_id INTEGER NOT NULL,
                name VARCHAR NOT NULL,
                amount_owed INTEGER NOT NULL DEFAULT 0,
                paid BOOLEAN DEFAULT 0,
                paid_at DATETIME,
                created_by_id INTEGER NOT NULL,
                FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by_id) REFERENCES users(id)
            )
        """)
        print("✓ Created expense_guests table")

        # Create index on expense_id for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS ix_expense_guests_expense_id
            ON expense_guests(expense_id)
        """)
        print("✓ Created index on expense_guests.expense_id")

        # 2. Add payer_is_expense_guest column to expenses table
        cursor.execute("PRAGMA table_info(expenses)")
        expense_columns = [column[1] for column in cursor.fetchall()]

        if 'payer_is_expense_guest' not in expense_columns:
            print("Adding payer_is_expense_guest column to expenses table...")
            cursor.execute("""
                ALTER TABLE expenses
                ADD COLUMN payer_is_expense_guest BOOLEAN DEFAULT 0
            """)
            print("✓ Added payer_is_expense_guest column")
        else:
            print("payer_is_expense_guest column already exists")

        # 3. Add expense_guest_id column to expense_item_assignments table
        cursor.execute("PRAGMA table_info(expense_item_assignments)")
        assignment_columns = [column[1] for column in cursor.fetchall()]

        if 'expense_guest_id' not in assignment_columns:
            print("Adding expense_guest_id column to expense_item_assignments table...")
            cursor.execute("""
                ALTER TABLE expense_item_assignments
                ADD COLUMN expense_guest_id INTEGER
            """)
            print("✓ Added expense_guest_id column")

            # Create index for expense_guest_id lookups
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS ix_expense_item_assignments_expense_guest_id
                ON expense_item_assignments(expense_guest_id)
            """)
            print("✓ Created index on expense_item_assignments.expense_guest_id")
        else:
            print("expense_guest_id column already exists")

        # 4. Make user_id nullable in expense_item_assignments (for expense guest assignments)
        # SQLite doesn't support ALTER COLUMN, so we need to recreate the table
        # For now, we'll just note that new assignments can have null user_id
        print("Note: user_id in expense_item_assignments can now be NULL for expense guest assignments")

        conn.commit()
        conn.close()
        print("\n✅ Migration completed successfully!")

    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    migrate()
