"""
Database migration: Add Google OAuth fields to users table.

This migration adds the following columns to the users table:
- google_id: Google's unique user ID (for OAuth lookups)
- google_picture: Profile picture URL from Google
- auth_provider: Authentication method ('local', 'google', or 'both')

It also creates an index on google_id for fast lookups.

Usage:
    python migrations/add_google_oauth.py [--dry-run] [--db-path <path>]
"""

import sqlite3
import sys
import os
from pathlib import Path

# Default to the database file in the backend directory
DEFAULT_DB_PATH = Path(__file__).parent.parent / "db.sqlite3"


def check_column_exists(cursor, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns


def check_index_exists(cursor, index_name: str) -> bool:
    """Check if an index exists."""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND name=?", (index_name,))
    return cursor.fetchone() is not None


def run_migration(db_path: str, dry_run: bool = False) -> None:
    """
    Run the migration to add Google OAuth fields to users table.

    Args:
        db_path: Path to the SQLite database file
        dry_run: If True, only show what would be done without executing
    """
    if not os.path.exists(db_path):
        print(f"Error: Database file not found: {db_path}")
        sys.exit(1)

    print(f"Using database: {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    changes_made = []

    try:
        # Check and add google_id column
        # Note: SQLite cannot add a UNIQUE column to existing table with data,
        # so we add the column without UNIQUE and enforce uniqueness via index
        if check_column_exists(cursor, "users", "google_id"):
            print("Column 'google_id' already exists. Skipping.")
        else:
            print("Adding 'google_id' column to users table...")
            if dry_run:
                print("   [DRY RUN] Would execute:")
                print("   ALTER TABLE users ADD COLUMN google_id TEXT")
            else:
                cursor.execute(
                    "ALTER TABLE users ADD COLUMN google_id TEXT"
                )
                changes_made.append("google_id column")
                print("Added 'google_id' column")

        # Check and add google_picture column
        if check_column_exists(cursor, "users", "google_picture"):
            print("Column 'google_picture' already exists. Skipping.")
        else:
            print("Adding 'google_picture' column to users table...")
            if dry_run:
                print("   [DRY RUN] Would execute:")
                print("   ALTER TABLE users ADD COLUMN google_picture TEXT")
            else:
                cursor.execute(
                    "ALTER TABLE users ADD COLUMN google_picture TEXT"
                )
                changes_made.append("google_picture column")
                print("Added 'google_picture' column")

        # Check and add auth_provider column
        if check_column_exists(cursor, "users", "auth_provider"):
            print("Column 'auth_provider' already exists. Skipping.")
        else:
            print("Adding 'auth_provider' column to users table...")
            if dry_run:
                print("   [DRY RUN] Would execute:")
                print("   ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local'")
            else:
                cursor.execute(
                    "ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local'"
                )
                changes_made.append("auth_provider column")
                print("Added 'auth_provider' column with default 'local'")

        # Check and add unique index on google_id
        # Using UNIQUE index to enforce uniqueness since we couldn't add UNIQUE constraint on column
        index_name = "ix_users_google_id"
        if check_index_exists(cursor, index_name):
            print(f"Index '{index_name}' already exists. Skipping.")
        else:
            print(f"Creating unique index '{index_name}' on google_id...")
            if dry_run:
                print("   [DRY RUN] Would execute:")
                print(f"   CREATE UNIQUE INDEX {index_name} ON users(google_id)")
            else:
                cursor.execute(
                    f"CREATE UNIQUE INDEX {index_name} ON users(google_id)"
                )
                changes_made.append("google_id index")
                print(f"Created unique index '{index_name}'")

        if not dry_run:
            conn.commit()

        # Verify the migration
        if not dry_run and changes_made:
            print("\nVerifying changes...")

            if "google_id column" in changes_made:
                if check_column_exists(cursor, "users", "google_id"):
                    print("  Verified: google_id column exists")
                else:
                    print("  Error: google_id column not found after migration")
                    sys.exit(1)

            if "google_picture column" in changes_made:
                if check_column_exists(cursor, "users", "google_picture"):
                    print("  Verified: google_picture column exists")
                else:
                    print("  Error: google_picture column not found after migration")
                    sys.exit(1)

            if "auth_provider column" in changes_made:
                if check_column_exists(cursor, "users", "auth_provider"):
                    print("  Verified: auth_provider column exists")
                else:
                    print("  Error: auth_provider column not found after migration")
                    sys.exit(1)

            if "google_id index" in changes_made:
                if check_index_exists(cursor, index_name):
                    print(f"  Verified: {index_name} index exists")
                else:
                    print(f"  Error: {index_name} index not found after migration")
                    sys.exit(1)

            print("\nAll verifications passed!")

    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
        sys.exit(1)

    finally:
        conn.close()

    return changes_made


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Add Google OAuth fields to users table",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python migrations/add_google_oauth.py
  python migrations/add_google_oauth.py --dry-run
  python migrations/add_google_oauth.py --db-path /path/to/db.sqlite3

This migration adds:
  - google_id: Google's unique user ID (indexed for fast OAuth lookups)
  - google_picture: Profile picture URL from Google
  - auth_provider: 'local', 'google', or 'both'
        """
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )

    parser.add_argument(
        "--db-path",
        type=str,
        default=str(DEFAULT_DB_PATH),
        help=f"Path to SQLite database (default: {DEFAULT_DB_PATH})"
    )

    args = parser.parse_args()

    print("Starting migration: Add Google OAuth fields")
    print("=" * 50)

    if args.dry_run:
        print("[DRY RUN MODE - No changes will be made]\n")

    changes = run_migration(args.db_path, args.dry_run)

    print("=" * 50)
    if args.dry_run:
        print("Dry run complete. No changes were made.")
    elif changes:
        print(f"Migration complete! Added: {', '.join(changes)}")
    else:
        print("Migration complete! All columns already exist.")
