#!/usr/bin/env python
"""
Migration: Fix double-counting bug for claimed guests with management relationships

Issue: When a guest with a managed_by relationship is claimed, the guest's managed_by
fields were not cleared. This causes double-counting in balance calculations because:
1. The claimed guest's expenses are transferred to the user
2. The user inherits the managed_by relationship
3. But the guest still has managed_by set, so balances are aggregated twice

Fix: Clear managed_by fields for all claimed guests, since the relationship has been
transferred to the GroupMember record when the guest was claimed.
"""

from database import SessionLocal
import models

def main():
    db = SessionLocal()
    try:
        # Find all claimed guests that still have managed_by set
        claimed_managed_guests = db.query(models.GuestMember).filter(
            models.GuestMember.claimed_by_id.isnot(None),
            models.GuestMember.managed_by_id.isnot(None)
        ).all()

        if not claimed_managed_guests:
            print("No claimed guests with managed_by relationships found.")
            return

        print(f"Found {len(claimed_managed_guests)} claimed guests with managed_by still set:")
        for guest in claimed_managed_guests:
            claimer = db.query(models.User).filter(models.User.id == guest.claimed_by_id).first()
            claimer_name = claimer.full_name if claimer else f"User {guest.claimed_by_id}"

            manager_name = "Unknown"
            if guest.managed_by_type == 'user':
                manager = db.query(models.User).filter(models.User.id == guest.managed_by_id).first()
                manager_name = manager.full_name if manager else f"User {guest.managed_by_id}"
            elif guest.managed_by_type == 'guest':
                manager = db.query(models.GuestMember).filter(models.GuestMember.id == guest.managed_by_id).first()
                manager_name = manager.name if manager else f"Guest {guest.managed_by_id}"

            print(f"  Guest '{guest.name}' (ID: {guest.id})")
            print(f"    Claimed by: {claimer_name}")
            print(f"    Managed by: {manager_name} ({guest.managed_by_type})")

        # Clear the managed_by fields for these guests
        print("\nClearing managed_by fields for claimed guests...")

        for guest in claimed_managed_guests:
            guest.managed_by_id = None
            guest.managed_by_type = None

        db.commit()
        print(f"✓ Successfully cleared managed_by for {len(claimed_managed_guests)} claimed guests")

    except Exception as e:
        db.rollback()
        print(f"✗ Error: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
