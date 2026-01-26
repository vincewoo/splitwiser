#!/usr/bin/env python3
"""
Fix script to clear managed_by_id on claimed guests.

When a guest is claimed by a user, the management relationship should be
transferred to the user's GroupMember record, not kept on the GuestMember.
Having both causes double-counting in balance breakdown displays.

Usage:
  fly ssh console -a <app-name>
  cd /app
  python fix_claimed_guest_management.py --dry-run  # Preview changes
  python fix_claimed_guest_management.py            # Apply changes
"""

import argparse
import sys

sys.path.insert(0, '/app')

from database import SessionLocal
import models


def find_problematic_guests(db):
    """Find claimed guests that still have managed_by_id set."""
    return db.query(models.GuestMember).filter(
        models.GuestMember.claimed_by_id != None,
        models.GuestMember.managed_by_id != None
    ).all()


def main():
    parser = argparse.ArgumentParser(description='Fix claimed guest management relationships')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    args = parser.parse_args()

    db = SessionLocal()

    try:
        problematic_guests = find_problematic_guests(db)

        if not problematic_guests:
            print("No problematic guests found. All claimed guests have managed_by_id cleared.")
            return

        print(f"Found {len(problematic_guests)} claimed guest(s) with managed_by_id still set:\n")

        for guest in problematic_guests:
            # Get the claiming user
            claiming_user = db.query(models.User).filter(
                models.User.id == guest.claimed_by_id
            ).first()
            claiming_user_name = (claiming_user.full_name or claiming_user.email) if claiming_user else f"User {guest.claimed_by_id}"

            # Get the manager
            if guest.managed_by_type == 'user':
                manager = db.query(models.User).filter(
                    models.User.id == guest.managed_by_id
                ).first()
                manager_name = (manager.full_name or manager.email) if manager else f"User {guest.managed_by_id}"
            else:
                manager = db.query(models.GuestMember).filter(
                    models.GuestMember.id == guest.managed_by_id
                ).first()
                manager_name = manager.name if manager else f"Guest {guest.managed_by_id}"

            # Check if the claiming user has a GroupMember record with the same manager
            group_member = db.query(models.GroupMember).filter(
                models.GroupMember.user_id == guest.claimed_by_id,
                models.GroupMember.group_id == guest.group_id
            ).first()

            print(f"  Guest ID: {guest.id}")
            print(f"    Name: {guest.name}")
            print(f"    Group ID: {guest.group_id}")
            print(f"    Claimed by: {claiming_user_name} (user {guest.claimed_by_id})")
            print(f"    Managed by: {manager_name} ({guest.managed_by_type} {guest.managed_by_id})")

            if group_member:
                if group_member.managed_by_id:
                    print(f"    User's GroupMember: managed_by_id={group_member.managed_by_id}, type={group_member.managed_by_type}")
                else:
                    print(f"    User's GroupMember: NOT managed (managed_by_id is None)")
                    print(f"    WARNING: Management relationship will be lost when clearing guest's managed_by_id!")
            else:
                print(f"    WARNING: User has no GroupMember record in this group!")

            print()

        if args.dry_run:
            print("DRY RUN - No changes made. Run without --dry-run to apply fixes.")
        else:
            print("Applying fixes...")
            for guest in problematic_guests:
                print(f"  Clearing managed_by_id on guest {guest.id} ({guest.name})")
                guest.managed_by_id = None
                guest.managed_by_type = None

            db.commit()
            print(f"\nFixed {len(problematic_guests)} guest(s).")

    finally:
        db.close()


if __name__ == "__main__":
    main()
