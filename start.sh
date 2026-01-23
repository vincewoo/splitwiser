#!/bin/bash
set -e

# Initialize database (creates file and tables if missing)
echo "Running database initialization..."
python init_db.py

# Run migrations to ensure all updates are applied
echo "Running migrations..."
python migrations/add_profile_password_recovery.py --db-path "$DATABASE_PATH"
python migrations/add_google_oauth.py --db-path "$DATABASE_PATH"

# Start supervisor
echo "Starting Supervisor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
