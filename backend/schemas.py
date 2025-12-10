from pydantic import BaseModel, EmailStr
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
    amount_owed: int
    percentage: Optional[int] = None
    shares: Optional[int] = None

class ExpenseCreate(BaseModel):
    description: str
    amount: int
    currency: str = "USD"
    date: str
    payer_id: int
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
    group_id: Optional[int]

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class GroupBase(BaseModel):
    name: str

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
