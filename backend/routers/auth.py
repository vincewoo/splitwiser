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


@router.post("/register", response_model=schemas.User)
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
