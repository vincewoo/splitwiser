"""Expenses router: create, read, update, delete expenses."""

from typing import Annotated
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from utils.validation import get_group_or_404, verify_group_membership, validate_expense_participants
from utils.splits import calculate_itemized_splits
from utils.currency import get_exchange_rate_for_expense
from utils.display import get_guest_display_name


# Receipt directory path (must match main.py)
DATA_DIR = os.getenv("DATA_DIR", "data")
RECEIPT_DIR = os.path.join(DATA_DIR, "receipts")


router = APIRouter(tags=["expenses"])


def normalize_date(date_str: str) -> str:
    """Normalize date string to YYYY-MM-DD format for consistent sorting."""
    if not date_str:
        return date_str
    # If it's already YYYY-MM-DD format, return as-is
    if len(date_str) == 10 and date_str[4] == '-' and date_str[7] == '-':
        return date_str
    # Handle ISO format with time component (e.g., 2025-12-27T00:00:00.000Z)
    if 'T' in date_str:
        return date_str.split('T')[0]
    return date_str


@router.post("/expenses", response_model=schemas.Expense)
def create_expense(
    expense: schemas.ExpenseCreate, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
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
        if abs(total_split - expense.amount) > 1:  # Allow 1 cent diff
            raise HTTPException(
                status_code=400, 
                detail=f"Split amounts do not sum to total expense amount. Total: {expense.amount}, Sum: {total_split}"
            )

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
        date=normalize_date(expense.date),
        payer_id=expense.payer_id,
        payer_is_guest=expense.payer_is_guest,
        group_id=expense.group_id,
        created_by_id=current_user.id,
        exchange_rate=str(exchange_rate),
        split_type=expense.split_type or "EQUAL",
        icon=expense.icon,
        receipt_image_path=expense.receipt_image_path,
        notes=expense.notes
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


@router.get("/expenses", response_model=list[schemas.Expense])
def read_expenses(
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    # Return expenses where user is involved (payer or splitter)
    subquery = db.query(models.ExpenseSplit.expense_id).filter(
        models.ExpenseSplit.user_id == current_user.id
    ).subquery()

    expenses = db.query(models.Expense).filter(
        (models.Expense.payer_id == current_user.id) |
        (models.Expense.id.in_(subquery))
    ).all()

    return expenses


@router.get("/expenses/{expense_id}", response_model=schemas.ExpenseWithSplits)
def get_expense(
    expense_id: int, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
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
                    name = get_guest_display_name(guest, db)
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
        icon=expense.icon,
        receipt_image_path=expense.receipt_image_path,
        notes=expense.notes
    )


@router.put("/expenses/{expense_id}", response_model=schemas.Expense)
def update_expense(
    expense_id: int, 
    expense_update: schemas.ExpenseUpdate, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Verify user is a member of the group (all group members can edit expenses)
    if expense.group_id:
        verify_group_membership(db, expense.group_id, current_user.id)
    else:
        # For non-group expenses, only the creator can edit
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
        raise HTTPException(
            status_code=400, 
            detail=f"Split amounts do not sum to total expense amount. Total: {expense_update.amount}, Sum: {total_split}"
        )

    # Validate all participants exist
    validate_expense_participants(
        db=db,
        payer_id=expense_update.payer_id,
        payer_is_guest=expense_update.payer_is_guest,
        splits=expense_update.splits,
        items=expense_update.items if expense_update.split_type == "ITEMIZED" else None
    )

    # Update expense fields
    # Normalize the date first for accurate comparison
    normalized_update_date = normalize_date(expense_update.date)

    # Check if date or currency changed, if so update exchange rate
    if expense.date != normalized_update_date or expense.currency != expense_update.currency:
        new_rate = get_exchange_rate_for_expense(normalized_update_date, expense_update.currency)
        expense.exchange_rate = str(new_rate)

    expense.description = expense_update.description
    expense.amount = expense_update.amount
    expense.currency = expense_update.currency
    expense.date = normalized_update_date
    expense.payer_id = expense_update.payer_id
    expense.payer_is_guest = expense_update.payer_is_guest
    expense.split_type = expense_update.split_type or "EQUAL"
    expense.icon = expense_update.icon
    expense.notes = expense_update.notes
    if expense_update.receipt_image_path is not None:
        expense.receipt_image_path = expense_update.receipt_image_path

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


@router.delete("/expenses/{expense_id}")
def delete_expense(
    expense_id: int, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Verify user is a member of the group (all group members can delete expenses)
    if expense.group_id:
        verify_group_membership(db, expense.group_id, current_user.id)
    else:
        # For non-group expenses, only the creator can delete
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

    # Delete receipt image if exists
    if expense.receipt_image_path:
        try:
            filename = os.path.basename(expense.receipt_image_path)
            file_path = os.path.join(RECEIPT_DIR, filename)
            
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Deleted receipt image: {file_path}")
        except Exception as e:
            print(f"Error deleting receipt image {expense.receipt_image_path}: {e}")

    # Delete the expense
    db.delete(expense)
    db.commit()

    return {"message": "Expense deleted successfully"}


@router.get("/groups/{group_id}/expenses", response_model=list[schemas.ExpenseWithSplits])
def get_group_expenses(
    group_id: int, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # 1. Fetch all expenses
    expenses = db.query(models.Expense).filter(
        models.Expense.group_id == group_id
    ).order_by(models.Expense.date.desc(), models.Expense.id.desc()).all()

    if not expenses:
        return []

    expense_ids = [e.id for e in expenses]

    # 2. Fetch all splits for these expenses
    all_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.expense_id.in_(expense_ids)
    ).all()

    # Group splits by expense_id
    splits_by_expense = {}
    user_ids = set()
    guest_ids = set()

    for split in all_splits:
        if split.expense_id not in splits_by_expense:
            splits_by_expense[split.expense_id] = []
        splits_by_expense[split.expense_id].append(split)

        if split.is_guest:
            guest_ids.add(split.user_id)
        else:
            user_ids.add(split.user_id)

    # 3. Batch fetch users and guests
    users = {}
    if user_ids:
        user_records = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
        users = {u.id: u for u in user_records}

    guests = {}
    if guest_ids:
        guest_records = db.query(models.GuestMember).filter(models.GuestMember.id.in_(guest_ids)).all()
        guests = {g.id: g for g in guest_records}

    # 4. Assemble the result
    result = []
    for expense in expenses:
        expense_splits = splits_by_expense.get(expense.id, [])

        # Build splits with user names
        splits_with_names = []
        for split in expense_splits:
            if split.is_guest:
                guest = guests.get(split.user_id)
                user_name = get_guest_display_name(guest, db) if guest else "Unknown Guest"
            else:
                user = users.get(split.user_id)
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
            "icon": expense.icon,
            "notes": expense.notes
        }
        result.append(expense_dict)

    return result
