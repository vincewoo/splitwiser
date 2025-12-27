import sqlite3
import os
import sys

# Match the logic in database.py
# Default to ./db.sqlite3 if not set (local dev)
# In Docker, this should be set to /data/splitwiser.db or similar
DB_PATH = os.environ.get("DATABASE_PATH", "./db.sqlite3")

def migrate():
    print(f"Checking database at {DB_PATH}...")
    
    if not os.path.exists(DB_PATH):
        print(f"Database file not found at {DB_PATH}")
        print("If this is a fresh install, the app will create the table automatically.")
        # We don't error out because maybe the app hasn't started yet
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if table exists first
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'")
        if not cursor.fetchone():
            print("Table 'expenses' does not exist yet. No migration needed (app will create it).")
            return

        # Check if column exists
        cursor.execute("PRAGMA table_info(expenses)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if "receipt_image_path" not in columns:
            print("Adding 'receipt_image_path' column...")
            cursor.execute("ALTER TABLE expenses ADD COLUMN receipt_image_path VARCHAR")
            conn.commit()
            print("Migration successful: Column added.")
        else:
            print("Column 'receipt_image_path' already exists.")
            
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
