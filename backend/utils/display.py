"""
Display utilities for guest and user names
"""
from sqlalchemy.orm import Session
import models


def mask_email(email: str) -> str:
    """
    Mask an email address for public display.
    Example: jules@example.com -> j***s@example.com
    """
    if not email or "@" not in email:
        return "User"

    try:
        user_part, domain_part = email.split("@", 1)
        if len(user_part) > 3:
            return f"{user_part[:2]}***{user_part[-1]}@{domain_part}"
        elif len(user_part) > 1:
            return f"{user_part[0]}***@{domain_part}"
        else:
            return f"***@{domain_part}"
    except Exception:
        return "User"


def get_public_user_display_name(user: models.User) -> str:
    """
    Get a safe display name for a user in a public context.
    Uses full_name if available, otherwise masks the email.
    """
    if not user:
        return "Unknown User"

    if user.full_name:
        return user.full_name

    return mask_email(user.email)


def get_guest_display_name(guest: models.GuestMember, db: Session) -> str:
    """
    Get the display name for a guest.
    If the guest has been claimed, returns the claimed user's full_name or email.
    Otherwise, returns the guest's name.

    Args:
        guest: The GuestMember object
        db: Database session

    Returns:
        Display name string
    """
    if not guest:
        return "Unknown Guest"

    if guest.claimed_by_id:
        claimed_user = db.query(models.User).filter(
            models.User.id == guest.claimed_by_id
        ).first()
        return (claimed_user.full_name or claimed_user.email) if claimed_user else guest.name

    return guest.name


def get_participant_display_name(user_id: int, is_guest: bool, db: Session) -> str:
    """
    Get the display name for a participant (user or guest).
    Handles claimed guests by showing their user's full_name instead of guest name.

    Args:
        user_id: The user or guest ID
        is_guest: True if this is a guest, False if a registered user
        db: Database session

    Returns:
        Display name string
    """
    if is_guest:
        guest = db.query(models.GuestMember).filter(
            models.GuestMember.id == user_id
        ).first()
        return get_guest_display_name(guest, db)
    else:
        user = db.query(models.User).filter(
            models.User.id == user_id
        ).first()
        return (user.full_name or user.email) if user else "Unknown User"
