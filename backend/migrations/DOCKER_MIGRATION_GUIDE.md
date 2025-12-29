# Running Migrations in Docker

This guide explains how to run database migrations when your Splitwiser application is running in Docker.

## Prerequisites

- Docker and docker-compose installed
- Running Splitwiser containers
- Access to the host machine

## Method 1: Using docker exec (Recommended)

### Step 1: Find Your Container Name

```bash
# List running containers
docker ps | grep splitwiser

# Or if using docker-compose
docker-compose ps
```

Look for the backend container name (e.g., `splitwiser_backend_1` or `splitwiser-backend-1`)

### Step 2: Backup Database (Inside Container)

```bash
# Access the container
docker exec -it <container-name> bash

# Inside container: create backup
cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)

# Verify backup exists
ls -lh db.sqlite3.backup.*
```

Or from host:
```bash
# Create backup from host
docker exec <container-name> cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)
```

### Step 3: Run Migration (Dry Run First)

```bash
# From host: dry run
docker exec <container-name> python migrations/add_member_management.py --dry-run

# If using docker-compose
docker-compose exec backend python migrations/add_member_management.py --dry-run
```

### Step 4: Run Migration

```bash
# From host: run migration
docker exec <container-name> python migrations/add_member_management.py

# If using docker-compose
docker-compose exec backend python migrations/add_member_management.py
```

### Step 5: Verify Migration

```bash
# Check that columns were added
docker exec <container-name> sqlite3 db.sqlite3 "PRAGMA table_info(group_members);" | grep managed_by

# Or enter interactive shell
docker exec -it <container-name> bash
sqlite3 db.sqlite3
> PRAGMA table_info(group_members);
> .quit
```

## Method 2: Using Docker Volume Mount

If your database is in a Docker volume, you can access it from the host:

### Step 1: Find the Volume

```bash
# List volumes
docker volume ls | grep splitwiser

# Inspect volume to find mount point
docker volume inspect <volume-name>
```

### Step 2: Copy Database to Host

```bash
# Copy database from container to host
docker cp <container-name>:/app/backend/db.sqlite3 ./db.sqlite3

# Backup on host
cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)
```

### Step 3: Run Migration on Host

```bash
# Run migration on host copy
python migrations/add_member_management.py --db-path ./db.sqlite3
```

### Step 4: Copy Back to Container

```bash
# Stop container first (important!)
docker-compose stop backend

# Copy database back
docker cp ./db.sqlite3 <container-name>:/app/backend/db.sqlite3

# Restart container
docker-compose start backend
```

## Method 3: During Deployment

Add migration to your deployment process:

### Option A: In docker-compose.yml

```yaml
services:
  backend:
    # ... your existing config ...
    volumes:
      - ./backend:/app/backend
    command: >
      sh -c "
        python migrations/add_member_management.py &&
        uvicorn main:app --host 0.0.0.0 --port 8000
      "
```

### Option B: In Dockerfile

```dockerfile
# Add migration step
RUN python migrations/add_member_management.py || true
```

Note: Using `|| true` makes it non-failing if already applied (idempotent)

### Option C: Separate Migration Container

```yaml
services:
  migrate:
    build: ./backend
    volumes:
      - db-data:/app/backend
    command: python migrations/add_member_management.py
    depends_on:
      - backend

  backend:
    # ... your existing config ...
```

Run migration:
```bash
docker-compose run --rm migrate
```

## Example: Complete Migration Process

```bash
#!/bin/bash
# migrate-docker.sh

set -e  # Exit on error

CONTAINER_NAME="splitwiser_backend_1"
BACKUP_FILE="db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)"

echo "=== Splitwiser Database Migration ==="
echo ""

# Step 1: Backup
echo "Step 1: Creating backup..."
docker exec $CONTAINER_NAME cp db.sqlite3 "$BACKUP_FILE"
docker exec $CONTAINER_NAME ls -lh "$BACKUP_FILE"
echo "✓ Backup created: $BACKUP_FILE"
echo ""

# Step 2: Dry run
echo "Step 2: Running dry-run..."
docker exec $CONTAINER_NAME python migrations/add_member_management.py --dry-run
echo ""

# Step 3: Confirm
read -p "Continue with migration? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled"
    exit 0
fi

# Step 4: Run migration
echo "Step 3: Running migration..."
docker exec $CONTAINER_NAME python migrations/add_member_management.py

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Migration completed successfully!"
    echo ""
    echo "Backup location (in container): $BACKUP_FILE"
    echo "To copy backup to host:"
    echo "  docker cp $CONTAINER_NAME:/app/backend/$BACKUP_FILE ./"
else
    echo ""
    echo "✗ Migration failed!"
    echo "To rollback:"
    echo "  docker exec $CONTAINER_NAME cp $BACKUP_FILE db.sqlite3"
    exit 1
fi
```

