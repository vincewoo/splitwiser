#!/bin/bash
#
# migrate.sh - Run database migration (non-Docker)
#
# Usage:
#   cd backend
#   ./migrations/migrate.sh [--db-path path/to/db.sqlite3]
#

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_step() {
    echo ""
    echo "=== $1 ==="
}

# Parse arguments
DB_PATH="db.sqlite3"
while [[ $# -gt 0 ]]; do
    case $1 in
        --db-path)
            DB_PATH="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--db-path path/to/db.sqlite3]"
            exit 1
            ;;
    esac
done

# Verify database exists
if [ ! -f "$DB_PATH" ]; then
    print_error "Database not found: $DB_PATH"
    echo ""
    echo "Please specify the correct path:"
    echo "  $0 --db-path /path/to/db.sqlite3"
    exit 1
fi

print_success "Using database: $DB_PATH"

# Verify migration script exists
MIGRATION_SCRIPT="migrations/add_member_management.py"
if [ ! -f "$MIGRATION_SCRIPT" ]; then
    print_error "Migration script not found: $MIGRATION_SCRIPT"
    echo "Make sure you're running from the backend directory"
    exit 1
fi

# Display banner
print_step "Splitwiser Database Migration"
echo "This script will add member management support to your database"
echo "Database: $DB_PATH"
echo ""

# Step 1: Create backup
print_step "Step 1: Creating Backup"
BACKUP_FILE="${DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$DB_PATH" "$BACKUP_FILE" || {
    print_error "Failed to create backup"
    exit 1
}

# Verify backup
BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
print_success "Backup created: $BACKUP_FILE (${BACKUP_SIZE})"

# Show current member count
MEMBER_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM group_members;" 2>/dev/null || echo "unknown")
echo "Current group members: $MEMBER_COUNT"

# Step 2: Dry run
print_step "Step 2: Dry Run"
echo "Running migration in dry-run mode to preview changes..."
echo ""

python "$MIGRATION_SCRIPT" --db-path "$DB_PATH" --dry-run || {
    print_error "Dry run failed"
    exit 1
}

# Step 3: Confirm
print_step "Step 3: Confirmation"
echo "The migration will add the following columns to group_members table:"
echo "  - managed_by_id (INTEGER, nullable)"
echo "  - managed_by_type (TEXT, nullable)"
echo ""
echo "This migration is:"
echo "  ✓ Safe (no data modification)"
echo "  ✓ Reversible (backup: $BACKUP_FILE)"
echo "  ✓ Fast (< 1 second)"
echo ""

read -p "Continue with migration? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Migration cancelled by user"
    echo ""
    echo "To remove backup:"
    echo "  rm $BACKUP_FILE"
    exit 0
fi

# Step 4: Run migration
print_step "Step 4: Running Migration"
python "$MIGRATION_SCRIPT" --db-path "$DB_PATH"

if [ $? -eq 0 ]; then
    print_step "Migration Successful!"
    print_success "Database schema updated"
    print_success "Backup preserved: $BACKUP_FILE"

    echo ""
    echo "Next steps:"
    echo "  1. Restart your application:"
    echo "     # Stop and start your backend server"
    echo ""
    echo "  2. Test the member management feature in the UI"
    echo ""
    echo "  3. Remove backup after verification (7+ days):"
    echo "     rm $BACKUP_FILE"
    echo ""

else
    print_error "Migration failed!"
    echo ""
    echo "The database was not modified (migration uses transactions)"
    echo "Check error messages above for details"
    echo ""
    echo "To restore from backup:"
    echo "  cp $BACKUP_FILE $DB_PATH"
    exit 1
fi
