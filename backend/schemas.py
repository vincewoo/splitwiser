from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None

class UserCreate(UserBase):
    password: str

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
    shares: Optional[int] = None

# Itemized expense schemas
class ItemAssignment(BaseModel):
    user_id: int
    is_guest: bool = False

class ExpenseItemCreate(BaseModel):
    description: str
    price: int  # In cents
    is_tax_tip: bool = False
    assignments: list[ItemAssignment] = []

class ExpenseItemAssignmentDetail(BaseModel):
    user_id: int
    is_guest: bool
    user_name: str

class ExpenseItemDetail(BaseModel):
    id: int
    expense_id: int
    description: str
    price: int
    is_tax_tip: bool
    assignments: list[ExpenseItemAssignmentDetail]

    class Config:
        from_attributes = True

class ExpenseCreate(BaseModel):
    description: str
    amount: int
    currency: str = "USD"
    date: str
    payer_id: int
    payer_is_guest: bool = False
    group_id: Optional[int] = None
    splits: list[ExpenseSplitBase]
    split_type: str  # EQUAL, EXACT, PERCENT, SHARES, ITEMIZED
    items: Optional[list[ExpenseItemCreate]] = None  # Only for ITEMIZED type
    icon: Optional[str] = None  # Optional emoji icon
    icon: Optional[str] = None  # Optional emoji icon
    receipt_image_path: Optional[str] = None
    notes: Optional[str] = None

class Expense(BaseModel):
    id: int
    description: str
    amount: int
    currency: str
    date: str
    payer_id: int
    payer_is_guest: bool = False
    group_id: Optional[int]
    created_by_id: Optional[int] = None
    icon: Optional[str] = None
    icon: Optional[str] = None
    receipt_image_path: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True

class ExpenseSplitDetail(BaseModel):
    id: int
    expense_id: int
    user_id: int
    is_guest: bool = False
    amount_owed: int
    percentage: Optional[int] = None
    shares: Optional[int] = None
    user_name: str

    class Config:
        from_attributes = True

class ExpenseWithSplits(Expense):
    splits: list[ExpenseSplitDetail]
    split_type: Optional[str] = None
    items: list[ExpenseItemDetail] = []  # Only populated for ITEMIZED type

class ExpenseUpdate(BaseModel):
    description: str
    amount: int
    currency: str = "USD"
    date: str
    payer_id: int
    payer_is_guest: bool = False
    splits: list[ExpenseSplitBase]
    split_type: str  # EQUAL, EXACT, PERCENT, SHARES, ITEMIZED
    items: Optional[list[ExpenseItemCreate]] = None  # Only for ITEMIZED type
    icon: Optional[str] = None  # Optional emoji icon
    icon: Optional[str] = None  # Optional emoji icon
    receipt_image_path: Optional[str] = None
    notes: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class GroupBase(BaseModel):
    name: str
    default_currency: str = "USD"
    icon: Optional[str] = None

    @field_validator('default_currency')
    @classmethod
    def validate_currency(cls, v):
        valid_currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD']
        if v not in valid_currencies:
            raise ValueError(f'Currency must be one of {valid_currencies}')
        return v

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    created_by_id: int

    class Config:
        from_attributes = True

class FriendRequest(BaseModel):
    email: str

class Friend(BaseModel):
    id: int
    full_name: str
    email: str

    class Config:
        from_attributes = True

class GroupMemberAdd(BaseModel):
    email: str

class GroupMember(BaseModel):
    id: int
    user_id: int
    full_name: str
    email: str

    class Config:
        from_attributes = True

class GuestMemberCreate(BaseModel):
    name: str

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
    name: str
    default_currency: str = "USD"
    icon: Optional[str] = None

    @field_validator('default_currency')
    @classmethod
    def validate_currency(cls, v):
        valid_currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD']
        if v not in valid_currencies:
            raise ValueError(f'Currency must be one of {valid_currencies}')
        return v

class GroupWithMembers(Group):
    members: list[GroupMember]
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


# Request/Response models previously inline in main.py
class RefreshTokenRequest(BaseModel):
    refresh_token: str


class ManageGuestRequest(BaseModel):
    user_id: int
    is_guest: bool = False  # Set to True if manager is a guest


class Balance(BaseModel):
    """Balance representing what a user owes or is owed."""
    user_id: int
    full_name: str
    amount: float  # Positive means you are owed, negative means you owe
    currency: str
    is_guest: bool = False
    group_name: Optional[str] = None
    group_id: Optional[int] = None
