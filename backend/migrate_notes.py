import sqlite3
import os

# Database path (default to ./db.sqlite3 for local dev, or use env var)
# In production, this should point to the correct DB file or connection string
DB_PATH = os.getenv("DATABASE_URL", "db.sqlite3")

def migrate():
    # Handle sqlite:// prefix if present (SQLAlchemy format)
    db_file = DB_PATH.replace("sqlite:///", "")
    
    if not os.path.exists(db_file):
        print(f"Database file {db_file} not found.")
        return

    print(f"Connecting to database: {db_file}")
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    try:
        # Check if column already exists
        cursor.execute("PRAGMA table_info(expenses)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if "notes" in columns:
            print("Column 'notes' already exists in 'expenses' table.")
        else:
            print("Adding 'notes' column to 'expenses' table...")
            cursor.execute("ALTER TABLE expenses ADD COLUMN notes TEXT")
            conn.commit()
            print("Migration successful.")
            
    except Exception as e:
        print(f"An error occurred during migration: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
