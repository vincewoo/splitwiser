import re
from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from utils.currency import VALID_CURRENCIES

# Venmo handles are letters, numbers, dashes and underscores. Length is checked
# separately so the two failures can say different things.
VENMO_USERNAME_RE = re.compile(r'[A-Za-z0-9_-]+')

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = Field(None, max_length=100)

class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)
    claim_guest_id: Optional[int] = None
    share_link_id: Optional[str] = None

class User(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True

class ExpenseSplitBase(BaseModel):
    user_id: int
    is_guest: bool = False
    amount_owed: int
    percentage: Optional[int] = None
    shares: Optional[float] = None

# Expense guest schemas (for non-group expenses)
class ExpenseGuestCreate(BaseModel):
    """Ad-hoc guest in expense creation request"""
    temp_id: str  # Client-generated temporary ID for item assignment reference
    name: str = Field(..., max_length=100)


class ExpenseGuestResponse(BaseModel):
    """Expense guest in response"""
    id: int
    expense_id: int
    name: str
    amount_owed: int
    paid: bool
    paid_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ExpenseGuestPaidUpdate(BaseModel):
    """Request to update paid status"""
    paid: bool


# Itemized expense schemas
class ItemAssignment(BaseModel):
    user_id: Optional[int] = None
    is_guest: bool = False
    temp_guest_id: Optional[str] = None  # For ad-hoc expense guests (references temp_id)
    expense_guest_id: Optional[int] = None  # For existing expense guests (from edit flow)

class ItemSplitDetail(BaseModel):
    amount: Optional[int] = None  # For EXACT split (in cents)
    percentage: Optional[float] = None  # For PERCENTAGE split (0-100)
    shares: Optional[float] = None  # For SHARES split

class ExpenseItemCreate(BaseModel):
    description: str = Field(..., max_length=200)
    price: int  # In cents
    is_tax_tip: bool = False
    assignments: list[ItemAssignment] = []
    split_type: Optional[str] = 'EQUAL'  # EQUAL, EXACT, PERCENT, SHARES
    split_details: Optional[Dict[str, ItemSplitDetail]] = None  # Keyed by "user_{id}" or "guest_{id}"

class ExpenseItemAssignmentDetail(BaseModel):
    user_id: Optional[int] = None
    is_guest: bool = False
    expense_guest_id: Optional[int] = None
    user_name: str

class ExpenseItemDetail(BaseModel):
    id: int
    expense_id: int
    description: str
    price: int
    is_tax_tip: bool
    assignments: list[ExpenseItemAssignmentDetail]
    split_type: Optional[str] = 'EQUAL'
    split_details: Optional[Dict[str, Dict]] = None  # Deserialized from JSON

    class Config:
        from_attributes = True

class ExpenseCreate(BaseModel):
    description: str = Field(..., max_length=200)
    amount: int
    currency: str = Field("USD", min_length=3, max_length=3)
    date: str
    payer_id: int
    payer_is_guest: bool = False  # True if payer is a group guest
    payer_is_expense_guest: bool = False  # True if payer is an expense guest
    payer_temp_guest_id: Optional[str] = None  # Reference to expense guest temp_id if payer is expense guest
    group_id: Optional[int] = None
    splits: list[ExpenseSplitBase]
    split_type: str  # EQUAL, EXACT, PERCENT, SHARES, ITEMIZED
    items: Optional[list[ExpenseItemCreate]] = None  # Only for ITEMIZED type
    expense_guests: Optional[list[ExpenseGuestCreate]] = None  # For non-group expenses only
    icon: Optional[str] = Field(None, max_length=10)  # Optional emoji icon
    receipt_image_path: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=1000)
    is_settlement: bool = False  # True if this is a payment/settlement

class Expense(BaseModel):
    id: int
    description: str
    amount: int
    currency: str
    date: str
    payer_id: int
    payer_is_guest: bool = False
    payer_is_expense_guest: bool = False
    group_id: Optional[int]
    created_by_id: Optional[int] = None
    exchange_rate: Optional[str] = None
    icon: Optional[str] = None
    receipt_image_path: Optional[str] = None
    notes: Optional[str] = None
    is_settlement: bool = False

    class Config:
        from_attributes = True

