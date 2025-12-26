from fastapi import Depends, FastAPI, HTTPException, status, File, UploadFile
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import timedelta, datetime
from typing import Annotated, Optional
from pydantic import BaseModel
import requests

import models, schemas, auth, database
from database import engine, get_db
# from ocr.service import ocr_service
# from ocr.parser import parse_receipt_items

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()

def get_group_or_404(db: Session, group_id: int):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group

def verify_group_membership(db: Session, group_id: int, user_id: int):
    member = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == user_id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    return member

def verify_group_ownership(db: Session, group_id: int, user_id: int):
    group = get_group_or_404(db, group_id)
    if group.created_by_id != user_id:
        raise HTTPException(status_code=403, detail="Only the group owner can perform this action")
    return group

# Exchange rates for currency conversion (fallback if API fails)
EXCHANGE_RATES = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 149.5,
    "CAD": 1.38
}

# Currency symbols for formatting
CURRENCY_SYMBOLS = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "JPY": "¥",
    "CAD": "CA$"
}

def format_currency(amount_cents: int, currency: str) -> str:
    """
    Format an amount in cents as a currency string with symbol.

    Args:
        amount_cents: Amount in cents (e.g., 1234 for $12.34)
        currency: Currency code (e.g., "USD", "EUR")

    Returns:
        Formatted string with symbol (e.g., "$12.34", "€12.34")
    """
    symbol = CURRENCY_SYMBOLS.get(currency, currency)
    amount = amount_cents / 100

    # For currencies like JPY that don't use decimal places
    if currency == "JPY":
        return f"{symbol}{amount:.0f}"

    # Handle negative amounts
    if amount < 0:
        return f"-{symbol}{abs(amount):.2f}"
    else:
        return f"{symbol}{amount:.2f}"

def fetch_historical_exchange_rate(date: str, from_currency: str, to_currency: str = "USD") -> Optional[float]:
    """
    Fetch historical exchange rate from Frankfurter API (free, no key required).
    Returns the rate to convert from from_currency to to_currency on the given date.

    Args:
        date: ISO format date string (YYYY-MM-DD)
        from_currency: Source currency code (e.g., "EUR")
        to_currency: Target currency code (default: "USD")

    Returns:
        Exchange rate as float, or None if fetch fails
    """
    # If converting to same currency, rate is 1.0
    if from_currency == to_currency:
        return 1.0

    try:
        # Frankfurter API endpoint for historical rates
        # https://www.frankfurter.app/docs/
        url = f"https://api.frankfurter.app/{date}"
        params = {
            "from": from_currency,
            "to": to_currency
        }

        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()

        data = response.json()

        # Check if the API returned successfully
        if "rates" in data and to_currency in data["rates"]:
            return float(data["rates"][to_currency])

        # If API fails, return None to use fallback
        return None

    except Exception as e:
        print(f"Error fetching exchange rate for {date} ({from_currency} to {to_currency}): {e}")
        return None

def get_exchange_rate_for_expense(date: str, currency: str) -> float:
    """
    Get exchange rate from currency to USD for a given date.
    First tries to fetch from API, falls back to static rates if API fails.

    Args:
        date: ISO format date string (YYYY-MM-DD)
        currency: Currency code (e.g., "EUR")

    Returns:
        Exchange rate from currency to USD
    """
    # If already USD, rate is 1.0
    if currency == "USD":
        return 1.0

    # Try to fetch historical rate from API
    rate = fetch_historical_exchange_rate(date, currency, "USD")

    # If API fails, use fallback static rates
    if rate is None:
        if currency in EXCHANGE_RATES:
            rate = EXCHANGE_RATES[currency]
            print(f"Using fallback rate for {currency}: {rate}")
        else:
            # Default to 1.0 if currency not found
            rate = 1.0
            print(f"Unknown currency {currency}, using rate 1.0")

    return rate

def convert_to_usd(amount: float, currency: str) -> float:
    if currency not in EXCHANGE_RATES:
        return amount
    return amount / EXCHANGE_RATES[currency]

def calculate_itemized_splits(items: list[schemas.ExpenseItemCreate]) -> list[schemas.ExpenseSplitBase]:
    """
    Calculate each person's share based on assigned items.

    Algorithm:
    1. Sum each person's assigned items (shared items split equally)
    2. Calculate subtotal for all non-tax/tip items
    3. Distribute tax/tip proportionally to each person's subtotal
    4. Return final splits
    """
    # Track each person's subtotal (key: "user_<id>" or "guest_<id>")
    person_subtotals = {}

    # Separate regular items from tax/tip
    regular_items = [i for i in items if not i.is_tax_tip]
    tax_tip_items = [i for i in items if i.is_tax_tip]

    # Process regular items
    for item in regular_items:
        if not item.assignments:
            continue

        # Equal split among assignees
        num_assignees = len(item.assignments)
        share_per_person = item.price // num_assignees
        remainder = item.price % num_assignees

        for idx, assignment in enumerate(item.assignments):
            key = f"{'guest' if assignment.is_guest else 'user'}_{assignment.user_id}"
            # First assignee gets the remainder cents
            amount = share_per_person + (1 if idx < remainder else 0)
            person_subtotals[key] = person_subtotals.get(key, 0) + amount

    # Calculate total of regular items for proportional distribution
    regular_total = sum(person_subtotals.values())
    tax_tip_total = sum(i.price for i in tax_tip_items)

    # Distribute tax/tip proportionally
    person_totals = {}
    remaining_tax_tip = tax_tip_total

    sorted_keys = sorted(person_subtotals.keys())
    for idx, key in enumerate(sorted_keys):
        subtotal = person_subtotals[key]
        person_totals[key] = subtotal

        if regular_total > 0 and tax_tip_total > 0:
            if idx == len(sorted_keys) - 1:
                # Last person gets remainder to avoid rounding errors
                tax_tip_share = remaining_tax_tip
            else:
                tax_tip_share = int((subtotal / regular_total) * tax_tip_total)
                remaining_tax_tip -= tax_tip_share

            person_totals[key] += tax_tip_share

    # Convert to ExpenseSplitBase list
    splits = []
    for key, amount in person_totals.items():
        is_guest = key.startswith("guest_")
        user_id = int(key.split("_")[1])
        splits.append(schemas.ExpenseSplitBase(
            user_id=user_id,
            is_guest=is_guest,
            amount_owed=amount
        ))

    return splits

