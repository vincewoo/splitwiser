#!/bin/bash
#
# migrate-docker.sh - Run database migration in Docker container
#
# Usage:
#   ./migrate-docker.sh [container-name]
#
# If container name is not provided, will try to detect it automatically.
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

# Detect container name
if [ -z "$1" ]; then
    echo "Detecting container..."

    # Try docker-compose first
    if command -v docker-compose &> /dev/null; then
        CONTAINER_NAME=$(docker-compose ps -q backend 2>/dev/null)
        if [ -z "$CONTAINER_NAME" ]; then
            # Try finding by name pattern
            CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep -i 'backend\|splitwiser' | head -1)
        fi
    else
        # Try finding by name pattern
        CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep -i 'backend\|splitwiser' | head -1)
    fi

    if [ -z "$CONTAINER_NAME" ]; then
        print_error "Could not detect container. Please provide container name:"
        echo "  Usage: $0 <container-name>"
        echo ""
        echo "Available containers:"
        docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
        exit 1
    fi

    print_warning "Auto-detected container: $CONTAINER_NAME"
else
    CONTAINER_NAME="$1"
fi

# Verify container exists and is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    print_error "Container '$CONTAINER_NAME' is not running"
    echo ""
    echo "Running containers:"
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
    exit 1
fi

print_success "Using container: $CONTAINER_NAME"

# Display banner
print_step "Splitwiser Database Migration"
echo "This script will add member management support to your database"
echo "Container: $CONTAINER_NAME"
echo ""

# Step 1: Create backup
print_step "Step 1: Creating Backup"
BACKUP_FILE="db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)"
docker exec "$CONTAINER_NAME" cp db.sqlite3 "$BACKUP_FILE" || {
    print_error "Failed to create backup"
    exit 1
}

# Verify backup
BACKUP_SIZE=$(docker exec "$CONTAINER_NAME" ls -lh "$BACKUP_FILE" | awk '{print $5}')
print_success "Backup created: $BACKUP_FILE (${BACKUP_SIZE})"

# Show current member count
MEMBER_COUNT=$(docker exec "$CONTAINER_NAME" sqlite3 db.sqlite3 "SELECT COUNT(*) FROM group_members;" 2>/dev/null || echo "unknown")
echo "Current group members: $MEMBER_COUNT"

# Step 2: Dry run
print_step "Step 2: Dry Run"
echo "Running migration in dry-run mode to preview changes..."
echo ""

docker exec "$CONTAINER_NAME" python migrations/add_member_management.py --dry-run || {
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
echo "  ✓ Reversible (backup created: $BACKUP_FILE)"
echo "  ✓ Fast (< 1 second)"
echo ""

read -p "Continue with migration? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Migration cancelled by user"
    echo ""
    echo "To remove backup:"
    echo "  docker exec $CONTAINER_NAME rm $BACKUP_FILE"
    exit 0
fi

# Step 4: Run migration
print_step "Step 4: Running Migration"
docker exec "$CONTAINER_NAME" python migrations/add_member_management.py

if [ $? -eq 0 ]; then
    print_step "Migration Successful!"
    print_success "Database schema updated"
    print_success "Backup preserved: $BACKUP_FILE"

    echo ""
    echo "Next steps:"
    echo "  1. Restart your application (if needed):"
    echo "     docker-compose restart backend"
    echo ""
    echo "  2. Test the member management feature in the UI"
    echo ""
    echo "  3. Copy backup to host (optional):"
    echo "     docker cp $CONTAINER_NAME:/app/backend/$BACKUP_FILE ./"
    echo ""
    echo "  4. Remove backup after verification (7+ days):"
    echo "     docker exec $CONTAINER_NAME rm $BACKUP_FILE"
    echo ""

else
    print_error "Migration failed!"
    echo ""
    echo "The database was not modified (migration uses transactions)"
    echo "Check error messages above for details"
    echo ""
    echo "Backup is still available: $BACKUP_FILE"
    exit 1
fi
