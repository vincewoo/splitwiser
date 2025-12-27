"""Groups router: create, read, update, delete groups."""

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from utils.validation import get_group_or_404, verify_group_membership, verify_group_ownership


router = APIRouter(prefix="/groups", tags=["groups"])


@router.post("", response_model=schemas.Group)
def create_group(
    group: schemas.GroupCreate, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    db_group = models.Group(
        name=group.name, 
        created_by_id=current_user.id, 
        default_currency=group.default_currency, 
        icon=group.icon
    )
    db.add(db_group)
    db.commit()
    db.refresh(db_group)

    # Add creator as member
    db_member = models.GroupMember(group_id=db_group.id, user_id=current_user.id)
    db.add(db_member)
    db.commit()

    return db_group


@router.get("", response_model=list[schemas.Group])
def read_groups(
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    # Get groups where user is a member
    user_groups = db.query(models.Group).join(
        models.GroupMember, 
        models.Group.id == models.GroupMember.group_id
    ).filter(models.GroupMember.user_id == current_user.id).all()
    return user_groups


@router.get("/{group_id}", response_model=schemas.GroupWithMembers)
def get_group(
    group_id: int, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
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
        icon=group.icon,
        members=members,
        guests=guests_with_manager_names
    )


@router.put("/{group_id}", response_model=schemas.Group)
def update_group(
    group_id: int, 
    group_update: schemas.GroupUpdate, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    group = verify_group_ownership(db, group_id, current_user.id)
    group.name = group_update.name
    group.default_currency = group_update.default_currency
    group.icon = group_update.icon
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}")
def delete_group(
    group_id: int, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    verify_group_ownership(db, group_id, current_user.id)

    # Set group_id to NULL on associated expenses (preserve history)
    db.query(models.Expense).filter(models.Expense.group_id == group_id).update({"group_id": None})

    # Delete group members
    db.query(models.GroupMember).filter(models.GroupMember.group_id == group_id).delete()

    # Delete group
    db.query(models.Group).filter(models.Group.id == group_id).delete()
    db.commit()

    return {"message": "Group deleted successfully"}


@router.post("/{group_id}/share", response_model=schemas.Group)
def share_group(
    group_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    group = verify_group_ownership(db, group_id, current_user.id)
    
    if not group.share_link_id:
        import uuid
        group.share_link_id = str(uuid.uuid4())
    
    group.is_public = True
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}/share", response_model=schemas.Group)
def unshare_group(
    group_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    group = verify_group_ownership(db, group_id, current_user.id)
    group.is_public = False
    db.commit()
    db.refresh(group)
    return group


@router.get("/public/{share_link_id}", response_model=schemas.GroupWithMembers)
def get_public_group(
    share_link_id: str,
    db: Session = Depends(get_db)
):
    group = db.query(models.Group).filter(
        models.Group.share_link_id == share_link_id,
        models.Group.is_public == True
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Public group not found")

    # Get members with user details
    members_query = db.query(models.GroupMember, models.User).join(
        models.User, models.GroupMember.user_id == models.User.id
    ).filter(models.GroupMember.group_id == group.id).all()

    members = [
        schemas.GroupMember(
            id=gm.id,
            user_id=user.id,
            full_name=user.full_name or user.email, # Maybe partially redact email for public view?
            email=user.email # Keeping it for now as per plan
        )
        for gm, user in members_query
    ]

    # Get unclaimed guests
    guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group.id,
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
        icon=group.icon,
        share_link_id=group.share_link_id,
        is_public=group.is_public,
        members=members,
        guests=guests_with_manager_names
    )


@router.get("/public/{share_link_id}/expenses", response_model=list[schemas.ExpenseWithSplits])
def get_public_group_expenses(
    share_link_id: str,
    db: Session = Depends(get_db)
):
    group = db.query(models.Group).filter(
        models.Group.share_link_id == share_link_id,
        models.Group.is_public == True
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Public group not found")

    expenses = db.query(models.Expense).filter(
        models.Expense.group_id == group.id
    ).order_by(models.Expense.date.desc()).all()

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
        
        # Build items
        items_data = []
        if expense.split_type == "ITEMIZED":
            expense_items = db.query(models.ExpenseItem).filter(
                models.ExpenseItem.expense_id == expense.id
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
            "items": items_data,
            "icon": expense.icon,
            "receipt_image_path": expense.receipt_image_path,
            "notes": expense.notes
        }
        result.append(expense_dict)

    return result


@router.get("/public/{share_link_id}/balances", response_model=list[schemas.GroupBalance])
def get_public_group_balances(
    share_link_id: str,
    db: Session = Depends(get_db)
):
    group = db.query(models.Group).filter(
        models.Group.share_link_id == share_link_id,
        models.Group.is_public == True
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Public group not found")

    # Get all expenses in group
    expenses = db.query(models.Expense).filter(models.Expense.group_id == group.id).all()

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
        models.GuestMember.group_id == group.id,
        models.GuestMember.managed_by_id != None
    ).all()

    # Track which guests were aggregated with which managers (for breakdown display)
    manager_guest_breakdown = {}

    # Aggregate managed guest balances with their managers
    for guest in managed_guests:
        if guest.claimed_by_id:
            # If guest is claimed, their balance is now under the user ID
            guest_key = (guest.claimed_by_id, False)
        else:
            # If guest is unclaimed, their balance is under the guest ID
            guest_key = (guest.id, True)

        manager_is_guest = (guest.managed_by_type == 'guest')
        manager_key = (guest.managed_by_id, manager_is_guest)

        if guest_key in net_balances:
            guest_currencies = net_balances[guest_key]
            for currency, amount in guest_currencies.items():
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                if currency not in net_balances[manager_key]:
                    net_balances[manager_key][currency] = 0

                net_balances[manager_key][currency] += amount

                breakdown_key = (guest.managed_by_id, manager_is_guest, currency)
                if breakdown_key not in manager_guest_breakdown:
                    manager_guest_breakdown[breakdown_key] = []
                manager_guest_breakdown[breakdown_key].append((guest.name, amount))

            del net_balances[guest_key]

    from utils.currency import format_currency  # Import here to avoid circular dependencies if any, though likely fine at top

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
                managed_guests_list = []
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


@router.post("/public/{share_link_id}/join")
def join_public_group(
    share_link_id: str,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Allow a logged-in user to join a public group via share link"""
    group = db.query(models.Group).filter(
        models.Group.share_link_id == share_link_id,
        models.Group.is_public == True
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Public group not found")

    # Check if already a member
    existing = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group.id,
        models.GroupMember.user_id == current_user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="You are already a member of this group")

    # Add user as member
    new_member = models.GroupMember(group_id=group.id, user_id=current_user.id)
    db.add(new_member)
    db.commit()

    return {
        "message": "Successfully joined group",
        "group_id": group.id
    }


@router.get("/public/{share_link_id}/expenses/{expense_id}", response_model=schemas.ExpenseWithSplits)
def get_public_expense_detail(
    share_link_id: str,
    expense_id: int,
    db: Session = Depends(get_db)
):
    group = db.query(models.Group).filter(
        models.Group.share_link_id == share_link_id,
        models.Group.is_public == True
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Public group not found")

    expense = db.query(models.Expense).filter(
        models.Expense.id == expense_id,
        models.Expense.group_id == group.id
    ).first()

    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # Fetch splits
    splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()

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

    # Fetch items if itemized
    items_data = []
    if expense.split_type == "ITEMIZED":
        expense_items = db.query(models.ExpenseItem).filter(
            models.ExpenseItem.expense_id == expense.id
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
        split_type=expense.split_type,
        splits=splits_with_names,
        items=items_data,
        icon=expense.icon,
        receipt_image_path=expense.receipt_image_path,
        notes=expense.notes
    )
