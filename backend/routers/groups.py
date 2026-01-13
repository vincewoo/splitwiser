"""Groups router: create, read, update, delete groups."""

import json
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from utils.validation import get_group_or_404, verify_group_membership, verify_group_ownership
from utils.display import get_guest_display_name, get_public_user_display_name


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

    # Get unclaimed guests
    guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.claimed_by_id == None
    ).all()

    # Optimized: Batch fetch managers for members and guests to avoid N+1 queries
    # Collect all manager IDs
    manager_user_ids = set()
    manager_guest_ids = set()

    # Check members for managers
    for gm, _ in members_query:
        if gm.managed_by_id:
            if gm.managed_by_type == 'user':
                manager_user_ids.add(gm.managed_by_id)
            elif gm.managed_by_type == 'guest':
                manager_guest_ids.add(gm.managed_by_id)

    # Check guests for managers
    for g in guests:
        if g.managed_by_id:
            if g.managed_by_type == 'user':
                manager_user_ids.add(g.managed_by_id)
            elif g.managed_by_type == 'guest':
                manager_guest_ids.add(g.managed_by_id)

    # Batch fetch manager users
    manager_users = {}
    if manager_user_ids:
        users = db.query(models.User).filter(models.User.id.in_(manager_user_ids)).all()
        manager_users = {u.id: (u.full_name or u.email) for u in users}

    # Batch fetch manager guests
    manager_guests = {}
    if manager_guest_ids:
        guest_managers = db.query(models.GuestMember).filter(models.GuestMember.id.in_(manager_guest_ids)).all()

        # Helper map for guest objects
        manager_guests = {g.id: g for g in guest_managers}

        # Prefetch users for claimed guests to resolve their display names without N+1 queries
        claimed_user_ids = {g.claimed_by_id for g in guest_managers if g.claimed_by_id}
        if claimed_user_ids:
            claimed_users = db.query(models.User).filter(models.User.id.in_(claimed_user_ids)).all()
            claimed_user_map = {u.id: u for u in claimed_users}

            # Resolve names: Use claimed user's name if claimed, otherwise use guest name
            final_manager_guest_names = {}
            for g_id, g in manager_guests.items():
                if g.claimed_by_id and g.claimed_by_id in claimed_user_map:
                    u = claimed_user_map[g.claimed_by_id]
                    final_manager_guest_names[g_id] = u.full_name or u.email
                else:
                    final_manager_guest_names[g_id] = g.name
            manager_guests = final_manager_guest_names # Now maps ID -> Name string
        else:
            # No claimed guests, just use names
            manager_guests = {g_id: g.name for g_id, g in manager_guests.items()}

    # Populate managed_by_name for each member
    members = []
    for gm, user in members_query:
        managed_by_name = None
        if gm.managed_by_id:
            if gm.managed_by_type == 'user':
                managed_by_name = manager_users.get(gm.managed_by_id)
            elif gm.managed_by_type == 'guest':
                managed_by_name = manager_guests.get(gm.managed_by_id)

        members.append(schemas.GroupMember(
            id=gm.id,
            user_id=user.id,
            full_name=user.full_name or user.email,
            email=user.email,
            managed_by_id=gm.managed_by_id,
            managed_by_type=gm.managed_by_type,
            managed_by_name=managed_by_name
        ))

    # Populate managed_by_name for each guest
    guests_with_manager_names = []
    for g in guests:
        managed_by_name = None
        if g.managed_by_id:
            if g.managed_by_type == 'user':
                managed_by_name = manager_users.get(g.managed_by_id)
            elif g.managed_by_type == 'guest':
                managed_by_name = manager_guests.get(g.managed_by_id)

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
    # Any group member can share the group
    verify_group_membership(db, group_id, current_user.id)
    group = get_group_or_404(db, group_id)

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
    # Any group member can unshare the group
    verify_group_membership(db, group_id, current_user.id)
    group = get_group_or_404(db, group_id)
    group.is_public = False
    db.commit()
    db.refresh(group)
    return group


