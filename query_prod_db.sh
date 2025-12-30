#!/bin/bash
# Query production database to investigate Jezmin Pelayo issue

echo "=== Querying Production Database ==="
echo ""

# Run Python script inside the backend container to query the database
docker compose exec backend python -c "
from database import SessionLocal
import models

db = SessionLocal()
try:
    # Find the group (assuming group ID 1 based on 'Banff 2026')
    group = db.query(models.Group).filter(models.Group.name.like('%Banff%')).first()
    if not group:
        print('No group found with Banff in name, trying group ID 1')
        group = db.query(models.Group).filter(models.Group.id == 1).first()

    if not group:
        print('ERROR: Could not find group')
        exit(1)

    group_id = group.id
    print(f'Group: {group.name} (ID: {group_id})')
    print(f'Default currency: {group.default_currency}')
    print()

    # Get all guests
    print('=== GUESTS ===')
    guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id
    ).order_by(models.GuestMember.name).all()

    for g in guests:
        print(f'Guest [{g.id}]: \"{g.name}\"')
        print(f'  Managed by: {g.managed_by_id} (type: {g.managed_by_type})')
        print(f'  Claimed by: {g.claimed_by_id}')

        if g.claimed_by_id:
            claimer = db.query(models.User).filter(models.User.id == g.claimed_by_id).first()
            if claimer:
                print(f'  Claimed by user: {claimer.full_name} ({claimer.email})')

        if g.managed_by_id:
            if g.managed_by_type == 'guest':
                manager = db.query(models.GuestMember).filter(models.GuestMember.id == g.managed_by_id).first()
                if manager:
                    print(f'  Manager is guest: {manager.name}')
            elif g.managed_by_type == 'user':
                manager = db.query(models.User).filter(models.User.id == g.managed_by_id).first()
                if manager:
                    print(f'  Manager is user: {manager.full_name}')
        print()

    # Get all members
    print('=== REGISTERED MEMBERS ===')
    members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id
    ).all()

    for m in members:
        user = db.query(models.User).filter(models.User.id == m.user_id).first()
        if user:
            print(f'Member [{m.id}]: {user.full_name} ({user.email})')
            print(f'  User ID: {user.id}')
            print(f'  Managed by: {m.managed_by_id} (type: {m.managed_by_type})')

            if m.managed_by_id:
                if m.managed_by_type == 'guest':
                    manager = db.query(models.GuestMember).filter(models.GuestMember.id == m.managed_by_id).first()
                    if manager:
                        print(f'  Manager is guest: {manager.name}')
                elif m.managed_by_type == 'user':
                    manager = db.query(models.User).filter(models.User.id == m.managed_by_id).first()
                    if manager:
                        print(f'  Manager is user: {manager.full_name}')
            print()

finally:
    db.close()
"