Make it executable and run:
```bash
chmod +x migrate-docker.sh
./migrate-docker.sh
```

## Production Best Practices

### 1. Zero-Downtime Migration

```bash
# 1. Backup database
docker exec <container> cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)

# 2. Run migration (safe - adds columns with DEFAULT NULL)
docker exec <container> python migrations/add_member_management.py

# 3. Update code (deploy new version)
docker-compose up -d --no-deps --build backend

# 4. Verify application
curl http://localhost:8000/health  # Or your health check endpoint
```

### 2. With Downtime (Safer)

```bash
# 1. Backup database
docker exec <container> cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)

# 2. Stop application
docker-compose stop backend

# 3. Run migration
docker exec <container> python migrations/add_member_management.py

# 4. Update and restart with new code
docker-compose up -d --build backend

# 5. Test
docker-compose logs -f backend
```

## Rollback in Docker

### If Migration Failed

```bash
# Migration uses transactions, so no partial changes
# Just check logs
docker logs <container-name>
```

### If Need to Rollback After Success

```bash
# 1. Stop container
docker-compose stop backend

# 2. Restore backup
docker exec <container-name> cp db.sqlite3.backup.YYYYMMDD_HHMMSS db.sqlite3

# 3. Rollback code (deploy previous version)
git checkout <previous-commit>
docker-compose up -d --build backend
```

## Kubernetes/Production Deployments

For Kubernetes or similar:

```bash
# Find pod name
kubectl get pods | grep backend

# Run migration
kubectl exec -it <pod-name> -- python migrations/add_member_management.py

# Or create a Kubernetes Job
kubectl apply -f migration-job.yaml
```

Example `migration-job.yaml`:
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration-member-management
spec:
  template:
    spec:
      containers:
      - name: migration
        image: splitwiser-backend:latest
        command: ["python", "migrations/add_member_management.py"]
        volumeMounts:
        - name: db-volume
          mountPath: /app/backend
      restartPolicy: Never
      volumes:
      - name: db-volume
        persistentVolumeClaim:
          claimName: splitwiser-db-pvc
  backoffLimit: 1
```

## Troubleshooting

### "Database is locked"

```bash
# Stop all containers accessing the database
docker-compose stop backend

# Run migration
docker exec <container-name> python migrations/add_member_management.py

# Restart
docker-compose start backend
```

### "Container not found"

```bash
# Make sure container is running
docker ps -a | grep backend

# Start container
docker-compose up -d backend
```

### "Permission denied"

```bash
# Run as root in container
docker exec -u root <container-name> python migrations/add_member_management.py

# Or fix permissions
docker exec -u root <container-name> chown -R app:app /app/backend
```

## Backup Best Practices for Docker

### Automated Backups

Add to your docker-compose.yml:

```yaml
services:
  backup:
    image: splitwiser-backend:latest
    volumes:
      - db-data:/app/backend
      - ./backups:/backups
    command: >
      sh -c "
        while true; do
          cp /app/backend/db.sqlite3 /backups/db.backup.$(date +%Y%m%d_%H%M%S).sqlite3
          sleep 86400
        done
      "
```

Or use a cron job on the host:

```bash
# Add to crontab
0 2 * * * docker exec splitwiser_backend_1 cp db.sqlite3 db.sqlite3.backup.$(date +\%Y\%m\%d_\%H\%M\%S)
```

## Summary

**Recommended approach for production:**

1. Use Method 1 (docker exec) for simplicity
2. Always create backups first
3. Run dry-run before actual migration
4. Consider stopping the application during migration
5. Test thoroughly after migration
6. Keep backups for at least 7 days

**For development/testing:**

- Method 2 or 3 work well
- Less critical to stop application
- Can iterate quickly
