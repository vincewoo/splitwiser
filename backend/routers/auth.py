"""Authentication router: login, register, refresh token, logout."""

from typing import Annotated
from datetime import timedelta, datetime
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

import models
import schemas
import auth
from database import get_db
from dependencies import get_current_user
from utils.validation import get_user_by_email


router = APIRouter(tags=["auth"])


@router.post("/register", response_model=schemas.Token)
def register_user(
    user: schemas.UserCreate, 
    db: Session = Depends(get_db)
):
    # Check for existing user
    db_user = get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_password, full_name=user.full_name)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    # Handle Guest Claiming
    if user.claim_guest_id and user.share_link_id:
        # Validate guest and group access
        guest = db.query(models.GuestMember).filter(models.GuestMember.id == user.claim_guest_id).first()
        if not guest:
            # We don't fail registration, but we log/ignore the claim failure
            print(f"Failed to claim guest {user.claim_guest_id}: Guest not found")
        else:
            # Check if group matches share link
            group = db.query(models.Group).filter(
                models.Group.id == guest.group_id,
                models.Group.share_link_id == user.share_link_id,
                models.Group.is_public == True
            ).first()

            if not group:
                print(f"Failed to claim guest {user.claim_guest_id}: Invalid share link or group not public")
            elif guest.claimed_by_id:
                print(f"Failed to claim guest {user.claim_guest_id}: Already claimed")
            else:
                # Proceed with claiming
                # 1. Update guest record
                guest.claimed_by_id = db_user.id
                
                # 2. Add user to group members if not already
                member = db.query(models.GroupMember).filter(
                    models.GroupMember.group_id == group.id,
                    models.GroupMember.user_id == db_user.id
                ).first()
                if not member:
                    db_member = models.GroupMember(group_id=group.id, user_id=db_user.id)
                    db.add(db_member)

                # 3. Update past expenses/splits to point to the user instead of guest
                # Note: We keep the records as "is_guest=True" but usually we want to migrate them?
                # Actually, standard splitwise logic: you effectively become that person.
                # Steps:
                # - Find all splits where user_id=guest.id AND is_guest=True
                # - Update them to user_id=db_user.id AND is_guest=False
                
                db.query(models.ExpenseSplit).filter(
                    models.ExpenseSplit.user_id == guest.id,
                    models.ExpenseSplit.is_guest == True
                ).update({
                    "user_id": db_user.id,
                    "is_guest": False
                })

                # - Find all ExpenseItemAssignments
                db.query(models.ExpenseItemAssignment).filter(
                    models.ExpenseItemAssignment.user_id == guest.id,
                    models.ExpenseItemAssignment.is_guest == True
                ).update({
                    "user_id": db_user.id,
                    "is_guest": False
                })

                # - Find all expenses paid by guest
                db.query(models.Expense).filter(
                    models.Expense.payer_id == guest.id,
                    models.Expense.payer_is_guest == True
                ).update({
                    "payer_id": db_user.id,
                    "payer_is_guest": False
                })

                # - Delete the guest member record? Or keep it as claimed?
                # The model has 'claimed_by_id', implying we keep it. 
                # But if we migrated all data, the guest record is just a shell now.
                # However, there might be 'managed_by' references to it?
                # If this guest was managing others, we should update those managed guests to be managed by the new user.
                
                db.query(models.GuestMember).filter(
                    models.GuestMember.managed_by_id == guest.id,
                    models.GuestMember.managed_by_type == 'guest'
                ).update({
                    "managed_by_id": db_user.id,
                    "managed_by_type": 'user'
                })

                # Finally, we can delete the guest record since all references are moved.
                # But 'claimed_by_id' suggests soft delete or linking. 
                # Given I migrated all data, I should probably delete it to avoid duplicate "Member" and "Guest" appearing in list if I didn't migrate properly.
                # However, existing logic might rely on it. 
                # Let's Delete it to be clean, as the user is now a full member.
                db.delete(guest)
                
                db.commit()
                print(f"Successfully claimed guest {user.claim_guest_id} for user {db_user.id}")

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
        user_id=db_user.id,
        token_hash=refresh_token_hash,
        expires_at=auth.get_refresh_token_expiry()
    )
    db.add(db_refresh_token)
    db.commit()

    response_data = {
        "access_token": access_token, 
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }

    if user.claim_guest_id and user.share_link_id:
        # Check if user is now a member of the group associated with the share link
        # We can find the group by share_link_id first
        group = db.query(models.Group).filter(
            models.Group.share_link_id == user.share_link_id,
            models.Group.is_public == True
        ).first()

        if group:
            # Check if user is a member
            member = db.query(models.GroupMember).filter(
                models.GroupMember.group_id == group.id,
                models.GroupMember.user_id == db_user.id
            ).first()
            
            if member:
                response_data["claimed_group_id"] = group.id

    return response_data


@router.post("/token")
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


@router.post("/auth/refresh")
def refresh_access_token(request: schemas.RefreshTokenRequest, db: Session = Depends(get_db)):
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


@router.post("/auth/logout")
def logout(request: schemas.RefreshTokenRequest, db: Session = Depends(get_db)):
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


@router.get("/users/me", response_model=schemas.User)
async def read_users_me(current_user: Annotated[models.User, Depends(get_current_user)]):
    return current_user
