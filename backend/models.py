from sqlalchemy import Column, Integer, String, Boolean, DateTime
from database import Base
from datetime import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    full_name = Column(String)
    is_active = Column(Boolean, default=True)

class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    created_by_id = Column(Integer)
    default_currency = Column(String, default="USD")
    icon = Column(String, nullable=True)  # Optional emoji icon for group
    share_link_id = Column(String, unique=True, nullable=True) # UUID for public share link
    is_public = Column(Boolean, default=False) # Whether public sharing is enabled

class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer)
    user_id = Column(Integer)
    managed_by_id = Column(Integer, nullable=True)  # ID of manager (user or guest)
    managed_by_type = Column(String, nullable=True)  # 'user' or 'guest'

class GuestMember(Base):
    __tablename__ = "guest_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    created_by_id = Column(Integer, nullable=False)
    claimed_by_id = Column(Integer, nullable=True)  # Set when claimed by registered user
    managed_by_id = Column(Integer, nullable=True)  # ID of manager (user or guest)
    managed_by_type = Column(String, nullable=True)  # 'user' or 'guest'

class Friendship(Base):
    __tablename__ = "friendships"

    id = Column(Integer, primary_key=True, index=True)
    user_id1 = Column(Integer)
    user_id2 = Column(Integer)

class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    description = Column(String)
    amount = Column(Integer) # Stored in cents/smallest unit
    currency = Column(String, default="USD")
    date = Column(String) # ISO date string
    payer_id = Column(Integer)
    payer_is_guest = Column(Boolean, default=False)
    # Optimized: Index added for frequent filtering by group
    group_id = Column(Integer, nullable=True, index=True)
    created_by_id = Column(Integer)
    exchange_rate = Column(String, nullable=True) # Rate from currency to USD on expense date (stored as float)
    split_type = Column(String, default="EQUAL") # EQUAL, EXACT, PERCENT, SHARES, ITEMIZED
    receipt_image_path = Column(String, nullable=True) # Path to stored receipt image
    icon = Column(String, nullable=True) # Optional emoji icon for categorization
    notes = Column(String, nullable=True) # Freeform text notes

class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id = Column(Integer, primary_key=True, index=True)
    # Optimized: Indexes added for frequent joins and lookups
    expense_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    is_guest = Column(Boolean, default=False)
    amount_owed = Column(Integer) # The amount this user owes
    percentage = Column(Integer, nullable=True) # For percentage splits
    shares = Column(Integer, nullable=True) # For share splits

class ExpenseItem(Base):
    __tablename__ = "expense_items"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, nullable=False)
    description = Column(String, nullable=False)
    price = Column(Integer, nullable=False)  # In cents
    is_tax_tip = Column(Boolean, default=False)

class ExpenseItemAssignment(Base):
    __tablename__ = "expense_item_assignments"

    id = Column(Integer, primary_key=True, index=True)
    expense_item_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    is_guest = Column(Boolean, default=False)

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False)
    token_hash = Column(String, unique=True, nullable=False)  # Store hashed token
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    revoked = Column(Boolean, default=False)

