#!/usr/bin/env python3
"""
Show what the balance view would display for managed relationships
"""
import sys
import os
import argparse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base
import models

# Parse arguments
parser = argparse.ArgumentParser(description="Show balance view for managed relationships")
parser.add_argument("--db-path", default="db.sqlite3", help="Path to SQLite database file")
args = parser.parse_args()

# Create database connection
engine = create_engine(f"sqlite:///{args.db_path}")
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

# Get all groups
groups = db.query(models.Group).all()

for group in groups:
    print("=" * 80)
    print(f"GROUP {group.id}: {group.name}")
    print("=" * 80)

    # Get all guests with management relationships in this group
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group.id,
        models.GuestMember.managed_by_id != None
    ).all()

    if not managed_guests:
        print("No managed guests in this group\n")
        continue

    for guest in managed_guests:
        print(f"\nGuest: {guest.name} (ID: {guest.id})")
        print(f"  Claimed: {'Yes, by User ' + str(guest.claimed_by_id) if guest.claimed_by_id else 'No'}")
        print(f"  Managed by Type: {guest.managed_by_type}")
        print(f"  Managed by ID: {guest.managed_by_id}")

        # Determine what the balance view would show
        if guest.claimed_by_id:
            # Guest is claimed - balance is under the user
            balance_key = f"User {guest.claimed_by_id}"
        else:
            # Guest is unclaimed - balance is under the guest
            balance_key = f"Guest {guest.id} ({guest.name})"

        # Determine the manager
        if guest.managed_by_type == 'user':
            manager = db.query(models.User).filter(models.User.id == guest.managed_by_id).first()
            manager_display = f"User {guest.managed_by_id} ({manager.email})" if manager else f"User {guest.managed_by_id} (Unknown)"
        else:  # guest
            manager_guest = db.query(models.GuestMember).filter(models.GuestMember.id == guest.managed_by_id).first()
            if manager_guest:
                if manager_guest.claimed_by_id:
                    manager_display = f"User {manager_guest.claimed_by_id} (was guest '{manager_guest.name}')"
                else:
                    manager_display = f"Guest {guest.managed_by_id} ({manager_guest.name})"
            else:
                manager_display = f"Guest {guest.managed_by_id} (Unknown)"

        print(f"\n  Balance View Display:")
        print(f"    Balance tracked under: {balance_key}")
        print(f"    Aggregated with: {manager_display}")

print("\n")
db.close()
