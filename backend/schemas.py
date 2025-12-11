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

class ExpenseCreate(BaseModel):
    description: str
    amount: int
    currency: str = "USD"
    date: str
    payer_id: int
    payer_is_guest: bool = False
    group_id: Optional[int] = None
    splits: list[ExpenseSplitBase]
    split_type: str # EQUAL, EXACT, PERCENT, SHARES

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

class ExpenseUpdate(BaseModel):
    description: str
    amount: int
    currency: str = "USD"
    date: str
    payer_id: int
    payer_is_guest: bool = False
    splits: list[ExpenseSplitBase]
    split_type: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class GroupBase(BaseModel):
    name: str
    default_currency: str = "USD"

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

    class Config:
        from_attributes = True

class GroupUpdate(BaseModel):
    name: str
    default_currency: str = "USD"

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
