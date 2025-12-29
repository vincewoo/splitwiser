#!/usr/bin/env python3
"""
Show all members and their relationships
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
parser = argparse.ArgumentParser(description="Show all members and their relationships")
parser.add_argument("--db-path", default="db.sqlite3", help="Path to SQLite database file")
args = parser.parse_args()

# Create database connection
engine = create_engine(f"sqlite:///{args.db_path}")
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("=" * 80)
print("ALL USERS")
print("=" * 80)
users = db.query(models.User).all()
for user in users:
    print(f"User ID: {user.id}, Email: {user.email}")

print("\n" + "=" * 80)
print("ALL GUESTS (including unclaimed)")
print("=" * 80)
guests = db.query(models.GuestMember).all()
for guest in guests:
    claimed_status = f"Claimed by User {guest.claimed_by_id}" if guest.claimed_by_id else "Unclaimed"
    managed_status = f"Managed by {guest.managed_by_type} {guest.managed_by_id}" if guest.managed_by_id else "Not managed"
    print(f"Guest ID: {guest.id}, Name: '{guest.name}', {claimed_status}, {managed_status}")

print("\n" + "=" * 80)
print("ALL GROUP MEMBERS")
print("=" * 80)
members = db.query(models.GroupMember).all()
for member in members:
    user = db.query(models.User).filter(models.User.id == member.user_id).first()
    email = user.email if user else "Unknown"
    managed_status = f"Managed by {member.managed_by_type} {member.managed_by_id}" if member.managed_by_id else "Not managed"
    print(f"Group {member.group_id}, User {member.user_id} ({email}), {managed_status}")

db.close()