class ExpenseSplitDetail(BaseModel):
    id: int
    expense_id: int
    user_id: int
    is_guest: bool = False
    amount_owed: int
    percentage: Optional[int] = None
    shares: Optional[float] = None
    user_name: str

    class Config:
        from_attributes = True

class ExpenseWithSplits(Expense):
    splits: list[ExpenseSplitDetail]
    split_type: Optional[str] = None
    items: list[ExpenseItemDetail] = []  # Only populated for ITEMIZED type
    expense_guests: list[ExpenseGuestResponse] = []  # For non-group expenses with ad-hoc guests
    has_unknown_assignments: bool = False  # True if expense has items with no assignments (incomplete)
    exchange_rate_target_currency: Optional[str] = None  # Currency that exchange_rate is relative to (e.g., "USD" or group default)
    # Set when this expense is what a closed tab resolved into, so the client
    # can offer a way back to the tab's item-by-item board. Derived from
    # Tab.expense_id rather than stored on the expense.
    tab_id: Optional[int] = None

class ExpenseUpdate(BaseModel):
    description: str = Field(..., max_length=200)
    amount: int
    currency: str = Field("USD", min_length=3, max_length=3)
    date: str
    payer_id: int
    payer_is_guest: bool = False
    payer_is_expense_guest: bool = False
    payer_temp_guest_id: Optional[str] = None
    splits: list[ExpenseSplitBase]
    split_type: str  # EQUAL, EXACT, PERCENT, SHARES, ITEMIZED
    items: Optional[list[ExpenseItemCreate]] = None  # Only for ITEMIZED type
    expense_guests: Optional[list[ExpenseGuestCreate]] = None  # For non-group expenses only
    icon: Optional[str] = Field(None, max_length=10)  # Optional emoji icon
    receipt_image_path: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=1000)
    is_settlement: bool = False

class Token(BaseModel):
    access_token: str
    token_type: str
    refresh_token: str
    claimed_group_id: Optional[int] = None

class TokenData(BaseModel):
    email: Optional[str] = None

class GroupBase(BaseModel):
    name: str = Field(..., max_length=100)
    default_currency: str = Field("USD", min_length=3, max_length=3)
    icon: Optional[str] = Field(None, max_length=10)

    @field_validator('default_currency')
    @classmethod
    def validate_currency(cls, v):
        if v not in VALID_CURRENCIES:
            raise ValueError(f'Currency must be one of {VALID_CURRENCIES}')
        return v

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    created_by_id: int
    share_link_id: Optional[str] = None
    is_public: bool = False

    class Config:
        from_attributes = True

class FriendAddRequest(BaseModel):
    """Request to add friend by email (legacy)."""
    email: EmailStr


# Friend Request Schemas (for request/approval workflow)
class FriendRequestCreate(BaseModel):
    """Request to send a friend request by user ID."""
    user_id: int


class FriendRequestResponse(BaseModel):
    """Friend request with user info."""
    id: int
    from_user_id: int
    from_user_name: str
    from_user_email: str
    to_user_id: int
    to_user_name: str
    to_user_email: str
    status: str  # pending, accepted, rejected
    created_at: str

    class Config:
        from_attributes = True


class FriendshipStatus(BaseModel):
    """Status of relationship between current user and another user."""
    user_id: int
    full_name: str
    email: str
    status: str  # "friends", "pending_incoming", "pending_outgoing", "none"
    request_id: Optional[int] = None  # If pending, the request ID


class PendingRequestCount(BaseModel):
    """Count of pending incoming friend requests."""
    count: int


class Friend(BaseModel):
    id: int
    full_name: str
    email: str
    # Only ever returned to people you are already friends with, so settling up
    # can hand them a pre-filled payment. Absent from every public payload.
    venmo_username: Optional[str] = None

    class Config:
        from_attributes = True

class GroupMemberAdd(BaseModel):
    email: EmailStr

class GroupMember(BaseModel):
    id: int
    user_id: int
    full_name: str
    email: str
    managed_by_id: Optional[int] = None
    managed_by_type: Optional[str] = None
    managed_by_name: Optional[str] = None

    class Config:
        from_attributes = True

class PublicGroupMember(BaseModel):
    id: int
    user_id: int
    full_name: str
    # email: str  <-- Removed for privacy
    managed_by_id: Optional[int] = None
    managed_by_type: Optional[str] = None
    managed_by_name: Optional[str] = None

    class Config:
        from_attributes = True

