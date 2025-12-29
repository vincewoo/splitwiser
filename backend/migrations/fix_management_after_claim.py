#!/usr/bin/env python3
"""
Fix management relationships for ALL scenarios:
1. Claimed guests whose group_member is missing managed_by fields
2. Group members who should be managed because their original guest was managed
3. Update management relationships when manager guest was also claimed

This script looks at BOTH guest_members and group_members to find all issues.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base
import models

def run_migration(db_path, dry_run=False):
    """Fix all management relationship issues"""
    engine = create_engine(f"sqlite:///{db_path}")
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    print(f"{'[DRY RUN] ' if dry_run else ''}Starting comprehensive management fix...")
    print()

    updates = []

    # Find all claimed guests
    claimed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.claimed_by_id != None
    ).all()

    if not claimed_guests:
        print("✓ No claimed guests found")
        db.close()
        return

    print(f"Found {len(claimed_guests)} claimed guest(s)")
    print()

    for guest in claimed_guests:
        # Find the corresponding group_member
        member = db.query(models.GroupMember).filter(
            models.GroupMember.group_id == guest.group_id,
            models.GroupMember.user_id == guest.claimed_by_id
        ).first()

        if not member:
            print(f"⚠️  Warning: Guest '{guest.name}' claimed by User {guest.claimed_by_id}, but no group_member found")
            continue

        # Check if guest had a management relationship
        if not guest.managed_by_id:
            # Guest wasn't managed, skip
            continue

        # Determine correct manager for the group_member
        correct_manager_id = None
        correct_manager_type = None

        if guest.managed_by_type == 'user':
            # Managed by a user - preserve as-is
            correct_manager_id = guest.managed_by_id
            correct_manager_type = 'user'
            status = f"Managed by user {guest.managed_by_id}"

        elif guest.managed_by_type == 'guest':
            # Managed by a guest - check if that guest was claimed
            manager_guest = db.query(models.GuestMember).filter(
                models.GuestMember.id == guest.managed_by_id
            ).first()

            if not manager_guest:
                print(f"⚠️  Warning: Guest '{guest.name}' managed by guest {guest.managed_by_id}, but manager guest not found")
                continue

            if manager_guest.claimed_by_id:
                # Manager was claimed - update to user
                correct_manager_id = manager_guest.claimed_by_id
                correct_manager_type = 'user'
                status = f"Manager guest '{manager_guest.name}' was claimed by user {manager_guest.claimed_by_id}"
            else:
                # Manager not claimed - keep guest reference
                correct_manager_id = guest.managed_by_id
                correct_manager_type = 'guest'
                status = f"Manager guest '{manager_guest.name}' not claimed yet"

        # Check if update is needed
        needs_update = (
            member.managed_by_id != correct_manager_id or
            member.managed_by_type != correct_manager_type
        )

        if needs_update:
            updates.append({
                'member_id': member.id,
                'user_id': member.user_id,
                'guest_name': guest.name,
                'old_manager_id': member.managed_by_id,
                'old_manager_type': member.managed_by_type,
                'new_manager_id': correct_manager_id,
                'new_manager_type': correct_manager_type,
                'status': status
            })

            print(f"Guest '{guest.name}' → User {guest.claimed_by_id}")
            print(f"  Current group_member: managed_by_id={member.managed_by_id}, managed_by_type={member.managed_by_type}")
            print(f"  Should be:            managed_by_id={correct_manager_id}, managed_by_type={correct_manager_type}")
            print(f"  Reason: {status}")
            print()
        else:
            print(f"✓ Guest '{guest.name}' → User {guest.claimed_by_id} - already correct")

    if not updates:
        print()
        print("✓ All management relationships are correct!")
        db.close()
        return

    print(f"\nTotal updates needed: {len(updates)}")
    print()

    if dry_run:
        print("[DRY RUN] Would update the following:")
        for update in updates:
            print(f"  - User {update['user_id']} (was guest '{update['guest_name']}')")
        print()
        print("[DRY RUN] No changes made")
        db.close()
        return

    # Apply updates
    print("Applying updates...")
    for update in updates:
        member = db.query(models.GroupMember).filter(
            models.GroupMember.id == update['member_id']
        ).first()

        if member:
            member.managed_by_id = update['new_manager_id']
            member.managed_by_type = update['new_manager_type']

    db.commit()
    print(f"✓ Successfully updated {len(updates)} group member(s)")
    print()

    # Verify
    print("Verifying...")
    all_good = True
    for update in updates:
        member = db.query(models.GroupMember).filter(
            models.GroupMember.id == update['member_id']
        ).first()

        if not member or member.managed_by_id != update['new_manager_id'] or member.managed_by_type != update['new_manager_type']:
            print(f"  ❌ Verification failed for User {update['user_id']}")
            all_good = False
        else:
            print(f"  ✓ User {update['user_id']} (was guest '{update['guest_name']}')")

    db.close()

    if all_good:
        print()
        print("✅ Migration completed successfully!")
    else:
        print()
        print("❌ Some updates failed verification")
        sys.exit(1)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Fix management relationships comprehensively")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    parser.add_argument("--db-path", default="db.sqlite3", help="Path to SQLite database file")
    args = parser.parse_args()

    try:
        run_migration(db_path=args.db_path, dry_run=args.dry_run)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
