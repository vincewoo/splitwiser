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
from utils.rate_limiter import auth_rate_limiter


router = APIRouter(tags=["auth"])


@router.post("/register", response_model=schemas.Token, dependencies=[Depends(auth_rate_limiter)])
def register_user(
    user: schemas.UserCreate, 
    db: Session = Depends(get_db)
):
    # Check for existing user
    db_user = get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    try:
        # Create user - use flush() to get ID without committing
        hashed_password = auth.get_password_hash(user.password)
        db_user = models.User(email=user.email, hashed_password=hashed_password, full_name=user.full_name)
        db.add(db_user)
        db.flush()  # Gets the user ID without committing transaction

        claimed_group_id = None

        # Handle Guest Claiming
        if user.claim_guest_id and user.share_link_id:
            # Validate guest and group access
            guest = db.query(models.GuestMember).filter(models.GuestMember.id == user.claim_guest_id).first()
            if not guest:
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
                    guest.claimed_by_id = db_user.id
                    
                    # Add user to group members if not already
                    member = db.query(models.GroupMember).filter(
                        models.GroupMember.group_id == group.id,
                        models.GroupMember.user_id == db_user.id
                    ).first()
                    if not member:
                        db_member = models.GroupMember(group_id=group.id, user_id=db_user.id)

                        # Transfer the guest's managed_by relationship to the new member
                        if guest.managed_by_id and guest.managed_by_type == 'guest':
                            # Check if the manager guest was also claimed
                            manager_guest = db.query(models.GuestMember).filter(
                                models.GuestMember.id == guest.managed_by_id
                            ).first()
                            if manager_guest and manager_guest.claimed_by_id:
                                # Manager guest was claimed, update to point to the user who claimed it
                                db_member.managed_by_id = manager_guest.claimed_by_id
                                db_member.managed_by_type = 'user'
                            else:
                                # Manager guest not claimed yet, keep the guest reference
                                db_member.managed_by_id = guest.managed_by_id
                                db_member.managed_by_type = 'guest'
                        elif guest.managed_by_id and guest.managed_by_type == 'user':
                            # Already managed by a user, preserve that relationship
                            db_member.managed_by_id = guest.managed_by_id
                            db_member.managed_by_type = 'user'

                        db.add(db_member)
                        claimed_group_id = group.id

                    # Update past expenses/splits to point to the user instead of guest
                    db.query(models.ExpenseSplit).filter(
                        models.ExpenseSplit.user_id == guest.id,
                        models.ExpenseSplit.is_guest == True
                    ).update({
                        "user_id": db_user.id,
                        "is_guest": False
                    })

                    db.query(models.ExpenseItemAssignment).filter(
                        models.ExpenseItemAssignment.user_id == guest.id,
                        models.ExpenseItemAssignment.is_guest == True
                    ).update({
                        "user_id": db_user.id,
                        "is_guest": False
                    })

                    db.query(models.Expense).filter(
                        models.Expense.payer_id == guest.id,
                        models.Expense.payer_is_guest == True
                    ).update({
                        "payer_id": db_user.id,
                        "payer_is_guest": False
                    })

                    # Update managed guests to be managed by the new user
                    managed_guests = db.query(models.GuestMember).filter(
                        models.GuestMember.managed_by_id == guest.id,
                        models.GuestMember.managed_by_type == 'guest'
                    ).all()
                    
                    for mg in managed_guests:
                        mg.managed_by_id = db_user.id
                        mg.managed_by_type = 'user'

                    # Clear the guest's managed_by fields to prevent double-counting in balance calculations
                    # The management relationship has been transferred to the GroupMember above
                    guest.managed_by_id = None
                    guest.managed_by_type = None

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
        
        # Single commit at the end - atomic transaction
        db.commit()

        response_data = {
            "access_token": access_token, 
            "refresh_token": refresh_token,
            "token_type": "bearer"
        }

        if claimed_group_id:
            response_data["claimed_group_id"] = claimed_group_id

        return response_data
        
    except Exception as e:
        db.rollback()
        print(f"Registration failed, rolling back: {e}")
        raise HTTPException(status_code=500, detail="Registration failed. Please try again.")


@router.post("/token", dependencies=[Depends(auth_rate_limiter)])
def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_db)):
    user = get_user_by_email(db, form_data.username)
    # Check if user exists and has a password (OAuth-only users cannot use password login)
    if not user or not user.hashed_password or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()

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


@router.post("/auth/refresh", dependencies=[Depends(auth_rate_limiter)])
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


@router.post("/auth/logout", dependencies=[Depends(auth_rate_limiter)])
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


@router.post("/auth/set-password", dependencies=[Depends(auth_rate_limiter)])
def set_password(
    request: schemas.SetPasswordRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Set password for OAuth-only users.
    Allows them to use email/password login in addition to OAuth.
    """
    if current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password already set. Use change-password endpoint."
        )

    current_user.hashed_password = auth.get_password_hash(request.new_password)
    current_user.password_changed_at = datetime.utcnow()
    current_user.auth_provider = "both"
    db.commit()

    return {"message": "Password set successfully"}
