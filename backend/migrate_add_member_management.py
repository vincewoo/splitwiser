"""Database migration: Add managed_by_id and managed_by_type to group_members"""
import sqlite3

# Connect to database
conn = sqlite3.connect('db.sqlite3')
cursor = conn.cursor()

try:
    # Add managed_by_id column
    cursor.execute("ALTER TABLE group_members ADD COLUMN managed_by_id INTEGER DEFAULT NULL")
    print("✓ Added managed_by_id column")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e):
        print("✓ managed_by_id column already exists")
    else:
        raise

try:
    # Add managed_by_type column
    cursor.execute("ALTER TABLE group_members ADD COLUMN managed_by_type TEXT DEFAULT NULL")
    print("✓ Added managed_by_type column")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e):
        print("✓ managed_by_type column already exists")
    else:
        raise

# Commit changes
conn.commit()
conn.close()

print("\nMigration completed successfully!")