class GuestMemberCreate(BaseModel):
    name: str = Field(..., max_length=100)

class GuestMember(BaseModel):
    id: int
    group_id: int
    name: str
    created_by_id: int
    claimed_by_id: Optional[int] = None
    managed_by_id: Optional[int] = None
    managed_by_type: Optional[str] = None  # 'user' or 'guest'
    managed_by_name: Optional[str] = None

    class Config:
        from_attributes = True

class GroupUpdate(BaseModel):
    name: str = Field(..., max_length=100)
    default_currency: str = Field("USD", min_length=3, max_length=3)
    icon: Optional[str] = Field(None, max_length=10)

    @field_validator('default_currency')
    @classmethod
    def validate_currency(cls, v):
        if v not in VALID_CURRENCIES:
            raise ValueError(f'Currency must be one of {VALID_CURRENCIES}')
        return v

class GroupWithMembers(Group):
    members: list[GroupMember]
    guests: list[GuestMember] = []

    class Config:
        from_attributes = True

class PublicGroupWithMembers(Group):
    members: list[PublicGroupMember]
    guests: list[GuestMember] = []

    class Config:
        from_attributes = True

class GroupBalance(BaseModel):
    user_id: int
    is_guest: bool = False
    full_name: str
    amount: float
    currency: str
    managed_guests: list[str] = []  # Names of managed guests included in this balance


# Group spending summary response schemas
#
# Shape is intentionally parallel to `utils.summary.ConsumptionSummary`
# minus the internal `skipped_unparseable_dates` observability counter, which
# is logged server-side and not surfaced to clients.
class GroupSummaryManagedMember(BaseModel):
    """One managed member folded into a manager's consumption row."""
    display_name: str
    total: int  # Integer cents, in the group's default currency.

    class Config:
        from_attributes = True


class GroupSummarySeriesPointMember(BaseModel):
    """Per-member contribution to a single time bucket."""
    user_id: int
    is_guest: bool
    amount: int  # Integer cents.

    class Config:
        from_attributes = True


class GroupSummarySeriesPoint(BaseModel):
    """A single time bucket in the spending series."""
    period_label: str  # e.g. "2026-W16", "2026-04", "2026-Q2"
    period_start: str  # ISO date YYYY-MM-DD — first day of the bucket.
    total: int  # Integer cents — Σ per_member[].amount.
    per_member: list[GroupSummarySeriesPointMember] = []

    class Config:
        from_attributes = True


class GroupSummaryMember(BaseModel):
    """One top-level member row (managed members already folded in)."""
    user_id: int
    is_guest: bool
    display_name: str
    total: int  # Integer cents.
    managed_members: list[GroupSummaryManagedMember] = []

    class Config:
        from_attributes = True


class GroupSummaryResponse(BaseModel):
    """
    Authenticated group spending-summary response.

    Invariant (enforced at the aggregation layer):
        group_total == Σ members[].total
                    == Σ series[].total
                    == Σ series[].per_member[].amount
    """
    group_total: int  # Integer cents.
    currency: str  # Group's default currency (pass-through).
    granularity: Literal["week", "month", "quarter"]
    has_synthesized_historical_rate: bool
    members: list[GroupSummaryMember] = []
    series: list[GroupSummarySeriesPoint] = []

    class Config:
        from_attributes = True


# Public (unauthenticated) group summary schemas.
#
# These are DELIBERATELY separate types from `GroupSummaryResponse` — not a
# subset via subclassing, not a reshaped dict. The public endpoint must not
# leak per-member data or names, and the cleanest way to enforce that is to
# make it structurally impossible at the serialization boundary: FastAPI's
# response_model=PublicGroupSummaryResponse will drop any extra fields even
# if a handler accidentally returned a full ConsumptionSummary.
class PublicGroupSummarySeriesPoint(BaseModel):
    """A single time bucket in the public spending series — totals only."""
    period_label: str  # e.g. "2026-W16", "2026-04", "2026-Q2"
    period_start: str  # ISO date YYYY-MM-DD — first day of the bucket.
    total: int  # Integer cents.

    class Config:
        from_attributes = True


