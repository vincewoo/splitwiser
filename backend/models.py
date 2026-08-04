from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True)  # Nullable for OAuth-only users
    full_name = Column(String)
    is_active = Column(Boolean, default=True)
    password_changed_at = Column(DateTime, nullable=True)
    email_verified = Column(Boolean, default=False)
    last_login_at = Column(DateTime, nullable=True)
    default_currency = Column(String, default="USD")
    # Venmo handle, without the leading @. Visible to friends so they can be
    # handed a pre-filled payment; never exposed on a public share link.
    venmo_username = Column(String, nullable=True)
    # OAuth fields
    google_id = Column(String, unique=True, nullable=True, index=True)  # Google's unique user ID
    google_picture = Column(String, nullable=True)  # Profile picture URL from Google
    auth_provider = Column(String, default="local")  # "local", "google", or "both"

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
    payer_is_guest = Column(Boolean, default=False)  # True if payer is a group guest
    payer_is_expense_guest = Column(Boolean, default=False)  # True if payer is an expense guest
    # Optimized: Index added for frequent filtering by group
    group_id = Column(Integer, nullable=True, index=True)
    created_by_id = Column(Integer)
    exchange_rate = Column(String, nullable=True) # Rate from currency to USD on expense date (stored as float)
    split_type = Column(String, default="EQUAL") # EQUAL, EXACT, PERCENT, SHARES, ITEMIZED
    receipt_image_path = Column(String, nullable=True) # Path to stored receipt image
    icon = Column(String, nullable=True) # Optional emoji icon for categorization
    notes = Column(String, nullable=True) # Freeform text notes
    is_settlement = Column(Boolean, default=False) # True if this is a payment/settlement

class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id = Column(Integer, primary_key=True, index=True)
    # Optimized: Indexes added for frequent joins and lookups
    expense_id = Column(Integer, index=True)
    user_id = Column(Integer, index=True)
    is_guest = Column(Boolean, default=False)
    amount_owed = Column(Integer) # The amount this user owes
    percentage = Column(Integer, nullable=True) # For percentage splits
    shares = Column(Numeric(10, 2), nullable=True) # For share splits

class ExpenseItem(Base):
    __tablename__ = "expense_items"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, nullable=False)
    description = Column(String, nullable=False)
    price = Column(Integer, nullable=False)  # In cents
    is_tax_tip = Column(Boolean, default=False)
    split_type = Column(String, default='EQUAL')  # EQUAL, EXACT, PERCENT, SHARES
    split_details = Column(String, nullable=True)  # JSON string of split details

class ExpenseItemAssignment(Base):
    __tablename__ = "expense_item_assignments"

    id = Column(Integer, primary_key=True, index=True)
    expense_item_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=True)  # For registered users and group guests
    is_guest = Column(Boolean, default=False)  # True if user_id refers to a group guest
    expense_guest_id = Column(Integer, nullable=True, index=True)  # For ad-hoc expense guests

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False)
    token_hash = Column(String, unique=True, nullable=False)  # Store hashed token
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    revoked = Column(Boolean, default=False)

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    used = Column(Boolean, default=False, nullable=False)

class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    new_email = Column(String, nullable=False)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    used = Column(Boolean, default=False, nullable=False)


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id = Column(Integer, primary_key=True, index=True)
    from_user_id = Column(Integer, nullable=False, index=True)
    to_user_id = Column(Integer, nullable=False, index=True)
    status = Column(String, default="pending")  # pending, accepted, rejected
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ExpenseGuest(Base):
    """Ad-hoc guest for non-group expenses (one-time splits)"""
    __tablename__ = "expense_guests"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, nullable=False, index=True)
    name = Column(String, nullable=False)
    amount_owed = Column(Integer, nullable=False, default=0)  # In cents
    paid = Column(Boolean, default=False)
    paid_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, nullable=False)


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------
# A tab is a one-off bill shared with a table of people, most of whom are not
# in a group and may not have accounts. The receipt creates the container and
# whoever claims an item becomes a participant — so unlike a Group there is
# nothing to name up front and nobody to invite.
#
# A tab is deliberately NOT a Group: it never appears under Groups, and on
# close it resolves into ordinary direct expenses (group_id NULL) so the
# balances land in the same person-to-person totals everything else uses.


