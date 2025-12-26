#!/usr/bin/env python3
"""
Database migration script to add managed_by_user_id column to guest_members table
"""
import sqlite3
import sys

def migrate():
    try:
        # Connect to the database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if column already exists
        cursor.execute("PRAGMA table_info(guest_members)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'managed_by_user_id' in columns:
            print("✓ Column 'managed_by_user_id' already exists in guest_members table")
            return True
        
        # Add the column
        print("Adding 'managed_by_user_id' column to guest_members table...")
        cursor.execute("ALTER TABLE guest_members ADD COLUMN managed_by_user_id INTEGER;")
        conn.commit()
        
        print("✓ Successfully added 'managed_by_user_id' column to guest_members table")
        return True
        
    except Exception as e:
        print(f"✗ Error during migration: {e}")
        return False
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