class PublicGroupSummaryResponse(BaseModel):
    """
    Public (share-link) group spending-summary response.

    Strictly narrower than :class:`GroupSummaryResponse`:
        * NO ``members`` field.
        * NO ``per_member`` data on series points.
        * NO ``display_name`` anywhere.
    """
    group_total: int  # Integer cents.
    currency: str  # Group's default currency (pass-through).
    granularity: Literal["week", "month", "quarter"]
    has_synthesized_historical_rate: bool
    series: list[PublicGroupSummarySeriesPoint] = []

    class Config:
        from_attributes = True


# Request/Response models previously inline in main.py
class RefreshTokenRequest(BaseModel):
    refresh_token: str


class ManageGuestRequest(BaseModel):
    user_id: int
    is_guest: bool = False  # Set to True if manager is a guest


class MergeGuestRequest(BaseModel):
    """Fold a guest onto an account already in the group. `user_id` is that account."""
    user_id: int


class Balance(BaseModel):
    """Balance representing what a user owes or is owed."""
    user_id: int
    full_name: str
    amount: float  # Positive means you are owed, negative means you owe
    currency: str
    is_guest: bool = False
    group_name: Optional[str] = None
    group_id: Optional[int] = None


class FriendBalance(BaseModel):
    """Balance between current user and a specific friend."""
    amount: float  # Positive = friend owes you, negative = you owe friend
    currency: str


class FriendExpenseWithSplits(ExpenseWithSplits):
    """Expense with group name and balance impact for friend detail page."""
    group_name: Optional[str] = None
    balance_impact: Optional[int] = None  # Balance impact in cents: positive = friend owes you, negative = you owe friend


# Profile Management and Password Recovery Schemas


class PasswordChangeRequest(BaseModel):
    """Request to change password (requires current password)"""
    current_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    """Request to send password reset email"""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Request to reset password with token"""
    token: str
    new_password: str = Field(..., min_length=8, max_length=128)


class ProfileUpdateRequest(BaseModel):
    """Request to update user profile"""
    full_name: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    default_currency: Optional[str] = Field(None, min_length=3, max_length=3)
    # Empty string clears it; see the validator.
    venmo_username: Optional[str] = Field(None, max_length=31)

    @field_validator('default_currency')
    @classmethod
    def validate_currency(cls, v):
        if v is None:
            return v
        if v not in VALID_CURRENCIES:
            raise ValueError(f'Currency must be one of {VALID_CURRENCIES}')
        return v

    @field_validator('venmo_username')
    @classmethod
    def validate_venmo_username(cls, v):
        """
        Normalise a Venmo handle: strip a leading @, keep the rest verbatim.

        An empty (or whitespace-only) value means "remove mine", and is
        distinct from omitting the field, which means "leave it alone".

        Deliberately permissive about the character set beyond the obvious
        unsafe ones: Venmo owns the rules for what handles exist, they have
        changed before, and rejecting a handle somebody actually has would be
        worse than letting a bad one through — the link simply lands on a
        Venmo page that says no such user.
        """
        if v is None:
            return None

        handle = v.strip().lstrip('@').strip()
        if not handle:
            return ''  # sentinel for "clear it"

        if len(handle) > 30:
            raise ValueError('Venmo usernames are at most 30 characters')
        if not VENMO_USERNAME_RE.fullmatch(handle):
            raise ValueError(
                'Venmo usernames use letters, numbers, dashes and underscores'
            )
        return handle


class VerifyEmailRequest(BaseModel):
    """Request to verify new email address"""
    token: str


class UserProfile(BaseModel):
    """Extended user profile with security metadata"""
    id: int
    email: str
    full_name: str
    is_active: bool
    email_verified: bool
    password_changed_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    default_currency: str = "USD"
    venmo_username: Optional[str] = None

    class Config:
        from_attributes = True


# OCR / Receipt Scanning schemas
class ReceiptScanItem(BaseModel):
    """Single item extracted from a receipt by the LLM."""
    description: str
    price: int  # Total line price in cents
    quantity: int = 1


class ReceiptScanResponse(BaseModel):
    """Response from LLM-based receipt scanning."""
    items: list[ReceiptScanItem]
    tax: Optional[int] = None  # Cents
    tip: Optional[int] = None  # Cents
    total: Optional[int] = None  # Cents
    receipt_image_path: str


# Google OAuth Schemas
class GoogleAuthRequest(BaseModel):
    """Request body for Google OAuth authentication."""
    id_token: str  # The ID token from Google Sign-In
    claim_guest_id: Optional[int] = None  # For guest claiming during OAuth registration
    share_link_id: Optional[str] = None


class GoogleAuthResponse(BaseModel):
    """Response for successful Google OAuth."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    is_new_user: bool  # True if a new account was created
    claimed_group_id: Optional[int] = None
    account_linked: bool = False  # True if Google was linked to existing account