class Tab(Base):
    """An open bill that people claim items from via a share link."""
    __tablename__ = "tabs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # Venue, e.g. "Bar Sol"
    created_by_id = Column(Integer, nullable=False, index=True)
    currency = Column(String, default="USD")

    # Public share link. Unlike Group.share_link_id — a permanent, read-only
    # UUID — this token grants WRITE access (claiming), so it is high-entropy,
    # expiring and revocable.
    share_token = Column(String, unique=True, index=True, nullable=False)
    token_expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)

    status = Column(String, default="open", nullable=False)  # open | closed

    # Who fronted the bill, as a *user*. Set at close, and only when the payer
    # has an account — it is what the resulting expense is paid by.
    payer_id = Column(Integer, nullable=True)

    # Who fronted the bill, as a *seat*. The one the host can name while the
    # tab is still open, and the only way to say "Dana paid" when Dana has no
    # account: the person who does the organising is not always the person who
    # handed over a card. Null means nobody has said, in which case the creator
    # is assumed. Supersedes payer_id, which is derived from this at close.
    payer_participant_id = Column(Integer, nullable=True)

    tax = Column(Integer, default=0, nullable=False)   # cents
    tip = Column(Integer, default=0, nullable=False)   # cents
    total = Column(Integer, nullable=True)             # printed total, cents
    receipt_image_path = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    closed_at = Column(DateTime, nullable=True)
    # Set once the tab resolves into a real expense.
    expense_id = Column(Integer, nullable=True, index=True)


class TabItem(Base):
    """One line on the tab. Tax and tip are columns on Tab, not items."""
    __tablename__ = "tab_items"

    id = Column(Integer, primary_key=True, index=True)
    tab_id = Column(Integer, nullable=False, index=True)
    description = Column(String, nullable=False)
    price = Column(Integer, nullable=False)  # cents
    # True for lines added by hand on the live board rather than by the scan.
    added_manually = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class TabParticipant(Base):
    """
    Someone at the table. Created the moment they claim, not by invitation.

    `user_id` is set when a signed-in user claims; anonymous claimers are
    identified only by their own `claim_token`, which is what lets them come
    back and change their mind without an account.

    One person is one row for the life of the tab: changing your name renames
    this row rather than seating a second you.
    """
    __tablename__ = "tab_participants"

    id = Column(Integer, primary_key=True, index=True)
    tab_id = Column(Integer, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    user_id = Column(Integer, nullable=True, index=True)
    claim_token = Column(String, unique=True, index=True, nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # A Venmo handle for a seat with no account behind it. An account already
    # carries its own on the User row, and that one always wins; this exists so
    # a payer who has never heard of Splitwiser can still be paid from the
    # claim page. Owner-set, because that seat has nobody holding it.
    venmo_username = Column(String, nullable=True)

    # Whether this person has settled their share with whoever fronted the
    # bill. Nothing here can verify a payment — it is the host ticking people
    # off at the table, which is the only source of truth that exists when the
    # money moves outside the app entirely.
    paid = Column(Boolean, default=False, nullable=False)
    paid_at = Column(DateTime, nullable=True)

    # A name is how everyone else at the table tells people apart, so two
    # "Maya"s on one tab are unusable however they got there — and a second
    # row for someone already seated silently strands their claims. Compared
    # case-insensitively because "maya" and "Maya" are the same person to
    # everybody reading the board.
    #
    # An account is the same invariant on the other axis: seating one twice
    # would put two splits for one user on the closed expense. NULL repeats
    # freely under a unique index, so anonymous seats are unaffected.
    #
    # Both mirror the migration's indexes.
    __table_args__ = (
        Index(
            "ux_tab_participants_tab_name",
            "tab_id",
            func.lower(display_name),
            unique=True,
        ),
        Index(
            "ux_tab_participants_tab_user",
            "tab_id",
            "user_id",
            unique=True,
        ),
    )


class TabItemClaim(Base):
    """
    A participant's claim on one item.

    Several people claiming the same item is sharing, not a conflict: the line
    splits evenly between everyone on it.
    """
    __tablename__ = "tab_item_claims"
    # One claim per person per line, enforced in the schema so a retry or a
    # double tap cannot double-count. Mirrors the migration's unique index.
    __table_args__ = (
        UniqueConstraint("item_id", "participant_id", name="ux_tab_item_claims_item_participant"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tab_id = Column(Integer, nullable=False, index=True)
    item_id = Column(Integer, nullable=False, index=True)
    participant_id = Column(Integer, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
