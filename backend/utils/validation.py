"""Validation utilities for group membership, access control, and expense participants."""

from sqlalchemy.orm import Session
from fastapi import HTTPException

import models
import schemas


def get_user_by_email(db: Session, email: str):
    """Get a user by their email address."""
    return db.query(models.User).filter(models.User.email == email).first()


def get_group_or_404(db: Session, group_id: int):
    """Get a group by ID or raise 404 if not found."""
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def verify_group_membership(db: Session, group_id: int, user_id: int):
    """Verify that a user is a member of a group, raise 403 if not."""
    member = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.user_id == user_id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    return member


def verify_group_ownership(db: Session, group_id: int, user_id: int):
    """Verify that a user owns a group, raise 403 if not."""
    group = get_group_or_404(db, group_id)
    if group.created_by_id != user_id:
        raise HTTPException(status_code=403, detail="Only the group owner can perform this action")
    return group


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