class GoogleLinkRequest(BaseModel):
    """Request to link Google account to existing user."""
    id_token: str


class SetPasswordRequest(BaseModel):
    """Request to set password for OAuth-only users."""
    new_password: str = Field(..., min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------

class TabItemCreate(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    price: int = Field(ge=0, le=100_000_000)  # cents


class TabCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    items: List[TabItemCreate] = Field(default_factory=list, max_length=200)
    tax: int = Field(default=0, ge=0, le=100_000_000)
    tip: int = Field(default=0, ge=0, le=100_000_000)
    total: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    receipt_image_path: Optional[str] = None


class TabItemOut(BaseModel):
    id: int
    description: str
    price: int
    added_manually: bool
    # Participant ids claiming this line; several means it is shared.
    claimed_by: List[int] = Field(default_factory=list)

    class Config:
        from_attributes = True


class TabParticipantOut(BaseModel):
    id: int
    display_name: str
    # Present only for participants who were signed in when they claimed.
    user_id: Optional[int] = None

    class Config:
        from_attributes = True


class TabOut(BaseModel):
    id: int
    name: str
    currency: str
    status: str
    tax: int
    tip: int
    total: Optional[int]
    created_by_id: int
    payer_id: Optional[int]
    expense_id: Optional[int]
    items: List[TabItemOut] = Field(default_factory=list)
    participants: List[TabParticipantOut] = Field(default_factory=list)
    # The scanned bill, so the owner can check the lines against the paper.
    # Owner-only, like the token below: a link-holder gets the parsed lines,
    # not the photograph (which can carry a card's last four and a signature).
    receipt_image_path: Optional[str] = None
    # Owner-only: absent from the public view.
    share_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PublicTabOut(BaseModel):
    """What a link-holder sees. Deliberately narrower than TabOut."""
    name: str
    currency: str
    status: str
    tax: int
    tip: int
    total: Optional[int]
    items: List[TabItemOut] = Field(default_factory=list)
    participants: List[TabParticipantOut] = Field(default_factory=list)


class TabAmountsUpdate(BaseModel):
    """
    Owner correcting the tax or the tip on a tab that is still open.

    The scan is a convenience, not an authority: it misses a tip written in
    after the receipt printed, reads a service charge as an item, or never
    finds the tax line at all. Either field may be omitted to leave it alone.
    """
    tax: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    tip: Optional[int] = Field(default=None, ge=0, le=100_000_000)


class TabParticipantCreate(BaseModel):
    """Owner seating somebody who is at the table but not on the link."""
    display_name: str = Field(min_length=1, max_length=60)


class TabJoinRequest(BaseModel):
    # Optional only for a signed-in caller, whose account supplies the name.
    display_name: Optional[str] = Field(default=None, max_length=60)
    # Sent by someone who claimed anonymously and has since signed in: it binds
    # the account to the row they have been claiming from, so their picks come
    # with them instead of being left behind under a guest.
    claim_token: Optional[str] = Field(default=None, max_length=128)


class TabJoinResponse(BaseModel):
    participant: TabParticipantOut
    # Identifies this claimer on later requests; they have no account.
    claim_token: str
    tab: PublicTabOut


class TabRenameRequest(BaseModel):
    """Change the name you are claiming under, keeping the claims you made."""
    claim_token: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=60)


class TabIdentityResponse(BaseModel):
    """A rename result. No claim token: the caller already holds theirs."""
    participant: TabParticipantOut
    tab: PublicTabOut


class TabClaimRequest(BaseModel):
    claim_token: str = Field(min_length=1, max_length=128)
    claimed: bool = True


class TabSelfClaimRequest(BaseModel):
    """A signed-in participant claiming for themselves; no token needed."""
    claimed: bool = True


class TabCloseRequest(BaseModel):
    """Closing turns the tab into one ordinary direct expense."""
    payer_participant_id: Optional[int] = None
    date: Optional[str] = None
