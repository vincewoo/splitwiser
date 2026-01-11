#!/usr/bin/env python3
"""Migration script to add friend_requests table."""

import sqlite3
import os
import argparse

# Default database path (relative to backend directory)
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'db.sqlite3')


def migrate(db_path: str = None):
    """Add friend_requests table to the database."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        print("Please specify the correct path with --db-path")
        return False
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check if table already exists
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='friend_requests'
        """)
        if cursor.fetchone():
            print("friend_requests table already exists, skipping migration.")
            return True
        
        # Create the friend_requests table
        cursor.execute("""
            CREATE TABLE friend_requests (
                id INTEGER PRIMARY KEY,
                from_user_id INTEGER NOT NULL,
                to_user_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create indexes for frequent lookups
        cursor.execute("""
            CREATE INDEX ix_friend_requests_from_user_id 
            ON friend_requests(from_user_id)
        """)
        cursor.execute("""
            CREATE INDEX ix_friend_requests_to_user_id 
            ON friend_requests(to_user_id)
        """)
        cursor.execute("""
            CREATE INDEX ix_friend_requests_id 
            ON friend_requests(id)
        """)
        
        conn.commit()
        print("Successfully created friend_requests table with indexes.")
        return True
        
    except sqlite3.Error as e:
        print(f"Error creating friend_requests table: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Add friend_requests table to database')
    parser.add_argument('--db-path', type=str, default=None,
                        help='Path to SQLite database file (default: backend/db.sqlite3)')
    args = parser.parse_args()
    migrate(args.db_path)
