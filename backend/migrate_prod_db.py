
import sqlite3
import os
import sys

# Production DB path inside container is /data/db.sqlite3 by default from docker-compose
# But we might be running this from outside or inside.
# Checking env var DATABASE_PATH or default to local for testing, but let's make it configurable.

DATABASE_PATH = os.environ.get("DATABASE_PATH", "./db.sqlite3")

def migrate():
    print(f"Migrating database at: {DATABASE_PATH}")
    
    if not os.path.exists(DATABASE_PATH):
        print(f"Database file not found at {DATABASE_PATH}. Nothing to migrate.")
        return

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        # Check if columns exist in groups table
        cursor.execute("PRAGMA table_info(groups)")
        columns = [info[1] for info in cursor.fetchall()]
        
        print(f"Current columns in groups table: {columns}")

        if 'share_link_id' not in columns:
            print("Adding share_link_id column...")
            cursor.execute("ALTER TABLE groups ADD COLUMN share_link_id VARCHAR")
        else:
            print("share_link_id column already exists.")

        if 'is_public' not in columns:
            print("Adding is_public column...")
            cursor.execute("ALTER TABLE groups ADD COLUMN is_public BOOLEAN DEFAULT 0")
        else:
            print("is_public column already exists.")

        conn.commit()
        print("Migration completed successfully.")

    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
