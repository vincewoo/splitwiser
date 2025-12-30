#!/usr/bin/env python
"""
Migration: Add constraint to ensure claimed guests don't have managed_by set

This prevents the double-counting bug by ensuring that claimed guests
cannot have a managed_by relationship (since that relationship should
be on the GroupMember record instead).
"""

import sqlite3
import os

def main():
    db_path = os.environ.get("DATABASE_PATH", "./db.sqlite3")

    print(f"Adding constraint check to database at {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Check if any claimed guests have managed_by set (should be 0 after our fix)
        cursor.execute("""
            SELECT id, name, claimed_by_id, managed_by_id
            FROM guest_members
            WHERE claimed_by_id IS NOT NULL
              AND managed_by_id IS NOT NULL
        """)

        violations = cursor.fetchall()

        if violations:
            print(f"❌ Found {len(violations)} claimed guests with managed_by still set:")
            for guest_id, name, claimed_by, managed_by in violations:
                print(f"  - Guest '{name}' (ID: {guest_id})")
            print("\nPlease run fix_claimed_guest_management_doublecount.py first!")
            return 1

        print("✓ No claimed guests with managed_by set - ready to add constraint")

        # Note: SQLite doesn't support adding CHECK constraints to existing tables
        # This would require recreating the table, which is risky for production
        # Instead, we rely on the application-level fix in claim_guest()

        print("\n📝 Note: SQLite doesn't support adding CHECK constraints to existing tables.")
        print("   The fix is enforced at the application level in claim_guest() function.")
        print("   Future guest claims will automatically clear managed_by fields.")

        conn.close()
        return 0

    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        conn.close()
        return 1

if __name__ == "__main__":
    exit(main())
