#!/usr/bin/env python3
"""
Database migration: Add profile management and password recovery support
------------------------------------------------------------------------
Adds password_reset_tokens and email_verification_tokens tables, plus
new columns to users table for enhanced security and profile management.

Usage:
    python migrations/add_profile_password_recovery.py [--dry-run] [--db-path <path>]

Options:
    --dry-run       Show what would be done without making changes
    --db-path       Path to SQLite database (default: db.sqlite3)
"""

import sqlite3
import os
import sys
import argparse
from pathlib import Path


class MigrationError(Exception):
    """Custom exception for migration errors"""
    pass


def check_column_exists(cursor, table_name, column_name):
    """Check if a column exists in a table"""
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns


def verify_table_exists(cursor, table_name):
    """Verify that a table exists"""
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    )
    return cursor.fetchone() is not None


def get_row_count(cursor, table_name):
    """Get the number of rows in a table"""
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cursor.fetchone()[0]


def run_migration(db_path, dry_run=False):
    """
    Run the migration to add profile management and password recovery

    Args:
        db_path: Path to the SQLite database file
        dry_run: If True, only show what would be done

    Returns:
        bool: True if migration completed successfully
    """
    print(f"{'[DRY RUN] ' if dry_run else ''}Starting migration...")
    print(f"Database: {db_path}")
    print()

    # Check if database exists
    if not Path(db_path).exists():
        raise MigrationError(f"Database file not found: {db_path}")

    # Connect to database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Verify users table exists
        print("✓ Checking if users table exists...")
        if not verify_table_exists(cursor, "users"):
            raise MigrationError("users table not found in database")

        user_count = get_row_count(cursor, "users")
        print(f"  Found {user_count} existing users")
        print()

        # Check current state
        changes_needed = []

        # Check for password_reset_tokens table
        if not verify_table_exists(cursor, "password_reset_tokens"):
            changes_needed.append("Create password_reset_tokens table")
        else:
            print("✓ password_reset_tokens table already exists")

        # Check for email_verification_tokens table
        if not verify_table_exists(cursor, "email_verification_tokens"):
            changes_needed.append("Create email_verification_tokens table")
        else:
            print("✓ email_verification_tokens table already exists")

        # Check for new columns in users table
        if not check_column_exists(cursor, "users", "password_changed_at"):
            changes_needed.append("Add password_changed_at column to users")
        else:
            print("✓ password_changed_at column already exists")

        if not check_column_exists(cursor, "users", "email_verified"):
            changes_needed.append("Add email_verified column to users")
        else:
            print("✓ email_verified column already exists")

        if not check_column_exists(cursor, "users", "last_login_at"):
            changes_needed.append("Add last_login_at column to users")
        else:
            print("✓ last_login_at column already exists")

        if not changes_needed:
            print()
            print("✓ Migration already applied - no changes needed!")
            return True

        print()
        print("Changes to be applied:")
        for i, change in enumerate(changes_needed, 1):
            print(f"  {i}. {change}")
        print()

        if dry_run:
            print("[DRY RUN] Migration would complete successfully")
            print("[DRY RUN] No changes were made to the database")
            return True

        # Begin transaction
        cursor.execute("BEGIN TRANSACTION")

        try:
            # Create password_reset_tokens table if needed
            if not verify_table_exists(cursor, "password_reset_tokens"):
                print("Creating password_reset_tokens table...")
                cursor.execute("""
                    CREATE TABLE password_reset_tokens (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        token_hash TEXT UNIQUE NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME NOT NULL,
                        used BOOLEAN NOT NULL DEFAULT 0,
                        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                    )
                """)
                cursor.execute("CREATE INDEX idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash)")
                cursor.execute("CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at)")
                cursor.execute("CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)")
                print("✓ password_reset_tokens table created")

            # Create email_verification_tokens table if needed
            if not verify_table_exists(cursor, "email_verification_tokens"):
                print("Creating email_verification_tokens table...")
                cursor.execute("""
                    CREATE TABLE email_verification_tokens (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        new_email TEXT NOT NULL,
                        token_hash TEXT UNIQUE NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME NOT NULL,
                        used BOOLEAN NOT NULL DEFAULT 0,
                        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                    )
                """)
                cursor.execute("CREATE INDEX idx_email_verification_tokens_token_hash ON email_verification_tokens(token_hash)")
                cursor.execute("CREATE INDEX idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at)")
                cursor.execute("CREATE INDEX idx_email_verification_tokens_user_id ON email_verification_tokens(user_id)")
                print("✓ email_verification_tokens table created")

            # Add password_changed_at column if needed
            if not check_column_exists(cursor, "users", "password_changed_at"):
                print("Adding password_changed_at column...")
                cursor.execute("ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT NULL")
                print("✓ password_changed_at column added")

            # Add email_verified column if needed
            if not check_column_exists(cursor, "users", "email_verified"):
                print("Adding email_verified column...")
                cursor.execute("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0")
                print("✓ email_verified column added")

            # Add last_login_at column if needed
            if not check_column_exists(cursor, "users", "last_login_at"):
                print("Adding last_login_at column...")
                cursor.execute("ALTER TABLE users ADD COLUMN last_login_at DATETIME DEFAULT NULL")
                print("✓ last_login_at column added")

            # Verify changes
            print()
            print("Verifying changes...")

            # Verify tables
            if "Create password_reset_tokens table" in changes_needed:
                if not verify_table_exists(cursor, "password_reset_tokens"):
                    raise MigrationError("Verification failed: password_reset_tokens table not found after creation")

            if "Create email_verification_tokens table" in changes_needed:
                if not verify_table_exists(cursor, "email_verification_tokens"):
                    raise MigrationError("Verification failed: email_verification_tokens table not found after creation")

            # Verify columns
            if "Add password_changed_at column to users" in changes_needed:
                if not check_column_exists(cursor, "users", "password_changed_at"):
                    raise MigrationError("Verification failed: password_changed_at column not found after creation")

            if "Add email_verified column to users" in changes_needed:
                if not check_column_exists(cursor, "users", "email_verified"):
                    raise MigrationError("Verification failed: email_verified column not found after creation")

            if "Add last_login_at column to users" in changes_needed:
                if not check_column_exists(cursor, "users", "last_login_at"):
                    raise MigrationError("Verification failed: last_login_at column not found after creation")

            # Check that no data was lost
            new_user_count = get_row_count(cursor, "users")
            if new_user_count != user_count:
                raise MigrationError(
                    f"Data loss detected: expected {user_count} rows, found {new_user_count}"
                )

            print("✓ All changes verified successfully")
            print()

            # Commit transaction
            conn.commit()
            print("✓ Migration completed successfully!")
            print()
            print("Summary:")
            print(f"  - Database: {db_path}")
            print(f"  - Users: {user_count}")
            print(f"  - Changes applied: {len(changes_needed)}")

            return True

        except Exception as e:
            # Rollback on error
            conn.rollback()
            raise MigrationError(f"Migration failed and was rolled back: {str(e)}")

    finally:
        cursor.close()
        conn.close()


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Add profile management and password recovery support to Splitwiser database",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run migration on default database
  python migrations/add_profile_password_recovery.py

  # Dry run to see what would change
  python migrations/add_profile_password_recovery.py --dry-run

  # Run migration on specific database
  python migrations/add_profile_password_recovery.py --db-path /path/to/db.sqlite3
        """
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )

    parser.add_argument(
        "--db-path",
        default=os.environ.get("DATABASE_PATH", "db.sqlite3"),
        help="Path to SQLite database file (default: $DATABASE_PATH or db.sqlite3)"
    )

    args = parser.parse_args()

    try:
        success = run_migration(args.db_path, dry_run=args.dry_run)
        sys.exit(0 if success else 1)

    except MigrationError as e:
        print()
        print(f"❌ Migration Error: {e}", file=sys.stderr)
        sys.exit(1)

    except KeyboardInterrupt:
        print()
        print("❌ Migration cancelled by user", file=sys.stderr)
        sys.exit(1)

    except Exception as e:
        print()
        print(f"❌ Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
