# Production Database Migration Guide

## Pre-Migration Checklist

Before applying any migration to production:

- [ ] Backup the production database
- [ ] Test migration on a copy of production data
- [ ] Review migration script code
- [ ] Plan maintenance window (if needed)
- [ ] Notify users (if downtime required)
- [ ] Have rollback plan ready

## Step-by-Step Migration Process

### 1. Backup Production Database

```bash
# Create timestamped backup
BACKUP_FILE="db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)"
cp db.sqlite3 "$BACKUP_FILE"

# Verify backup
ls -lh "$BACKUP_FILE"
sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM group_members;"
```

### 2. Test on Staging/Copy

```bash
# Create a test copy
cp db.sqlite3 db.sqlite3.test

# Run dry-run on test copy
python migrations/add_member_management.py --db-path db.sqlite3.test --dry-run

# Run actual migration on test copy
python migrations/add_member_management.py --db-path db.sqlite3.test

# Verify test migration succeeded
echo $?  # Should output 0
```

### 3. Run Migration on Production

```bash
# Final dry-run on production (read-only)
python migrations/add_member_management.py --dry-run

# If dry-run looks good, run migration
python migrations/add_member_management.py

# Check exit code
if [ $? -eq 0 ]; then
    echo "✓ Migration successful"
else
    echo "✗ Migration failed"
    # See rollback steps below
fi
```

### 4. Verify Migration

```bash
# Check that columns were added
sqlite3 db.sqlite3 "PRAGMA table_info(group_members);" | grep managed_by

# Should see:
# managed_by_id|INTEGER|0|NULL|0
# managed_by_type|TEXT|0|NULL|0

# Verify row count unchanged
sqlite3 db.sqlite3 "SELECT COUNT(*) FROM group_members;"
```

### 5. Test Application

1. Start the backend server:
   ```bash
   uvicorn main:app --reload
   ```

2. Run API tests:
   ```bash
   pytest tests/ -v
   ```

3. Manual testing:
   - Open a group
   - Click "Manage" on a member
   - Set a manager for a member
   - Verify balances aggregate correctly
   - Remove manager
   - Verify balances separate correctly

## Rollback Procedure

If the migration fails or causes issues:

### Option 1: Restore from Backup

```bash
# Stop the application
# Find your backup
ls -lt db.sqlite3.backup.*

# Restore from backup
cp db.sqlite3.backup.YYYYMMDD_HHMMSS db.sqlite3

# Verify restoration
sqlite3 db.sqlite3 "SELECT COUNT(*) FROM group_members;"

# Restart application
```

### Option 2: Manual Column Removal (SQLite 3.35.0+)

```bash
# Only if you have SQLite 3.35.0 or later
sqlite3 db.sqlite3 "ALTER TABLE group_members DROP COLUMN managed_by_id;"
sqlite3 db.sqlite3 "ALTER TABLE group_members DROP COLUMN managed_by_type;"
```

Note: Most systems have older SQLite, so backup restoration is recommended.

## Downtime Considerations

This migration:
- **Downtime required:** No (columns are added with DEFAULT NULL)
- **Can run while app is running:** Yes, but recommended to stop app
- **Risk level:** Low (no data modification, only schema changes)
- **Estimated duration:** < 1 second for typical database sizes

However, for production best practices:
1. Schedule a brief maintenance window
2. Stop the application during migration
3. Run migration
4. Restart with new code
5. Test and verify

## Post-Migration

After successful migration:

1. Keep backup for at least 7 days
2. Monitor error logs for issues
3. Update documentation
4. Clean up old backups after verification period

## Troubleshooting

### "table is locked"
```bash
# Another process has the database open
# Stop the application and try again
```

### "database is locked"
```bash
# Wait for current operations to complete
# Or restart the application
```

### Migration script returns error
```bash
# Check the error message
# Migration uses transactions, so no partial changes
# Fix the issue and retry
```

### Columns already exist
```bash
# Migration is idempotent
# Safe to run again - will detect existing columns and skip
```

## Contact

For issues or questions:
- Review error messages in migration output
- Check backend logs
- Consult development team

## Migration Metadata

- **Script:** `migrations/add_member_management.py`
- **Date:** 2025-12-29
- **Feature:** Member management for balance aggregation
- **Commit:** "Add member management feature for registered users"
- **Tables affected:** `group_members`
- **Columns added:** `managed_by_id`, `managed_by_type`
