#!/usr/bin/env python3
"""
Initialize/recreate database tables from models
"""
from database import engine, Base
from models import (
    User, Group, GroupMember, GuestMember, Friendship,
    Expense, ExpenseSplit, ExpenseItem, ExpenseItemAssignment,
    RefreshToken
)

if __name__ == "__main__":
    print("Creating all database tables...")
    Base.metadata.create_all(bind=engine)
    print("✓ Database tables created successfully!")
