"""Profile management router: get profile, update profile, change password, verify email."""

from typing import Annotated
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
import auth
from database import get_db
from dependencies import get_current_user
from utils.rate_limiter import profile_update_rate_limiter, email_verification_rate_limiter
from utils.email import (
    send_email_verification_email,
    send_email_change_notification,
    send_password_changed_notification,
    is_email_configured
)


router = APIRouter(tags=["profile"])


@router.get("/users/me/profile", response_model=schemas.UserProfile)
async def get_profile(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Get current user's profile with security metadata."""
    return current_user


@router.put("/users/me/profile", dependencies=[Depends(profile_update_rate_limiter)])
async def update_profile(
    profile_data: schemas.ProfileUpdateRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Update user profile.
    - Full name updates immediately
    - Email changes require verification via email
    """
    updated_fields = []

    # Update full name if provided
    if profile_data.full_name is not None:
        current_user.full_name = profile_data.full_name
        updated_fields.append("full_name")

    # Handle email change with verification
    if profile_data.email is not None:
        # Check if new email is different
        if profile_data.email == current_user.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New email is the same as current email"
            )

        # Check if email service is configured
        if not is_email_configured():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email service not configured. Cannot change email."
            )

        # Check if new email is already in use
        existing_user = db.query(models.User).filter(
            models.User.email == profile_data.email
        ).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already in use"
            )

        # Invalidate old email verification tokens for this user
        db.query(models.EmailVerificationToken).filter(
            models.EmailVerificationToken.user_id == current_user.id,
            models.EmailVerificationToken.used == False,
            models.EmailVerificationToken.expires_at > datetime.utcnow()
        ).update({"used": True})

        # Create email verification token
        verification_token = auth.create_email_verification_token()
        token_hash = auth.hash_token(verification_token)
        expires_at = auth.get_email_verification_token_expiry()

        db_token = models.EmailVerificationToken(
            user_id=current_user.id,
            new_email=profile_data.email,
            token_hash=token_hash,
            expires_at=expires_at
        )
        db.add(db_token)
        db.commit()

        # Send verification email to new address
        email_sent = await send_email_verification_email(
            user_email=current_user.email,
            user_name=current_user.full_name or current_user.email,
            new_email=profile_data.email,
            verification_token=verification_token
        )

        if not email_sent:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification email. Please try again later."
            )

        db.commit()

        return {
            "message": "Profile updated. Please check your new email address to verify the change.",
            "updated_fields": updated_fields,
            "email_verification_pending": True
        }

    db.commit()

    return {
        "message": "Profile updated successfully",
        "updated_fields": updated_fields
    }


@router.post("/auth/change-password", dependencies=[Depends(profile_update_rate_limiter)])
async def change_password(
    request: schemas.PasswordChangeRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Change password (requires current password).
    Invalidates all refresh tokens except current session.
    """
    # Check if email service is configured (for sending confirmation)
    if not is_email_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email service not configured. Please contact administrator."
        )

    # Verify current password
    if not auth.verify_password(request.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect"
        )

    # Check if new password is the same as current
    if auth.verify_password(request.new_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password"
        )

    # Update password
    current_user.hashed_password = auth.get_password_hash(request.new_password)
    current_user.password_changed_at = datetime.utcnow()

    # Invalidate all refresh tokens (force re-login on all devices)
    # Note: Current access token remains valid until it expires (UX: no immediate logout)
    db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == current_user.id,
        models.RefreshToken.revoked == False
    ).update({"revoked": True})

    db.commit()

    # Send confirmation email
    await send_password_changed_notification(
        user_email=current_user.email,
        user_name=current_user.full_name or current_user.email
    )

    return {
        "message": "Password changed successfully. Other sessions have been logged out."
    }


@router.post("/auth/verify-email", dependencies=[Depends(email_verification_rate_limiter)])
async def verify_email(
    request: schemas.VerifyEmailRequest,
    db: Session = Depends(get_db)
):
    """
    Verify email change using token from email.
    """
    # Check if email service is configured (for sending notification)
    if not is_email_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email service not configured. Please contact administrator."
        )

    # Hash the token to find it in database
    token_hash = auth.hash_token(request.token)

    # Find token in database
    db_token = db.query(models.EmailVerificationToken).filter(
        models.EmailVerificationToken.token_hash == token_hash
    ).first()

    if not db_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token"
        )

    # Check if token is used
    if db_token.used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification token has already been used"
        )

    # Check if token is expired
    if db_token.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification token has expired. Please request a new one."
        )

    # Get user
    user = db.query(models.User).filter(models.User.id == db_token.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check if new email is still available (race condition protection)
    existing_user = db.query(models.User).filter(
        models.User.email == db_token.new_email
    ).first()
    if existing_user and existing_user.id != user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is no longer available"
        )

    # Store old email for notification
    old_email = user.email
    is_email_change = (old_email != db_token.new_email)

    # Update email (only if it's different)
    if is_email_change:
        user.email = db_token.new_email

    # Mark email as verified
    user.email_verified = True

    # Mark token as used
    db_token.used = True

    db.commit()

    # Send notification to old email address (only if email was changed)
    if is_email_change:
        await send_email_change_notification(
            old_email=old_email,
            user_name=user.full_name or old_email,
            new_email=db_token.new_email
        )

    if is_email_change:
        return {
            "message": "Email verified and updated successfully"
        }
    else:
        return {
            "message": "Email verified successfully"
        }


@router.post("/auth/resend-verification-email", dependencies=[Depends(email_verification_rate_limiter)])
async def resend_verification_email(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Resend email verification for pending email change OR send initial verification.
    - If there's a pending email change token, resends verification for the new email
    - If no pending token exists, sends verification email to current email address
    """
    # Check if email service is configured
    if not is_email_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email service not configured. Cannot send verification email."
        )

    # Check if email is already verified
    if current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already verified"
        )

    # Find the most recent unused, non-expired token for this user
    pending_token = db.query(models.EmailVerificationToken).filter(
        models.EmailVerificationToken.user_id == current_user.id,
        models.EmailVerificationToken.used == False,
        models.EmailVerificationToken.expires_at > datetime.utcnow()
    ).order_by(models.EmailVerificationToken.created_at.desc()).first()

    # Determine target email: pending new email or current email
    if pending_token:
        # Case 1: User has a pending email change
        target_email = pending_token.new_email

        # Check if new email is still available
        existing_user = db.query(models.User).filter(
            models.User.email == target_email
        ).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is no longer available"
            )

        # Invalidate the old token
        pending_token.used = True
    else:
        # Case 2: No pending change, verify current email (for accounts created before verification)
        target_email = current_user.email

    # Create a new verification token
    verification_token = auth.create_email_verification_token()
    token_hash = auth.hash_token(verification_token)
    expires_at = auth.get_email_verification_token_expiry()

    # Create new token
    db_token = models.EmailVerificationToken(
        user_id=current_user.id,
        new_email=target_email,
        token_hash=token_hash,
        expires_at=expires_at
    )
    db.add(db_token)
    db.commit()

    # Send verification email
    email_sent = await send_email_verification_email(
        user_email=current_user.email,
        user_name=current_user.full_name or current_user.email,
        new_email=target_email,
        verification_token=verification_token
    )

    if not email_sent:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send verification email. Please try again later."
        )

    if target_email == current_user.email:
        message = "Verification email has been sent to your current email address. Please check your inbox."
    else:
        message = "Verification email has been resent to your new email address. Please check your inbox."

    return {
        "message": message,
        "target_email": target_email
    }
