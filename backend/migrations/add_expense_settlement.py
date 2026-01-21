#!/usr/bin/env python3
"""
Migration script to add is_settlement column to expenses table.

This allows expenses to be categorized as either regular expenses or settlements/payments.
"""

import sqlite3
import sys
import os

# Get the database path from environment or use default
DATA_DIR = os.getenv("DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(DATA_DIR, "db.sqlite3")

def migrate():
    """Add is_settlement column to expenses table."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # Check if column already exists
        cursor.execute("PRAGMA table_info(expenses)")
        columns = [column[1] for column in cursor.fetchall()]

        if 'is_settlement' not in columns:
            print("Adding is_settlement column to expenses table...")
            cursor.execute("""
                ALTER TABLE expenses
                ADD COLUMN is_settlement BOOLEAN DEFAULT 0
            """)
            print("✓ Added is_settlement column")
        else:
            print("is_settlement column already exists")

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