def validate_expense_participants(
    db: Session,
    payer_id: int,
    payer_is_guest: bool,
    splits: list[schemas.ExpenseSplitBase],
    items: list[schemas.ExpenseItemCreate] | None = None
) -> None:
    """Validate that all participants (payer, split participants, item assignees) exist."""
    # Validate payer
    if payer_is_guest:
        payer = db.query(models.GuestMember).filter(models.GuestMember.id == payer_id).first()
        if not payer:
            raise HTTPException(status_code=400, detail=f"Guest payer with ID {payer_id} not found")
    else:
        payer = db.query(models.User).filter(models.User.id == payer_id).first()
        if not payer:
            raise HTTPException(status_code=400, detail=f"User payer with ID {payer_id} not found")
    
    # Validate split participants
    for split in splits:
        if split.is_guest:
            guest = db.query(models.GuestMember).filter(models.GuestMember.id == split.user_id).first()
            if not guest:
                raise HTTPException(status_code=400, detail=f"Guest with ID {split.user_id} not found in splits")
        else:
            user = db.query(models.User).filter(models.User.id == split.user_id).first()
            if not user:
                raise HTTPException(status_code=400, detail=f"User with ID {split.user_id} not found in splits")
    
    # Validate item assignments if provided
    if items:
        for item in items:
            if item.assignments:
                for assignment in item.assignments:
                    if assignment.is_guest:
                        guest = db.query(models.GuestMember).filter(models.GuestMember.id == assignment.user_id).first()
                        if not guest:
                            raise HTTPException(status_code=400, detail=f"Guest with ID {assignment.user_id} not found in item assignments")
                    else:
                        user = db.query(models.User).filter(models.User.id == assignment.user_id).first()
                        if not user:
                            raise HTTPException(status_code=400, detail=f"User with ID {assignment.user_id} not found in item assignments")


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = schemas.TokenData(email=email)
    except auth.JWTError:
        raise credentials_exception
    user = get_user_by_email(db, email=token_data.email)
    if user is None:
        raise credentials_exception
    return user

@app.post("/register", response_model=schemas.User)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_password, full_name=user.full_name)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/token")
def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_db)):
    user = get_user_by_email(db, form_data.username)
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    # Create refresh token
    refresh_token = auth.create_refresh_token()
    refresh_token_hash = auth.hash_token(refresh_token)
    
    # Store refresh token in database
    db_refresh_token = models.RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        expires_at=auth.get_refresh_token_expiry()
    )
    db.add(db_refresh_token)
    db.commit()
    
    return {
        "access_token": access_token, 
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }

class RefreshTokenRequest(BaseModel):
    refresh_token: str

