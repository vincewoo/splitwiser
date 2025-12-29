#!/usr/bin/env python3
"""
Database migration: Add member management support
--------------------------------------------------
Adds managed_by_id and managed_by_type columns to group_members table
to enable balance aggregation for registered members.

Usage:
    python migrations/add_member_management.py [--dry-run] [--db-path <path>]

Options:
    --dry-run       Show what would be done without making changes
    --db-path       Path to SQLite database (default: db.sqlite3)
"""

import sqlite3
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
    Run the migration to add member management columns

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
        # Verify group_members table exists
        print("✓ Checking if group_members table exists...")
        if not verify_table_exists(cursor, "group_members"):
            raise MigrationError("group_members table not found in database")

        member_count = get_row_count(cursor, "group_members")
        print(f"  Found {member_count} existing group members")
        print()

        # Check current state
        has_managed_by_id = check_column_exists(cursor, "group_members", "managed_by_id")
        has_managed_by_type = check_column_exists(cursor, "group_members", "managed_by_type")

        changes_needed = []

        if not has_managed_by_id:
            changes_needed.append("Add managed_by_id column")
        else:
            print("✓ managed_by_id column already exists")

        if not has_managed_by_type:
            changes_needed.append("Add managed_by_type column")
        else:
            print("✓ managed_by_type column already exists")

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
            # Add managed_by_id column if needed
            if not has_managed_by_id:
                print("Adding managed_by_id column...")
                cursor.execute(
                    "ALTER TABLE group_members ADD COLUMN managed_by_id INTEGER DEFAULT NULL"
                )
                print("✓ managed_by_id column added")

            # Add managed_by_type column if needed
            if not has_managed_by_type:
                print("Adding managed_by_type column...")
                cursor.execute(
                    "ALTER TABLE group_members ADD COLUMN managed_by_type TEXT DEFAULT NULL"
                )
                print("✓ managed_by_type column added")

            # Verify changes
            print()
            print("Verifying changes...")

            if not check_column_exists(cursor, "group_members", "managed_by_id"):
                raise MigrationError("Verification failed: managed_by_id column not found after creation")

            if not check_column_exists(cursor, "group_members", "managed_by_type"):
                raise MigrationError("Verification failed: managed_by_type column not found after creation")

            # Check that no data was lost
            new_member_count = get_row_count(cursor, "group_members")
            if new_member_count != member_count:
                raise MigrationError(
                    f"Data loss detected: expected {member_count} rows, found {new_member_count}"
                )

            print("✓ All changes verified successfully")
            print()

            # Commit transaction
            conn.commit()
            print("✓ Migration completed successfully!")
            print()
            print("Summary:")
            print(f"  - Database: {db_path}")
            print(f"  - Group members: {member_count}")
            print(f"  - Columns added: {len(changes_needed)}")

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
        description="Add member management support to Splitwiser database",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run migration on default database
  python migrations/add_member_management.py

  # Dry run to see what would change
  python migrations/add_member_management.py --dry-run

  # Run migration on specific database
  python migrations/add_member_management.py --db-path /path/to/db.sqlite3
        """
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )

    parser.add_argument(
        "--db-path",
        default="db.sqlite3",
        help="Path to SQLite database file (default: db.sqlite3)"
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
