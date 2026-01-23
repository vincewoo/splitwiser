"""OAuth router: Google Sign-In authentication."""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
import auth
from database import get_db
from dependencies import get_current_user
from oauth.google import verify_google_token, GoogleOAuthError
from utils.rate_limiter import auth_rate_limiter

router = APIRouter(prefix="/auth/google", tags=["oauth"])


@router.post("/authenticate", response_model=schemas.GoogleAuthResponse, dependencies=[Depends(auth_rate_limiter)])
def google_authenticate(
    request: schemas.GoogleAuthRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate with Google OAuth.

    Flow:
    1. Verify Google ID token
    2. Check if user exists by google_id
    3. If not, check if user exists by email (for account linking)
    4. Create new user or return existing user's tokens
    5. Handle guest claiming if provided
    """
    try:
        google_info = verify_google_token(request.id_token)
    except GoogleOAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {str(e)}"
        )

    google_id = google_info['google_id']
    google_email = google_info['email']
    google_name = google_info['name']
    google_picture = google_info['picture']

    # Require verified email from Google
    if not google_info.get('email_verified'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account email must be verified"
        )

    is_new_user = False
    account_linked = False
    claimed_group_id = None

    # Step 1: Check if user exists by Google ID
    user = db.query(models.User).filter(models.User.google_id == google_id).first()

    if not user:
        # Step 2: Check if user exists by email (potential account linking)
        user = db.query(models.User).filter(models.User.email == google_email).first()

        if user:
            # Link Google account to existing user
            user.google_id = google_id
            user.google_picture = google_picture
            user.auth_provider = "both" if user.hashed_password else "google"
            user.email_verified = True  # Google email is verified
            account_linked = True
        else:
            # Step 3: Create new user
            user = models.User(
                email=google_email,
                full_name=google_name or google_email.split('@')[0],
                google_id=google_id,
                google_picture=google_picture,
                auth_provider="google",
                email_verified=True,  # Google email is pre-verified
                hashed_password=None  # No password for OAuth-only users
            )
            db.add(user)
            db.flush()  # Get user ID
            is_new_user = True

            # Handle guest claiming for new users
            if request.claim_guest_id and request.share_link_id:
                claimed_group_id = _claim_guest_for_user(
                    db, user, request.claim_guest_id, request.share_link_id
                )

    # Update last login
    user.last_login_at = datetime.utcnow()

    # Create tokens (same as regular login)
    access_token = auth.create_access_token(data={"sub": user.email})
    refresh_token = auth.create_refresh_token()

    # Store refresh token
    db_refresh_token = models.RefreshToken(
        user_id=user.id,
        token_hash=auth.hash_token(refresh_token),
        expires_at=auth.get_refresh_token_expiry()
    )
    db.add(db_refresh_token)
    db.commit()

    return schemas.GoogleAuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        is_new_user=is_new_user,
        claimed_group_id=claimed_group_id,
        account_linked=account_linked
    )


@router.post("/link", dependencies=[Depends(auth_rate_limiter)])
def link_google_account(
    request: schemas.GoogleLinkRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Link Google account to existing authenticated user.
    User must be logged in with email/password.
    """
    if current_user.google_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account already linked"
        )

    try:
        google_info = verify_google_token(request.id_token)
    except GoogleOAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {str(e)}"
        )

    google_id = google_info['google_id']

    # Check if this Google account is already linked to another user
    existing = db.query(models.User).filter(models.User.google_id == google_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This Google account is already linked to another user"
        )

    # Link the account
    current_user.google_id = google_id
    current_user.google_picture = google_info['picture']
    current_user.auth_provider = "both"

    db.commit()

    return {"message": "Google account linked successfully"}


@router.delete("/unlink", dependencies=[Depends(auth_rate_limiter)])
def unlink_google_account(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Unlink Google account from user.
    Requires user to have a password set (cannot be OAuth-only).
    """
    if not current_user.google_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Google account linked"
        )

    if not current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot unlink Google account without a password. Please set a password first."
        )

    current_user.google_id = None
    current_user.google_picture = None
    current_user.auth_provider = "local"

    db.commit()

    return {"message": "Google account unlinked successfully"}


def _claim_guest_for_user(db: Session, user: models.User, guest_id: int, share_link_id: str) -> int | None:
    """
    Claim a guest profile for a newly registered OAuth user.
    Returns claimed_group_id if successful, None otherwise.
    """
    # Validate guest and group access
    guest = db.query(models.GuestMember).filter(models.GuestMember.id == guest_id).first()
    if not guest:
        print(f"Failed to claim guest {guest_id}: Guest not found")
        return None

    # Check if group matches share link
    group = db.query(models.Group).filter(
        models.Group.id == guest.group_id,
        models.Group.share_link_id == share_link_id,
        models.Group.is_public == True
    ).first()

    if not group:
        print(f"Failed to claim guest {guest_id}: Invalid share link or group not public")
        return None

    if guest.claimed_by_id:
        print(f"Failed to claim guest {guest_id}: Already claimed")
        return None

    # Proceed with claiming
    guest.claimed_by_id = user.id
    claimed_group_id = None

    # Add user to group members if not already
    member = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group.id,
        models.GroupMember.user_id == user.id
    ).first()

    if not member:
        db_member = models.GroupMember(group_id=group.id, user_id=user.id)

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
        "user_id": user.id,
        "is_guest": False
    })

    db.query(models.ExpenseItemAssignment).filter(
        models.ExpenseItemAssignment.user_id == guest.id,
        models.ExpenseItemAssignment.is_guest == True
    ).update({
        "user_id": user.id,
        "is_guest": False
    })

    db.query(models.Expense).filter(
        models.Expense.payer_id == guest.id,
        models.Expense.payer_is_guest == True
    ).update({
        "payer_id": user.id,
        "payer_is_guest": False
    })

    # Update managed guests to be managed by the new user
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.managed_by_id == guest.id,
        models.GuestMember.managed_by_type == 'guest'
    ).all()

    for mg in managed_guests:
        mg.managed_by_id = user.id
        mg.managed_by_type = 'user'

    print(f"Successfully claimed guest {guest_id} for user {user.id}")
    return claimed_group_id