@app.post("/auth/refresh")
def refresh_access_token(request: RefreshTokenRequest, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access token"""
    token_hash = auth.hash_token(request.refresh_token)
    
    # Find the refresh token in database
    db_token = db.query(models.RefreshToken).filter(
        models.RefreshToken.token_hash == token_hash,
        models.RefreshToken.revoked == False,
        models.RefreshToken.expires_at > datetime.utcnow()
    ).first()
    
    if not db_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )
    
    # Get user
    user = db.query(models.User).filter(models.User.id == db_token.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    
    # Create new access token
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer"
    }

@app.post("/auth/logout")
def logout(request: RefreshTokenRequest, db: Session = Depends(get_db)):
    """Revoke a refresh token (logout)"""
    token_hash = auth.hash_token(request.refresh_token)
    
    # Find and revoke the token
    db_token = db.query(models.RefreshToken).filter(
        models.RefreshToken.token_hash == token_hash
    ).first()
    
    if db_token:
        db_token.revoked = True
        db.commit()
    
    return {"message": "Logged out successfully"}

@app.get("/users/me", response_model=schemas.User)
async def read_users_me(current_user: Annotated[models.User, Depends(get_current_user)]):
    return current_user

@app.post("/groups", response_model=schemas.Group)
def create_group(group: schemas.GroupCreate, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    db_group = models.Group(name=group.name, created_by_id=current_user.id, default_currency=group.default_currency)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)

    # Add creator as member
    db_member = models.GroupMember(group_id=db_group.id, user_id=current_user.id)
    db.add(db_member)
    db.commit()

    return db_group

@app.get("/groups", response_model=list[schemas.Group])
def read_groups(current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    # Get groups where user is a member
    user_groups = db.query(models.Group).join(models.GroupMember, models.Group.id == models.GroupMember.group_id).filter(models.GroupMember.user_id == current_user.id).all()
    return user_groups

@app.get("/groups/{group_id}", response_model=schemas.GroupWithMembers)
def get_group(group_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    group = get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # Get members with user details
    members_query = db.query(models.GroupMember, models.User).join(
        models.User, models.GroupMember.user_id == models.User.id
    ).filter(models.GroupMember.group_id == group_id).all()

    members = [
        schemas.GroupMember(
            id=gm.id,
            user_id=user.id,
            full_name=user.full_name or user.email,
            email=user.email
        )
        for gm, user in members_query
    ]

    # Get unclaimed guests
    guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.claimed_by_id == None
    ).all()

    # Populate managed_by_name for each guest
    guests_with_manager_names = []
    for g in guests:
        managed_by_name = None
        if g.managed_by_id:
            if g.managed_by_type == 'user':
                manager = db.query(models.User).filter(models.User.id == g.managed_by_id).first()
                if manager:
                    managed_by_name = manager.full_name or manager.email
            elif g.managed_by_type == 'guest':
                manager_guest = db.query(models.GuestMember).filter(models.GuestMember.id == g.managed_by_id).first()
                if manager_guest:
                    managed_by_name = manager_guest.name

        guests_with_manager_names.append(schemas.GuestMember(
            id=g.id,
            group_id=g.group_id,
            name=g.name,
            created_by_id=g.created_by_id,
            claimed_by_id=g.claimed_by_id,
            managed_by_id=g.managed_by_id,
            managed_by_type=g.managed_by_type,
            managed_by_name=managed_by_name
        ))

    return schemas.GroupWithMembers(
        id=group.id,
        name=group.name,
        created_by_id=group.created_by_id,
        default_currency=group.default_currency,
        members=members,
        guests=guests_with_manager_names
    )

@app.put("/groups/{group_id}", response_model=schemas.Group)
def update_group(group_id: int, group_update: schemas.GroupUpdate, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    group = verify_group_ownership(db, group_id, current_user.id)
    group.name = group_update.name
    group.default_currency = group_update.default_currency
    db.commit()
    db.refresh(group)
    return group

@app.delete("/groups/{group_id}")
def delete_group(group_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    verify_group_ownership(db, group_id, current_user.id)

    # Set group_id to NULL on associated expenses (preserve history)
    db.query(models.Expense).filter(models.Expense.group_id == group_id).update({"group_id": None})

    # Delete group members
    db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id).delete()

    # Delete group
    db.query(models.Group).filter(models.Group.id == group_id).delete()
    db.commit()

    return {"message": "Group deleted successfully"}

@app.post("/groups/{group_id}/members", response_model=schemas.GroupMember)
def add_group_member(group_id: int, member_add: schemas.GroupMemberAdd, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # Find user by email
    user = get_user_by_email(db, member_add.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if already a member
    existing = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member of this group")

    # Add member
    new_member = models.GroupMember(group_id=group_id, user_id=user.id)
    db.add(new_member)
    db.commit()
    db.refresh(new_member)

    return schemas.GroupMember(
        id=new_member.id,
        user_id=user.id,
        full_name=user.full_name or user.email,
        email=user.email
    )

@app.delete("/groups/{group_id}/members/{user_id}")
def remove_group_member(group_id: int, user_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    group = get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # Owner can remove anyone except themselves
    # Non-owners can only remove themselves
    if current_user.id != group.created_by_id and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="You can only remove yourself from the group")

    if user_id == group.created_by_id:
        raise HTTPException(status_code=400, detail="Group owner cannot be removed. Delete the group instead.")

    member = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == user_id
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found in this group")

    # Auto-unlink any guests managed by this user
    db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.managed_by_id == user_id,
        models.GuestMember.managed_by_type == 'user'
    ).update({"managed_by_id": None, "managed_by_type": None})

    db.delete(member)
    db.commit()

    return {"message": "Member removed successfully"}

@app.post("/groups/{group_id}/guests", response_model=schemas.GuestMember)
def add_guest(group_id: int, guest: schemas.GuestMemberCreate, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    db_guest = models.GuestMember(
        group_id=group_id,
        name=guest.name,
        created_by_id=current_user.id
    )
    db.add(db_guest)
    db.commit()
    db.refresh(db_guest)
    return db_guest

@app.delete("/groups/{group_id}/guests/{guest_id}")
def remove_guest(group_id: int, guest_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    guest = db.query(models.GuestMember).filter(
        models.GuestMember.id == guest_id,
        models.GuestMember.group_id == group_id
    ).first()

    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found in this group")

    # Delete all expense splits involving this guest
    db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == guest_id,
        models.ExpenseSplit.is_guest == True
    ).delete()

    # Delete all expenses where this guest was the payer
    db.query(models.Expense).filter(
        models.Expense.payer_id == guest_id,
        models.Expense.payer_is_guest == True
    ).delete()

    # Now delete the guest
    db.delete(guest)
    db.commit()

    return {"message": "Guest removed successfully"}

@app.post("/groups/{group_id}/guests/{guest_id}/claim")
def claim_guest(group_id: int, guest_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    get_group_or_404(db, group_id)

    guest = db.query(models.GuestMember).filter(
        models.GuestMember.id == guest_id,
        models.GuestMember.group_id == group_id
    ).first()

    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    if guest.claimed_by_id:
        raise HTTPException(status_code=400, detail="Guest already claimed")

    # Transfer expenses where guest was payer
    expenses_updated = db.query(models.Expense).filter(
        models.Expense.payer_id == guest_id,
        models.Expense.payer_is_guest == True
    ).update({
        "payer_id": current_user.id,
        "payer_is_guest": False
    })

    # Transfer splits where guest was involved
    splits_updated = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == guest_id,
        models.ExpenseSplit.is_guest == True
    ).update({
        "user_id": current_user.id,
        "is_guest": False
    })

    # Mark guest as claimed
    guest.claimed_by_id = current_user.id

    # Add user to group if not already member
    existing_member = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == current_user.id
    ).first()

    if not existing_member:
        db.add(models.GroupMember(group_id=group_id, user_id=current_user.id))

    db.commit()

    return {
        "message": "Guest claimed successfully",
        "transferred_expenses": expenses_updated,
        "transferred_splits": splits_updated
    }

class ManageGuestRequest(BaseModel):
    user_id: int
    is_guest: bool = False  # Set to True if manager is a guest

@app.post("/groups/{group_id}/guests/{guest_id}/manage")
def manage_guest(
    group_id: int,
    guest_id: int,
    request: ManageGuestRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Link a guest to a manager (user or guest) for aggregated balance tracking"""
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # Get the guest
    guest = db.query(models.GuestMember).filter(
        models.GuestMember.id == guest_id,
        models.GuestMember.group_id == group_id
    ).first()

    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    # Cannot manage a claimed guest
    if guest.claimed_by_id:
        raise HTTPException(status_code=400, detail="Cannot manage a claimed guest")
    
    # Cannot manage yourself
    if request.is_guest and request.user_id == guest_id:
        raise HTTPException(status_code=400, detail="Guest cannot manage itself")

    # Verify manager exists and is in the group
    if request.is_guest:
        # Manager is a guest - verify it exists and is in this group
        manager_guest = db.query(models.GuestMember).filter(
            models.GuestMember.id == request.user_id,
            models.GuestMember.group_id == group_id,
            models.GuestMember.claimed_by_id == None  # Cannot use claimed guests as managers
        ).first()
        if not manager_guest:
            raise HTTPException(status_code=400, detail="Manager guest not found or already claimed")
        managed_by_name = manager_guest.name
    else:
        # Manager is a user - verify they are a group member
        manager_membership = db.query(models.GroupMember).filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.user_id == request.user_id
        ).first()
        if not manager_membership:
            raise HTTPException(status_code=400, detail="Manager must be a group member")
        manager = db.query(models.User).filter(models.User.id == request.user_id).first()
        managed_by_name = manager.full_name or manager.email if manager else None

    # Update guest's manager
    guest.managed_by_id = request.user_id
    guest.managed_by_type = 'guest' if request.is_guest else 'user'
    db.commit()
    db.refresh(guest)

    return {
        "message": "Guest manager updated successfully",
        "guest": schemas.GuestMember(
            id=guest.id,
            group_id=guest.group_id,
            name=guest.name,
            created_by_id=guest.created_by_id,
            claimed_by_id=guest.claimed_by_id,
            managed_by_id=guest.managed_by_id,
            managed_by_type=guest.managed_by_type,
            managed_by_name=managed_by_name
        )
    }

