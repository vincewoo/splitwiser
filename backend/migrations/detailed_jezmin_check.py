#!/usr/bin/env python3
"""
Detailed check for Jezmin's management relationship
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
parser = argparse.ArgumentParser(description="Check Jezmin's management relationship in detail")
parser.add_argument("--db-path", default="db.sqlite3", help="Path to SQLite database file")
args = parser.parse_args()

# Create database connection
engine = create_engine(f"sqlite:///{args.db_path}")
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("=" * 80)
print("JEZMIN'S GUEST RECORD")
print("=" * 80)

jezmin_guest = db.query(models.GuestMember).filter(models.GuestMember.name == 'Jezmin').first()
if jezmin_guest:
    print(f"Guest ID: {jezmin_guest.id}")
    print(f"Name: {jezmin_guest.name}")
    print(f"Group ID: {jezmin_guest.group_id}")
    print(f"Claimed by User ID: {jezmin_guest.claimed_by_id}")
    print(f"Managed by ID: {jezmin_guest.managed_by_id}")
    print(f"Managed by Type: {jezmin_guest.managed_by_type}")

    print("\n" + "=" * 80)
    print("JEZMIN'S GROUP MEMBER RECORD (User 7)")
    print("=" * 80)

    user_id = jezmin_guest.claimed_by_id
    group_id = jezmin_guest.group_id

    member = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == user_id
    ).first()

    if member:
        print(f"User ID: {member.user_id}")
        print(f"Group ID: {member.group_id}")
        print(f"Managed by ID: {member.managed_by_id}")
        print(f"Managed by Type: {member.managed_by_type}")

        print("\n" + "=" * 80)
        print("COMPARISON")
        print("=" * 80)
        print(f"Guest managed_by_id: {jezmin_guest.managed_by_id}")
        print(f"Member managed_by_id: {member.managed_by_id}")
        print(f"Match: {jezmin_guest.managed_by_id == member.managed_by_id}")
        print()
        print(f"Guest managed_by_type: {jezmin_guest.managed_by_type}")
        print(f"Member managed_by_type: {member.managed_by_type}")
        print(f"Match: {jezmin_guest.managed_by_type == member.managed_by_type}")

        if member.managed_by_id != jezmin_guest.managed_by_id or member.managed_by_type != jezmin_guest.managed_by_type:
            print("\n⚠️  MISMATCH DETECTED! Group member needs to be updated.")
        else:
            print("\n✓ Records match")
    else:
        print("❌ No group member record found!")
else:
    print("❌ Jezmin guest record not found!")

db.close()
