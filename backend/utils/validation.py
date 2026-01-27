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
    items: list[schemas.ExpenseItemCreate] | None = None,
    skip_expense_guest_validation: bool = False
) -> None:
    """Validate that all participants (payer, split participants, item assignees) exist.

    Args:
        skip_expense_guest_validation: If True, skip validation for expense guests (they're created during expense creation)
    """
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
                    # Skip expense guest assignments (they use temp_guest_id)
                    if skip_expense_guest_validation and assignment.temp_guest_id:
                        continue

                    # Skip if no user_id (expense guest assignment)
                    if assignment.user_id is None:
                        continue

                    if assignment.is_guest:
                        guest = db.query(models.GuestMember).filter(models.GuestMember.id == assignment.user_id).first()
                        if not guest:
                            raise HTTPException(status_code=400, detail=f"Guest with ID {assignment.user_id} not found in item assignments")
                    else:
                        user = db.query(models.User).filter(models.User.id == assignment.user_id).first()
                        if not user:
                            raise HTTPException(status_code=400, detail=f"User with ID {assignment.user_id} not found in item assignments")


def get_assignment_key(assignment: schemas.ItemAssignment) -> str:
    """Get a unique key for an assignment (user, group guest, or expense guest)."""
    if assignment.temp_guest_id:
        return f"expense_guest_{assignment.temp_guest_id}"
    elif assignment.is_guest:
        return f"guest_{assignment.user_id}"
    else:
        return f"user_{assignment.user_id}"


def validate_item_split_details(items: list[schemas.ExpenseItemCreate]) -> None:
    """Validate that item split details are valid for their split types."""
    for item_idx, item in enumerate(items):
        if not hasattr(item, 'split_type'):
            continue

        split_type = item.split_type
        split_details = getattr(item, 'split_details', {}) or {}

        # Skip validation for EQUAL splits
        if split_type == 'EQUAL' or len(item.assignments) <= 1:
            continue

        # Validate that split_details exist for non-EQUAL splits
        if split_type != 'EQUAL' and not split_details:
            raise HTTPException(
                status_code=400,
                detail=f"Item {item_idx + 1}: Split details required for {split_type} split"
            )

        # Validate EXACT splits
        if split_type == 'EXACT':
            total_amount = 0
            for assignment in item.assignments:
                key = get_assignment_key(assignment)
                detail = split_details.get(key, {})
                # Handle both dict and ItemSplitDetail object
                if hasattr(detail, 'amount'):
                    amount = detail.amount or 0
                elif isinstance(detail, dict):
                    amount = detail.get('amount', 0)
                else:
                    amount = 0
                total_amount += amount

            # Allow small discrepancy for rounding
            if abs(total_amount - item.price) > len(item.assignments):
                raise HTTPException(
                    status_code=400,
                    detail=f"Item {item_idx + 1}: Exact amounts (${total_amount/100:.2f}) don't match item price (${item.price/100:.2f})"
                )

        # Validate PERCENT splits
        elif split_type == 'PERCENT':
            total_percentage = 0
            for assignment in item.assignments:
                key = get_assignment_key(assignment)
                detail = split_details.get(key, {})
                # Handle both dict and ItemSplitDetail object
                if hasattr(detail, 'percentage'):
                    percentage = detail.percentage or 0
                elif isinstance(detail, dict):
                    percentage = detail.get('percentage', 0)
                else:
                    percentage = 0
                total_percentage += percentage

            # Allow small discrepancy for rounding
            if abs(total_percentage - 100) > 0.01:
                raise HTTPException(
                    status_code=400,
                    detail=f"Item {item_idx + 1}: Percentages must add up to 100% (currently {total_percentage}%)"
                )

        # Validate SHARES splits
        elif split_type == 'SHARES':
            total_shares = 0
            for assignment in item.assignments:
                key = get_assignment_key(assignment)
                detail = split_details.get(key, {})
                # Handle both dict and ItemSplitDetail object
                if hasattr(detail, 'shares'):
                    shares = detail.shares if detail.shares is not None else 1
                elif isinstance(detail, dict):
                    shares = detail.get('shares', 1)
                else:
                    shares = 1
                if shares < 1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Item {item_idx + 1}: Shares must be at least 1"
                    )
                total_shares += shares

            if total_shares == 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Item {item_idx + 1}: Total shares must be greater than 0"
                )