@app.delete("/groups/{group_id}/guests/{guest_id}/manage")
def unmanage_guest(
    group_id: int,
    guest_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Remove guest's manager link"""
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    guest = db.query(models.GuestMember).filter(
        models.GuestMember.id == guest_id,
        models.GuestMember.group_id == group_id
    ).first()

    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    # Remove manager link
    guest.managed_by_id = None
    guest.managed_by_type = None
    db.commit()

    return {"message": "Guest manager removed successfully"}


@app.get("/groups/{group_id}/expenses", response_model=list[schemas.ExpenseWithSplits])
def get_group_expenses(group_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    expenses = db.query(models.Expense).filter(models.Expense.group_id == group_id).order_by(models.Expense.date.desc()).all()

    # Include splits for each expense
    result = []
    for expense in expenses:
        splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()

        # Build splits with user names
        splits_with_names = []
        for split in splits:
            if split.is_guest:
                guest = db.query(models.GuestMember).filter(models.GuestMember.id == split.user_id).first()
                user_name = guest.name if guest else "Unknown Guest"
            else:
                user = db.query(models.User).filter(models.User.id == split.user_id).first()
                user_name = (user.full_name or user.email) if user else "Unknown User"

            splits_with_names.append(schemas.ExpenseSplitDetail(
                id=split.id,
                expense_id=split.expense_id,
                user_id=split.user_id,
                is_guest=split.is_guest,
                amount_owed=split.amount_owed,
                percentage=split.percentage,
                shares=split.shares,
                user_name=user_name
            ))

        expense_dict = {
            "id": expense.id,
            "description": expense.description,
            "amount": expense.amount,
            "currency": expense.currency,
            "date": expense.date,
            "payer_id": expense.payer_id,
            "payer_is_guest": expense.payer_is_guest,
            "group_id": expense.group_id,
            "created_by_id": expense.created_by_id,
            "split_type": expense.split_type,
            "splits": splits_with_names,
            "items": [],
            "icon": expense.icon
        }
        result.append(expense_dict)

    return result

@app.get("/groups/{group_id}/balances", response_model=list[schemas.GroupBalance])
def get_group_balances(group_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # Get all expenses in group
    expenses = db.query(models.Expense).filter(models.Expense.group_id == group_id).all()

    # Calculate net balances per participant (keyed by (id, is_guest) tuple)
    net_balances = {}  # (user_id, is_guest) -> {currency -> amount}

    for expense in expenses:
        splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()

        for split in splits:
            key = (split.user_id, split.is_guest)
            if key not in net_balances:
                net_balances[key] = {}
            if expense.currency not in net_balances[key]:
                net_balances[key][expense.currency] = 0

            # Debtor decreases balance
            net_balances[key][expense.currency] -= split.amount_owed

            # Creditor (payer) increases balance
            payer_key = (expense.payer_id, expense.payer_is_guest)
            if payer_key not in net_balances:
                net_balances[payer_key] = {}
            if expense.currency not in net_balances[payer_key]:
                net_balances[payer_key][expense.currency] = 0
            net_balances[payer_key][expense.currency] += split.amount_owed

    # Get all managed guests in this group
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.managed_by_id != None
    ).all()

    # Track which guests were aggregated with which managers (for breakdown display)
    # Key: (manager_id, is_guest, currency) -> [(guest_name, amount)]
    manager_guest_breakdown = {}

    # Aggregate managed guest balances with their managers
    for guest in managed_guests:
        guest_key = (guest.id, True)  # (id, is_guest)
        manager_is_guest = (guest.managed_by_type == 'guest')
        manager_key = (guest.managed_by_id, manager_is_guest)

        if guest_key in net_balances:
            # Transfer guest's balance to manager
            guest_currencies = net_balances[guest_key]
            for currency, amount in guest_currencies.items():
                # Ensure manager has entry for this currency
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                if currency not in net_balances[manager_key]:
                    net_balances[manager_key][currency] = 0

                # Add guest's balance to manager's balance
                net_balances[manager_key][currency] += amount

                # Track for breakdown
                breakdown_key = (guest.managed_by_id, manager_is_guest, currency)
                if breakdown_key not in manager_guest_breakdown:
                    manager_guest_breakdown[breakdown_key] = []
                manager_guest_breakdown[breakdown_key].append((guest.name, amount))

            # Remove guest from balance output (aggregated into manager)
            del net_balances[guest_key]

    # Build response with participant details
    result = []
    for (participant_id, is_guest), currencies in net_balances.items():
        if is_guest:
            guest = db.query(models.GuestMember).filter(models.GuestMember.id == participant_id).first()
            name = guest.name if guest else "Unknown Guest"
        else:
            user = db.query(models.User).filter(models.User.id == participant_id).first()
            name = (user.full_name or user.email) if user else "Unknown User"

        for currency, amount in currencies.items():
            if amount != 0:
                # Get managed guests breakdown for this balance
                managed_guests_list = []
                # Check for managed guests breakdown (works for both users and guests as managers)
                breakdown_key = (participant_id, is_guest, currency)
                if breakdown_key in manager_guest_breakdown:
                    managed_guests_list = [
                        f"{guest_name} ({format_currency(amount, currency)})"
                        for guest_name, amount in manager_guest_breakdown[breakdown_key]
                    ]

                result.append(schemas.GroupBalance(
                    user_id=participant_id,
                    is_guest=is_guest,
                    full_name=name,
                    amount=amount,
                    currency=currency,
                    managed_guests=managed_guests_list
                ))

    return result

@app.post("/friends", response_model=schemas.Friend)
def add_friend(friend_request: schemas.FriendRequest, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    friend_user = get_user_by_email(db, friend_request.email)
    if not friend_user:
        raise HTTPException(status_code=404, detail="User not found")

    if friend_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself as friend")

    # Check if already friends
    existing = db.query(models.Friendship).filter(
        ((models.Friendship.user_id1 == current_user.id) & (models.Friendship.user_id2 == friend_user.id)) |
        ((models.Friendship.user_id1 == friend_user.id) & (models.Friendship.user_id2 == current_user.id))
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Already friends")

    new_friendship = models.Friendship(user_id1=current_user.id, user_id2=friend_user.id)
    db.add(new_friendship)
    db.commit()

    return friend_user

@app.get("/friends", response_model=list[schemas.Friend])
def read_friends(current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    # Find all friendships involving current_user
    friendships = db.query(models.Friendship).filter(
        (models.Friendship.user_id1 == current_user.id) | (models.Friendship.user_id2 == current_user.id)
    ).all()

    friends = []
    for f in friendships:
        friend_id = f.user_id2 if f.user_id1 == current_user.id else f.user_id1
        friend = db.query(models.User).filter(models.User.id == friend_id).first()
        if friend:
            friends.append(friend)

    return friends

@app.post("/expenses", response_model=schemas.Expense)
def create_expense(expense: schemas.ExpenseCreate, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    # Handle ITEMIZED split type
    if expense.split_type == "ITEMIZED":
        if not expense.items:
            raise HTTPException(status_code=400, detail="Items required for ITEMIZED split type")

        # Validate all non-tax items have at least one assignment
        for item in expense.items:
            if not item.is_tax_tip and not item.assignments:
                raise HTTPException(status_code=400, detail=f"Item '{item.description}' must have at least one assignee")

        # Calculate splits from items
        expense.splits = calculate_itemized_splits(expense.items)

        # Recalculate total from items
        expense.amount = sum(item.price for item in expense.items)

    # Validate total amount vs splits
    total_split = sum(split.amount_owed for split in expense.splits)
    if total_split != expense.amount:
        # Allow small rounding error? For now be strict or exact logic should be handled by client
        # But if type is EQUAL, client sends pre-calculated?
        # Requirement said "app should handle different types of splits".
        # Let's assume the client sends the breakdown for simplicity,
        # but we verify the sum.
        if abs(total_split - expense.amount) > 1: # Allow 1 cent diff
             raise HTTPException(status_code=400, detail=f"Split amounts do not sum to total expense amount. Total: {expense.amount}, Sum: {total_split}")

    # Validate all participants exist
    validate_expense_participants(
        db=db,
        payer_id=expense.payer_id,
        payer_is_guest=expense.payer_is_guest,
        splits=expense.splits,
        items=expense.items if expense.split_type == "ITEMIZED" else None
    )

    # Fetch and cache the historical exchange rate for this expense
    exchange_rate = get_exchange_rate_for_expense(expense.date, expense.currency)

    db_expense = models.Expense(
        description=expense.description,
        amount=expense.amount,
        currency=expense.currency,
        date=expense.date,
        payer_id=expense.payer_id,
        payer_is_guest=expense.payer_is_guest,
        group_id=expense.group_id,
        created_by_id=current_user.id,
        exchange_rate=str(exchange_rate),  # Store as string for SQLite compatibility
        split_type=expense.split_type or "EQUAL",
        icon=expense.icon
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)

    for split in expense.splits:
        db_split = models.ExpenseSplit(
            expense_id=db_expense.id,
            user_id=split.user_id,
            is_guest=split.is_guest,
            amount_owed=split.amount_owed,
            percentage=split.percentage,
            shares=split.shares
        )
        db.add(db_split)

    # Store items if ITEMIZED
    if expense.split_type == "ITEMIZED" and expense.items:
        for item in expense.items:
            db_item = models.ExpenseItem(
                expense_id=db_expense.id,
                description=item.description,
                price=item.price,
                is_tax_tip=item.is_tax_tip
            )
            db.add(db_item)
            db.commit()
            db.refresh(db_item)

            # Store assignments
            for assignment in item.assignments:
                db_assignment = models.ExpenseItemAssignment(
                    expense_item_id=db_item.id,
                    user_id=assignment.user_id,
                    is_guest=assignment.is_guest
                )
                db.add(db_assignment)

    db.commit()
    return db_expense

@app.get("/expenses", response_model=list[schemas.Expense])
def read_expenses(current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    # Return expenses where user is involved (payer or splitter)
    # This query is a bit complex in pure SQLAlch.
    # Expenses where payer_id == user OR id in (select expense_id from splits where user_id == user)

    subquery = db.query(models.ExpenseSplit.expense_id).filter(models.ExpenseSplit.user_id == current_user.id).subquery()

    expenses = db.query(models.Expense).filter(
        (models.Expense.payer_id == current_user.id) |
        (models.Expense.id.in_(subquery))
    ).all()

    return expenses

@app.get("/expenses/{expense_id}", response_model=schemas.ExpenseWithSplits)
def get_expense(expense_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Verify user has access (is payer, in splits, or in the same group)
    splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense_id).all()
    split_user_ids = [s.user_id for s in splits if not s.is_guest]

    has_access = (
        (expense.payer_id == current_user.id and not expense.payer_is_guest) or
        current_user.id in split_user_ids or
        (expense.group_id and db.query(models.GroupMember).filter(
            models.GroupMember.group_id == expense.group_id,
            models.GroupMember.user_id == current_user.id
        ).first())
    )

    if not has_access:
        raise HTTPException(status_code=403, detail="You don't have access to this expense")

    # Build splits with user names
    splits_with_names = []
    for split in splits:
        if split.is_guest:
            guest = db.query(models.GuestMember).filter(models.GuestMember.id == split.user_id).first()
            user_name = guest.name if guest else "Unknown Guest"
        else:
            user = db.query(models.User).filter(models.User.id == split.user_id).first()
            user_name = (user.full_name or user.email) if user else "Unknown User"

        splits_with_names.append(schemas.ExpenseSplitDetail(
            id=split.id,
            expense_id=split.expense_id,
            user_id=split.user_id,
            is_guest=split.is_guest,
            amount_owed=split.amount_owed,
            percentage=split.percentage,
            shares=split.shares,
            user_name=user_name
        ))

    # Use the stored split_type from the expense
    split_type = expense.split_type or "EQUAL"

    # Load items for ITEMIZED expenses
    items_data = []
    if split_type == "ITEMIZED":
        expense_items = db.query(models.ExpenseItem).filter(
            models.ExpenseItem.expense_id == expense_id
        ).all()

        for item in expense_items:
            assignments = db.query(models.ExpenseItemAssignment).filter(
                models.ExpenseItemAssignment.expense_item_id == item.id
            ).all()

            assignment_details = []
            for a in assignments:
                if a.is_guest:
                    guest = db.query(models.GuestMember).filter(
                        models.GuestMember.id == a.user_id
                    ).first()
                    name = guest.name if guest else "Unknown Guest"
                else:
                    user = db.query(models.User).filter(
                        models.User.id == a.user_id
                    ).first()
                    name = (user.full_name or user.email) if user else "Unknown"

                assignment_details.append(schemas.ExpenseItemAssignmentDetail(
                    user_id=a.user_id,
                    is_guest=a.is_guest,
                    user_name=name
                ))

            items_data.append(schemas.ExpenseItemDetail(
                id=item.id,
                expense_id=item.expense_id,
                description=item.description,
                price=item.price,
                is_tax_tip=item.is_tax_tip,
                assignments=assignment_details
            ))

    return schemas.ExpenseWithSplits(
        id=expense.id,
        description=expense.description,
        amount=expense.amount,
        currency=expense.currency,
        date=expense.date,
        payer_id=expense.payer_id,
        payer_is_guest=expense.payer_is_guest,
        group_id=expense.group_id,
        created_by_id=expense.created_by_id,
        splits=splits_with_names,
        split_type=split_type,
        items=items_data,
        icon=expense.icon
    )

@app.put("/expenses/{expense_id}", response_model=schemas.Expense)
def update_expense(expense_id: int, expense_update: schemas.ExpenseUpdate, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Only the creator can edit the expense
    if expense.created_by_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the expense creator can edit this expense")

    # Handle ITEMIZED split type
    if expense_update.split_type == "ITEMIZED":
        if not expense_update.items:
            raise HTTPException(status_code=400, detail="Items required for ITEMIZED split type")

        # Validate all non-tax items have at least one assignment
        for item in expense_update.items:
            if not item.is_tax_tip and not item.assignments:
                raise HTTPException(status_code=400, detail=f"Item '{item.description}' must have at least one assignee")

        # Calculate splits from items
        expense_update.splits = calculate_itemized_splits(expense_update.items)

        # Recalculate total from items
        expense_update.amount = sum(item.price for item in expense_update.items)

    # Validate total amount vs splits
    total_split = sum(split.amount_owed for split in expense_update.splits)
    if abs(total_split - expense_update.amount) > 1:
        raise HTTPException(status_code=400, detail=f"Split amounts do not sum to total expense amount. Total: {expense_update.amount}, Sum: {total_split}")

    # Validate all participants exist
    validate_expense_participants(
        db=db,
        payer_id=expense_update.payer_id,
        payer_is_guest=expense_update.payer_is_guest,
        splits=expense_update.splits,
        items=expense_update.items if expense_update.split_type == "ITEMIZED" else None
    )

    # Update expense fields
    expense.description = expense_update.description
    expense.amount = expense_update.amount
    expense.currency = expense_update.currency
    expense.date = expense_update.date
    expense.payer_id = expense_update.payer_id
    expense.payer_is_guest = expense_update.payer_is_guest
    expense.split_type = expense_update.split_type or "EQUAL"
    expense.icon = expense_update.icon

    # Delete old items and assignments first
    old_items = db.query(models.ExpenseItem).filter(
        models.ExpenseItem.expense_id == expense_id
    ).all()
    for old_item in old_items:
        db.query(models.ExpenseItemAssignment).filter(
            models.ExpenseItemAssignment.expense_item_id == old_item.id
        ).delete()
    db.query(models.ExpenseItem).filter(
        models.ExpenseItem.expense_id == expense_id
    ).delete()

    # Delete old splits
    db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense_id).delete()

    # Create new splits
    for split in expense_update.splits:
        db_split = models.ExpenseSplit(
            expense_id=expense_id,
            user_id=split.user_id,
            is_guest=split.is_guest,
            amount_owed=split.amount_owed,
            percentage=split.percentage,
            shares=split.shares
        )
        db.add(db_split)

    # Create new items if ITEMIZED
    if expense_update.split_type == "ITEMIZED" and expense_update.items:
        for item in expense_update.items:
            db_item = models.ExpenseItem(
                expense_id=expense_id,
                description=item.description,
                price=item.price,
                is_tax_tip=item.is_tax_tip
            )
            db.add(db_item)
            db.commit()
            db.refresh(db_item)

            # Store assignments
            for assignment in item.assignments:
                db_assignment = models.ExpenseItemAssignment(
                    expense_item_id=db_item.id,
                    user_id=assignment.user_id,
                    is_guest=assignment.is_guest
                )
                db.add(db_assignment)

    db.commit()
    db.refresh(expense)
    return expense

@app.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Only the creator can delete the expense
    if expense.created_by_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the expense creator can delete this expense")

    # Delete item assignments first
    items = db.query(models.ExpenseItem).filter(
        models.ExpenseItem.expense_id == expense_id
    ).all()
    for item in items:
        db.query(models.ExpenseItemAssignment).filter(
            models.ExpenseItemAssignment.expense_item_id == item.id
        ).delete()

    # Delete items
    db.query(models.ExpenseItem).filter(
        models.ExpenseItem.expense_id == expense_id
    ).delete()

    # Delete associated splits
    db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense_id).delete()

    # Delete the expense
    db.delete(expense)
    db.commit()

    return {"message": "Expense deleted successfully"}

class Balance(BaseModel):
    user_id: int
    full_name: str
    amount: float # Positive means you are owed, negative means you owe
    currency: str
    is_guest: bool = False
    group_name: Optional[str] = None
    group_id: Optional[int] = None

@app.get("/balances", response_model=dict[str, list[Balance]])
def get_balances(current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    # Calculate balances for current user
    # Strategy: 
    # - For expenses WITH group_id: consolidate by (group_id, currency)
    # - For expenses WITHOUT group_id (1-to-1 IOUs): track by (user_id, currency)
    
    # 1. Money user paid (only non-guest expenses where I'm the payer)
    paid_expenses = db.query(models.Expense).filter(
        models.Expense.payer_id == current_user.id,
        models.Expense.payer_is_guest == False
    ).all()

    # 2. Money user owes (only non-guest splits where I'm a participant)
    my_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == current_user.id,
        models.ExpenseSplit.is_guest == False
    ).all()

    # Individual user balances (for 1-to-1 IOUs): (user_id, currency) -> amount
    user_balances = {}
    
    # Group balances (for group expenses): (group_id, currency) -> amount
    group_balances = {}

    # Analyze expenses I paid
    for expense in paid_expenses:
        splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()
        for split in splits:
            if split.user_id == current_user.id and not split.is_guest:
                continue # I don't owe myself

            # Someone else owes me 'split.amount_owed'
            if expense.group_id:
                # Group expense: consolidate by group
                key = (expense.group_id, expense.currency)
                group_balances[key] = group_balances.get(key, 0) + split.amount_owed
            else:
                # 1-to-1 IOU: track individually
                if split.is_guest:
                    # Shouldn't happen for non-group expenses, but handle it
                    guest = db.query(models.GuestMember).filter(models.GuestMember.id == split.user_id).first()
                    if guest:
                        key = (guest.group_id, expense.currency)
                        group_balances[key] = group_balances.get(key, 0) + split.amount_owed
                else:
                    key = (split.user_id, expense.currency)
                    user_balances[key] = user_balances.get(key, 0) + split.amount_owed

    # Analyze expenses I owe (someone else paid)
    for split in my_splits:
        expense = db.query(models.Expense).filter(models.Expense.id == split.expense_id).first()
        if not expense:
            continue
            
        if expense.payer_id == current_user.id and not expense.payer_is_guest:
            continue # I paid, handled above

        # I owe the payer 'split.amount_owed'
        if expense.group_id:
            # Group expense: consolidate by group
            key = (expense.group_id, expense.currency)
            group_balances[key] = group_balances.get(key, 0) - split.amount_owed
        else:
            # 1-to-1 IOU: track individually
            if expense.payer_is_guest:
                # Shouldn't happen for non-group expenses, but handle it
                guest = db.query(models.GuestMember).filter(models.GuestMember.id == expense.payer_id).first()
                if guest:
                    key = (guest.group_id, expense.currency)
                    group_balances[key] = group_balances.get(key, 0) - split.amount_owed
            else:
                key = (expense.payer_id, expense.currency)
                user_balances[key] = user_balances.get(key, 0) - split.amount_owed

    result = {"balances": []}

    # Add individual user balances (1-to-1 IOUs only)
    for (uid, currency), amount in user_balances.items():
        if amount != 0:
            user = db.query(models.User).filter(models.User.id == uid).first()
            full_name = user.full_name if user else f"User {uid}"
            result["balances"].append(Balance(
                user_id=uid, 
                full_name=full_name, 
                amount=amount, 
                currency=currency,
                is_guest=False
            ))

    # Add consolidated group balances (all group expenses)
    for (group_id, currency), amount in group_balances.items():
        if amount != 0:
            group = db.query(models.Group).filter(models.Group.id == group_id).first()
            group_name = group.name if group else f"Group {group_id}"
            result["balances"].append(Balance(
                user_id=0,  # Placeholder, not used for groups
                full_name=group_name,  # Display group name
                amount=amount,
                currency=currency,
                is_guest=True,  # Using this flag to indicate it's a group balance
                group_name=group_name,
                group_id=group_id
            ))

    return result

@app.get("/exchange_rates")
def get_exchange_rates():
    """
    Get current exchange rates from Frankfurter API (free, no key required).
    Falls back to static rates if API is unavailable.
    All rates are relative to USD (base currency).
    """
    try:
        # Fetch latest rates from Frankfurter API with USD as base
        url = "https://api.frankfurter.app/latest"
        params = {
            "from": "USD",
            "to": "EUR,GBP,JPY,CAD"
        }

        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()

        data = response.json()

        if "rates" in data:
            # Add USD explicitly since it's the base
            rates = {"USD": 1.0}
            rates.update(data["rates"])
            return rates

        # If API response is invalid, use fallback
        print("API response invalid, using fallback rates")
        return EXCHANGE_RATES

    except Exception as e:
        print(f"Error fetching exchange rates: {e}")
        # Return static fallback rates
        return EXCHANGE_RATES

# Graph simplification algorithm
@app.get("/simplify_debts/{group_id}")
def simplify_debts(group_id: int, current_user: Annotated[models.User, Depends(get_current_user)], db: Session = Depends(get_db)):
    # Get all expenses in group
    expenses = db.query(models.Expense).filter(models.Expense.group_id == group_id).all()

    # Calculate net balances per participant in USD (Cross-Currency)
    # Key is (id, is_guest) tuple
    net_balances_usd = {}

    for expense in expenses:
        splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()

        for split in splits:
            amount_usd = convert_to_usd(split.amount_owed, expense.currency)

            # Debtor decreases balance
            debtor_key = (split.user_id, split.is_guest)
            net_balances_usd[debtor_key] = net_balances_usd.get(debtor_key, 0) - amount_usd
            # Creditor (Payer) increases balance
            payer_key = (expense.payer_id, expense.payer_is_guest)
            net_balances_usd[payer_key] = net_balances_usd.get(payer_key, 0) + amount_usd

    # Simplify in USD
    transactions = []
    debtors = []
    creditors = []

    for (uid, is_guest), amount in net_balances_usd.items():
        if amount < -0.01: # Use epsilon
            debtors.append({'id': uid, 'is_guest': is_guest, 'amount': amount})
        elif amount > 0.01:
            creditors.append({'id': uid, 'is_guest': is_guest, 'amount': amount})

    debtors.sort(key=lambda x: x['amount'])
    creditors.sort(key=lambda x: x['amount'], reverse=True)

    i = 0
    j = 0

    while i < len(debtors) and j < len(creditors):
        debtor = debtors[i]
        creditor = creditors[j]

        amount = min(abs(debtor['amount']), creditor['amount'])

        transactions.append({
            "from_id": debtor['id'],
            "from_is_guest": debtor['is_guest'],
            "to_id": creditor['id'],
            "to_is_guest": creditor['is_guest'],
            "amount": amount,
            "currency": "USD" # Simplified debts are expressed in USD
        })

        debtor['amount'] += amount
        creditor['amount'] -= amount

        if abs(debtor['amount']) < 0.01:
            i += 1
        if creditor['amount'] < 0.01:
            j += 1

    return {"transactions": transactions}


@app.post("/ocr/scan-receipt")
async def scan_receipt(
    file: UploadFile = File(...),
    current_user: Annotated[models.User, Depends(get_current_user)] = None
):
    """
    OCR endpoint for receipt scanning using Google Cloud Vision.
    Accepts image upload, returns extracted items with prices.

    Args:
        file: Uploaded image file (JPEG, PNG, WebP)
        current_user: Authenticated user (from JWT token)

    Returns:
        JSON with items, total, and raw OCR text
    """
    # Validate file type
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and WebP images are supported."
        )

    try:
        # Read image file
        image_content = await file.read()
        
        # TODO: Add OCR processing logic here
        # For now, return empty response
        items = []
        raw_text = ""
        
        # Calculate total
        total = sum(item['price'] for item in items)

        return {
            "items": items,
            "total": total,
            "raw_text": raw_text
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"OCR processing error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"OCR processing failed: {str(e)}"
        )
