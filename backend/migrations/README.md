# Database Migrations

This directory contains database migration scripts for Splitwiser.

## Quick Start

### For Docker Deployments

```bash
cd backend
./migrations/migrate-docker.sh
```

The script will:
- Auto-detect your container
- Create a backup
- Show you what will change (dry-run)
- Ask for confirmation
- Apply the migration
- Show next steps

### For Direct Installations

```bash
cd backend
./migrations/migrate.sh
```

See detailed guides:
- [Docker Migration Guide](DOCKER_MIGRATION_GUIDE.md)
- [Production Guide](PRODUCTION_GUIDE.md)

---

## Migration: Add Member Management

**File:** `add_member_management.py`
**Date:** 2025-12-29
**Purpose:** Add member management support to enable balance aggregation for registered users

### What This Migration Does

Adds two columns to the `group_members` table:
- `managed_by_id` (INTEGER, nullable) - ID of the manager (user or guest)
- `managed_by_type` (TEXT, nullable) - Type of manager ('user' or 'guest')

These columns enable registered members to have their balances aggregated with another member or guest for easier settlement tracking.

### Usage

#### Preview Changes (Dry Run)

Before running the migration, you can preview what will change:

```bash
cd backend
python migrations/add_member_management.py --dry-run
```

#### Run Migration (Default Database)

To run the migration on the default `db.sqlite3` database:

```bash
cd backend
python migrations/add_member_management.py
```

#### Run Migration (Custom Database Path)

To run the migration on a specific database:

```bash
cd backend
python migrations/add_member_management.py --db-path /path/to/production.db
```

### Safety Features

The migration script includes several safety features:

1. **Idempotent** - Can be run multiple times safely; checks if columns already exist
2. **Transactional** - Uses database transactions; rolls back on error
3. **Verification** - Verifies changes were applied correctly
4. **Data integrity** - Checks that no rows were lost during migration
5. **Dry run mode** - Test the migration without making changes
6. **Error handling** - Clear error messages and automatic rollback on failure

### Before Running on Production

1. **Backup your database:**
   ```bash
   cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)
   ```

2. **Test with dry run:**
   ```bash
   python migrations/add_member_management.py --dry-run
   ```

3. **Run migration:**
   ```bash
   python migrations/add_member_management.py
   ```

4. **Verify application works:**
   - Start the backend server
   - Test member management features
   - Check balance calculations

### Rollback (If Needed)

If you need to rollback this migration:

```bash
# Restore from backup
cp db.sqlite3.backup.YYYYMMDD_HHMMSS db.sqlite3
```

Note: Since SQLite doesn't support DROP COLUMN in older versions, manual rollback requires restoring from backup.

### Exit Codes

- `0` - Migration completed successfully
- `1` - Migration failed or was cancelled

### Example Output

```
Starting migration...
Database: db.sqlite3

✓ Checking if group_members table exists...
  Found 15 existing group members

Changes to be applied:
  1. Add managed_by_id column
  2. Add managed_by_type column

Adding managed_by_id column...
✓ managed_by_id column added
Adding managed_by_type column...
✓ managed_by_type column added

Verifying changes...
✓ All changes verified successfully

✓ Migration completed successfully!

Summary:
  - Database: db.sqlite3
  - Group members: 15
  - Columns added: 2
```

### Related Changes

This migration is part of the member management feature that also includes:
- Backend API endpoints for managing member relationships
- Frontend UI for setting/removing member managers
- Balance aggregation logic for managed members

See commit: "Add member management feature for registered users"