@router.get("/public/{share_link_id}", response_model=schemas.PublicGroupWithMembers)
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

    # Populate managed_by_name for each member
    members = []
    for gm, user in members_query:
        managed_by_name = None
        if gm.managed_by_id:
            if gm.managed_by_type == 'user':
                manager = db.query(models.User).filter(models.User.id == gm.managed_by_id).first()
                if manager:
                    managed_by_name = get_public_user_display_name(manager)
            elif gm.managed_by_type == 'guest':
                manager_guest = db.query(models.GuestMember).filter(models.GuestMember.id == gm.managed_by_id).first()
                if manager_guest:
                    managed_by_name = get_guest_display_name(manager_guest, db)

        members.append(schemas.PublicGroupMember(
            id=gm.id,
            user_id=user.id,
            full_name=get_public_user_display_name(user),
            managed_by_id=gm.managed_by_id,
            managed_by_type=gm.managed_by_type,
            managed_by_name=managed_by_name
        ))

    # Get unclaimed guests
    guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group.id,
        models.GuestMember.claimed_by_id == None
    ).all()

    # Optimized: Batch fetch managers for members and guests to avoid N+1 queries
    # Collect all manager IDs
    manager_user_ids = set()
    manager_guest_ids = set()

    # Check members for managers
    for gm, _ in members_query:
        if gm.managed_by_id:
            if gm.managed_by_type == 'user':
                manager_user_ids.add(gm.managed_by_id)
            elif gm.managed_by_type == 'guest':
                manager_guest_ids.add(gm.managed_by_id)

    # Check guests for managers
    for g in guests:
        if g.managed_by_id:
            if g.managed_by_type == 'user':
                manager_user_ids.add(g.managed_by_id)
            elif g.managed_by_type == 'guest':
                manager_guest_ids.add(g.managed_by_id)

    # Batch fetch manager users
    manager_users = {}
    if manager_user_ids:
        users = db.query(models.User).filter(models.User.id.in_(manager_user_ids)).all()
        manager_users = {u.id: get_public_user_display_name(u) for u in users}

    # Batch fetch manager guests
    manager_guests = {}
    if manager_guest_ids:
        guest_managers = db.query(models.GuestMember).filter(models.GuestMember.id.in_(manager_guest_ids)).all()

        # Helper map for guest objects
        manager_guests = {g.id: g for g in guest_managers}

        # Prefetch users for claimed guests to resolve their display names without N+1 queries
        claimed_user_ids = {g.claimed_by_id for g in guest_managers if g.claimed_by_id}
        if claimed_user_ids:
            claimed_users = db.query(models.User).filter(models.User.id.in_(claimed_user_ids)).all()
            claimed_user_map = {u.id: u for u in claimed_users}

            # Resolve names: Use claimed user's name if claimed, otherwise use guest name
            final_manager_guest_names = {}
            for g_id, g in manager_guests.items():
                if g.claimed_by_id and g.claimed_by_id in claimed_user_map:
                    u = claimed_user_map[g.claimed_by_id]
                    final_manager_guest_names[g_id] = get_public_user_display_name(u)
                else:
                    final_manager_guest_names[g_id] = g.name
            manager_guests = final_manager_guest_names # Now maps ID -> Name string
        else:
            # No claimed guests, just use names
            manager_guests = {g_id: g.name for g_id, g in manager_guests.items()}

    # Populate managed_by_name for each member
    members = []
    for gm, user in members_query:
        managed_by_name = None
        if gm.managed_by_id:
            if gm.managed_by_type == 'user':
                managed_by_name = manager_users.get(gm.managed_by_id)
            elif gm.managed_by_type == 'guest':
                managed_by_name = manager_guests.get(gm.managed_by_id)

        members.append(schemas.PublicGroupMember(
            id=gm.id,
            user_id=user.id,
            full_name=get_public_user_display_name(user),
            managed_by_id=gm.managed_by_id,
            managed_by_type=gm.managed_by_type,
            managed_by_name=managed_by_name
        ))

    # Populate managed_by_name for each guest
    guests_with_manager_names = []
    for g in guests:
        managed_by_name = None
        if g.managed_by_id:
            if g.managed_by_type == 'user':
                managed_by_name = manager_users.get(g.managed_by_id)
            elif g.managed_by_type == 'guest':
                managed_by_name = manager_guests.get(g.managed_by_id)

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

    return schemas.PublicGroupWithMembers(
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

    if not expenses:
        return []

    expense_ids = [e.id for e in expenses]

    # Batch fetch splits
    all_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.expense_id.in_(expense_ids)
    ).all()

    # Group splits by expense
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

    # Check for ITEMIZED expenses to load items
    itemized_expense_ids = [e.id for e in expenses if e.split_type == "ITEMIZED"]
    items_by_expense = {}

    if itemized_expense_ids:
        all_items = db.query(models.ExpenseItem).filter(
            models.ExpenseItem.expense_id.in_(itemized_expense_ids)
        ).all()

        if all_items:
            item_ids = [i.id for i in all_items]
            all_assignments = db.query(models.ExpenseItemAssignment).filter(
                models.ExpenseItemAssignment.expense_item_id.in_(item_ids)
            ).all()

            # Group assignments by item
            assignments_by_item = {}
            for assignment in all_assignments:
                if assignment.expense_item_id not in assignments_by_item:
                    assignments_by_item[assignment.expense_item_id] = []
                assignments_by_item[assignment.expense_item_id].append(assignment)

                if assignment.is_guest:
                    guest_ids.add(assignment.user_id)
                else:
                    user_ids.add(assignment.user_id)

            # Group items by expense
            for item in all_items:
                if item.expense_id not in items_by_expense:
                    items_by_expense[item.expense_id] = []

                # Attach pre-fetched assignments to item object for later use
                # (We'll use a temporary attribute _assignments on the object or just match by ID)
                item._assignments = assignments_by_item.get(item.id, [])
                items_by_expense[item.expense_id].append(item)

    # Batch fetch users and guests
    users = {}
    if user_ids:
        user_records = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
        users = {u.id: u for u in user_records}

    guests = {}
    if guest_ids:
        guest_records = db.query(models.GuestMember).filter(models.GuestMember.id.in_(guest_ids)).all()
        guests = {g.id: g for g in guest_records}

        # Batch fetch claimed users for guests to avoid N+1 queries in get_guest_display_name
        claimed_ids = {g.claimed_by_id for g in guest_records if g.claimed_by_id}
        missing_claimed_ids = claimed_ids - set(users.keys())
        if missing_claimed_ids:
            claimed_users = db.query(models.User).filter(models.User.id.in_(missing_claimed_ids)).all()
            for u in claimed_users:
                users[u.id] = u

    # Construct result
    result = []
    for expense in expenses:
        # Build splits with user names
        splits_with_names = []
        expense_splits = splits_by_expense.get(expense.id, [])

        for split in expense_splits:
            if split.is_guest:
                guest = guests.get(split.user_id)
                if guest:
                    if guest.claimed_by_id and guest.claimed_by_id in users:
                        u = users[guest.claimed_by_id]
                        user_name = get_public_user_display_name(u)
                    else:
                        user_name = guest.name
                else:
                    user_name = "Unknown Guest"
            else:
                user = users.get(split.user_id)
                user_name = get_public_user_display_name(user) if user else "Unknown User"

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
            expense_items = items_by_expense.get(expense.id, [])

            for item in expense_items:
                assignment_details = []
                # Use the _assignments attribute we attached earlier
                assignments = getattr(item, '_assignments', [])

                for a in assignments:
                    if a.is_guest:
                        guest = guests.get(a.user_id)
                        if guest:
                            if guest.claimed_by_id and guest.claimed_by_id in users:
                                u = users[guest.claimed_by_id]
                                name = get_public_user_display_name(u)
                            else:
                                name = guest.name
                        else:
                            name = "Unknown Guest"
                    else:
                        user = users.get(a.user_id)
                        name = get_public_user_display_name(user) if user else "Unknown"

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

    # Batch fetch splits for all expenses
    expense_ids = [e.id for e in expenses]
    splits_by_expense = {}
    if expense_ids:
        all_splits = db.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id.in_(expense_ids)
        ).all()
        for split in all_splits:
            if split.expense_id not in splits_by_expense:
                splits_by_expense[split.expense_id] = []
            splits_by_expense[split.expense_id].append(split)

    # Calculate net balances per participant (keyed by (id, is_guest) tuple)
    net_balances = {}  # (user_id, is_guest) -> {currency -> amount}

    for expense in expenses:
        splits = splits_by_expense.get(expense.id, [])

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

    # Get all managed members in this group
    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group.id,
        models.GroupMember.managed_by_id != None
    ).all()

    # Track which guests/members were aggregated with which managers (for breakdown display)
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

                # Get the display name - use User's full_name if claimed, otherwise guest name
                display_name = get_guest_display_name(guest, db)

                breakdown_key = (guest.managed_by_id, manager_is_guest, currency)
                if breakdown_key not in manager_guest_breakdown:
                    manager_guest_breakdown[breakdown_key] = []
                manager_guest_breakdown[breakdown_key].append((display_name, amount))

            del net_balances[guest_key]

    # Batch fetch users for managed members
    managed_user_ids = {m.user_id for m in managed_members}
    managed_users_map = {}
    if managed_user_ids:
        managed_users = db.query(models.User).filter(models.User.id.in_(managed_user_ids)).all()
        managed_users_map = {u.id: u for u in managed_users}

    # Aggregate managed member balances with their managers
    for managed_member in managed_members:
        member_key = (managed_member.user_id, False)
        manager_is_guest = (managed_member.managed_by_type == 'guest')
        manager_key = (managed_member.managed_by_id, manager_is_guest)

        if member_key in net_balances:
            member_currencies = net_balances[member_key]
            for currency, amount in member_currencies.items():
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                if currency not in net_balances[manager_key]:
                    net_balances[manager_key][currency] = 0

                net_balances[manager_key][currency] += amount

                # Get member name for breakdown
                member_user = managed_users_map.get(managed_member.user_id)
                member_name = get_public_user_display_name(member_user) if member_user else "Unknown Member"

                breakdown_key = (managed_member.managed_by_id, manager_is_guest, currency)
                if breakdown_key not in manager_guest_breakdown:
                    manager_guest_breakdown[breakdown_key] = []
                manager_guest_breakdown[breakdown_key].append((member_name, amount))

            del net_balances[member_key]

    from utils.currency import format_currency  # Import here to avoid circular dependencies if any, though likely fine at top

    # Batch fetch remaining participants (Users and GuestMembers)
    user_ids_to_fetch = set()
    guest_ids_to_fetch = set()

    for participant_id, is_guest in net_balances.keys():
        if is_guest:
            guest_ids_to_fetch.add(participant_id)
        else:
            user_ids_to_fetch.add(participant_id)

    users_map = {}
    if user_ids_to_fetch:
        users = db.query(models.User).filter(models.User.id.in_(user_ids_to_fetch)).all()
        users_map = {u.id: u for u in users}

    guests_map = {}
    if guest_ids_to_fetch:
        guests = db.query(models.GuestMember).filter(models.GuestMember.id.in_(guest_ids_to_fetch)).all()
        guests_map = {g.id: g for g in guests}

        # Also need to resolve names for guests which might require claimed user fetching
        claimed_ids = {g.claimed_by_id for g in guests if g.claimed_by_id}
        # Add to users_map if not already there (though likely distinct set from user_ids_to_fetch)
        missing_claimed_ids = claimed_ids - set(users_map.keys())
        if missing_claimed_ids:
            claimed_users = db.query(models.User).filter(models.User.id.in_(missing_claimed_ids)).all()
            for u in claimed_users:
                users_map[u.id] = u

    # Build response with participant details
    result = []
    for (participant_id, is_guest), currencies in net_balances.items():
        if is_guest:
            guest = guests_map.get(participant_id)
            if guest:
                if guest.claimed_by_id and guest.claimed_by_id in users_map:
                    u = users_map[guest.claimed_by_id]
                    name = get_public_user_display_name(u)
                else:
                    name = guest.name
            else:
                name = "Unknown Guest"
        else:
            user = users_map.get(participant_id)
            name = get_public_user_display_name(user) if user else "Unknown User"

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

    # Collect user/guest IDs for batch fetching
    user_ids = set()
    guest_ids = set()

    for split in splits:
        if split.is_guest:
            guest_ids.add(split.user_id)
        else:
            user_ids.add(split.user_id)

    # Fetch items and assignments if itemized
    expense_items = []
    assignments_by_item = {}

    if expense.split_type == "ITEMIZED":
        expense_items = db.query(models.ExpenseItem).filter(
            models.ExpenseItem.expense_id == expense.id
        ).all()

        if expense_items:
            item_ids = [i.id for i in expense_items]
            all_assignments = db.query(models.ExpenseItemAssignment).filter(
                models.ExpenseItemAssignment.expense_item_id.in_(item_ids)
            ).all()

            for a in all_assignments:
                if a.expense_item_id not in assignments_by_item:
                    assignments_by_item[a.expense_item_id] = []
                assignments_by_item[a.expense_item_id].append(a)

                if a.is_guest:
                    guest_ids.add(a.user_id)
                else:
                    user_ids.add(a.user_id)

    # Batch fetch users
    users = {}
    if user_ids:
        user_records = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
        users = {u.id: u for u in user_records}

    # Batch fetch guests
    guests = {}
    if guest_ids:
        guest_records = db.query(models.GuestMember).filter(models.GuestMember.id.in_(guest_ids)).all()
        guests = {g.id: g for g in guest_records}

        # Batch fetch claimed users for guests
        claimed_ids = {g.claimed_by_id for g in guest_records if g.claimed_by_id}
        missing_claimed_ids = claimed_ids - set(users.keys())
        if missing_claimed_ids:
            claimed_users = db.query(models.User).filter(models.User.id.in_(missing_claimed_ids)).all()
            for u in claimed_users:
                users[u.id] = u

    splits_with_names = []
    for split in splits:
        if split.is_guest:
            guest = guests.get(split.user_id)
            if guest:
                if guest.claimed_by_id and guest.claimed_by_id in users:
                    u = users[guest.claimed_by_id]
                    user_name = get_public_user_display_name(u)
                else:
                    user_name = guest.name
            else:
                user_name = "Unknown Guest"
        else:
            user = users.get(split.user_id)
            user_name = get_public_user_display_name(user) if user else "Unknown User"

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

    # Build items data
    items_data = []
    if expense.split_type == "ITEMIZED":
        for item in expense_items:
            assignment_details = []
            assignments = assignments_by_item.get(item.id, [])

            for a in assignments:
                if a.is_guest:
                    guest = guests.get(a.user_id)
                    if guest:
                        if guest.claimed_by_id and guest.claimed_by_id in users:
                            u = users[guest.claimed_by_id]
                            name = get_public_user_display_name(u)
                        else:
                            name = guest.name
                    else:
                        name = "Unknown Guest"
                else:
                    user = users.get(a.user_id)
                    name = get_public_user_display_name(user) if user else "Unknown"

                assignment_details.append(schemas.ExpenseItemAssignmentDetail(
                    user_id=a.user_id,
                    is_guest=a.is_guest,
                    user_name=name
                ))

            # Deserialize split_details from JSON if present
            split_details = None
            if item.split_details:
                try:
                    split_details = json.loads(item.split_details)
                except json.JSONDecodeError:
                    split_details = None

            items_data.append(schemas.ExpenseItemDetail(
                id=item.id,
                expense_id=item.expense_id,
                description=item.description,
                price=item.price,
                is_tax_tip=item.is_tax_tip,
                assignments=assignment_details,
                split_type=item.split_type or 'EQUAL',
                split_details=split_details
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
