"""Friends router: manage friend relationships."""

from typing import Annotated
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
import asyncio

import models
import schemas
from database import get_db
from dependencies import get_current_user
from utils.validation import get_user_by_email
from utils.display import get_guest_display_name
from utils.email import send_friend_request_email


router = APIRouter(prefix="/friends", tags=["friends"])


def verify_friendship(db: Session, current_user_id: int, friend_id: int) -> models.User:
    """Verify that a friendship exists between current user and friend_id.
    Returns the friend user object if friendship exists, raises 404 otherwise.
    """
    friendship = db.query(models.Friendship).filter(
        or_(
            and_(models.Friendship.user_id1 == current_user_id, models.Friendship.user_id2 == friend_id),
            and_(models.Friendship.user_id1 == friend_id, models.Friendship.user_id2 == current_user_id)
        )
    ).first()

    if not friendship:
        raise HTTPException(status_code=404, detail="Friend not found")

    friend = db.query(models.User).filter(models.User.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="Friend not found")

    return friend


@router.post("/request", response_model=schemas.FriendRequestResponse)
async def send_friend_request(
    request: schemas.FriendRequestCreate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Send a friend request to another user by their ID."""
    if request.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot send friend request to yourself")

    # Check target user exists
    target_user = db.query(models.User).filter(models.User.id == request.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if already friends
    existing_friendship = db.query(models.Friendship).filter(
        or_(
            and_(models.Friendship.user_id1 == current_user.id, models.Friendship.user_id2 == request.user_id),
            and_(models.Friendship.user_id1 == request.user_id, models.Friendship.user_id2 == current_user.id)
        )
    ).first()
    if existing_friendship:
        raise HTTPException(status_code=400, detail="Already friends with this user")

    # Check if there's already a pending request (in either direction)
    existing_request = db.query(models.FriendRequest).filter(
        models.FriendRequest.status == "pending",
        or_(
            and_(models.FriendRequest.from_user_id == current_user.id, models.FriendRequest.to_user_id == request.user_id),
            and_(models.FriendRequest.from_user_id == request.user_id, models.FriendRequest.to_user_id == current_user.id)
        )
    ).first()
    if existing_request:
        raise HTTPException(status_code=400, detail="Friend request already pending")

    # Create new request
    new_request = models.FriendRequest(
        from_user_id=current_user.id,
        to_user_id=request.user_id,
        status="pending"
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    # Send email notification (async, don't wait for result to avoid blocking)
    asyncio.create_task(
        send_friend_request_email(
            target_user.email,
            target_user.full_name or target_user.email,
            current_user.full_name or current_user.email
        )
    )

    return schemas.FriendRequestResponse(
        id=new_request.id,
        from_user_id=current_user.id,
        from_user_name=current_user.full_name or current_user.email,
        from_user_email=current_user.email,
        to_user_id=target_user.id,
        to_user_name=target_user.full_name or target_user.email,
        to_user_email=target_user.email,
        status=new_request.status,
        created_at=new_request.created_at.isoformat()
    )


@router.get("/requests/incoming", response_model=list[schemas.FriendRequestResponse])
def get_incoming_requests(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Get all pending incoming friend requests."""
    requests = db.query(models.FriendRequest).filter(
        models.FriendRequest.to_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).order_by(models.FriendRequest.created_at.desc()).all()
    
    if not requests:
        return []
    
    # Batch fetch sender users
    user_ids = [r.from_user_id for r in requests]
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
    users_map = {u.id: u for u in users}
    
    result = []
    for req in requests:
        from_user = users_map.get(req.from_user_id)
        result.append(schemas.FriendRequestResponse(
            id=req.id,
            from_user_id=req.from_user_id,
            from_user_name=from_user.full_name or from_user.email if from_user else "Unknown",
            from_user_email=from_user.email if from_user else "",
            to_user_id=current_user.id,
            to_user_name=current_user.full_name or current_user.email,
            to_user_email=current_user.email,
            status=req.status,
            created_at=req.created_at.isoformat()
        ))
    return result


@router.get("/requests/outgoing", response_model=list[schemas.FriendRequestResponse])
def get_outgoing_requests(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Get all pending outgoing friend requests."""
    requests = db.query(models.FriendRequest).filter(
        models.FriendRequest.from_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).order_by(models.FriendRequest.created_at.desc()).all()
    
    if not requests:
        return []
    
    # Batch fetch target users
    user_ids = [r.to_user_id for r in requests]
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
    users_map = {u.id: u for u in users}
    
    result = []
    for req in requests:
        to_user = users_map.get(req.to_user_id)
        result.append(schemas.FriendRequestResponse(
            id=req.id,
            from_user_id=current_user.id,
            from_user_name=current_user.full_name or current_user.email,
            from_user_email=current_user.email,
            to_user_id=req.to_user_id,
            to_user_name=to_user.full_name or to_user.email if to_user else "Unknown",
            to_user_email=to_user.email if to_user else "",
            status=req.status,
            created_at=req.created_at.isoformat()
        ))
    return result


@router.get("/requests/count", response_model=schemas.PendingRequestCount)
def get_pending_request_count(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Get count of pending incoming friend requests (for badge)."""
    count = db.query(models.FriendRequest).filter(
        models.FriendRequest.to_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).count()
    return schemas.PendingRequestCount(count=count)


@router.post("/requests/{request_id}/accept", response_model=schemas.Friend)
def accept_friend_request(
    request_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Accept a pending friend request."""
    friend_request = db.query(models.FriendRequest).filter(
        models.FriendRequest.id == request_id,
        models.FriendRequest.to_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).first()
    
    if not friend_request:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    # Create friendship
    new_friendship = models.Friendship(
        user_id1=friend_request.from_user_id,
        user_id2=current_user.id
    )
    db.add(new_friendship)
    
    # Update request status
    friend_request.status = "accepted"
    db.commit()
    
    # Return the new friend
    friend = db.query(models.User).filter(models.User.id == friend_request.from_user_id).first()
    return friend


@router.post("/requests/{request_id}/reject")
def reject_friend_request(
    request_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Reject a pending friend request."""
    friend_request = db.query(models.FriendRequest).filter(
        models.FriendRequest.id == request_id,
        models.FriendRequest.to_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).first()
    
    if not friend_request:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    friend_request.status = "rejected"
    db.commit()
    
    return {"message": "Friend request rejected"}


@router.delete("/requests/{request_id}")
def cancel_friend_request(
    request_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Cancel an outgoing friend request."""
    friend_request = db.query(models.FriendRequest).filter(
        models.FriendRequest.id == request_id,
        models.FriendRequest.from_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).first()
    
    if not friend_request:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    db.delete(friend_request)
    db.commit()
    
    return {"message": "Friend request cancelled"}


@router.get("/status/{user_id}", response_model=schemas.FriendshipStatus)
def get_friendship_status(
    user_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Check relationship status with another user."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot check status with yourself")
    
    # Get user info
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if friends
    friendship = db.query(models.Friendship).filter(
        or_(
            and_(models.Friendship.user_id1 == current_user.id, models.Friendship.user_id2 == user_id),
            and_(models.Friendship.user_id1 == user_id, models.Friendship.user_id2 == current_user.id)
        )
    ).first()
    
    if friendship:
        return schemas.FriendshipStatus(
            user_id=user_id,
            full_name=user.full_name or user.email,
            email=user.email,
            status="friends"
        )
    
    # Check for pending request from current user
    outgoing = db.query(models.FriendRequest).filter(
        models.FriendRequest.from_user_id == current_user.id,
        models.FriendRequest.to_user_id == user_id,
        models.FriendRequest.status == "pending"
    ).first()
    
    if outgoing:
        return schemas.FriendshipStatus(
            user_id=user_id,
            full_name=user.full_name or user.email,
            email=user.email,
            status="pending_outgoing",
            request_id=outgoing.id
        )
    
    # Check for pending request to current user
    incoming = db.query(models.FriendRequest).filter(
        models.FriendRequest.from_user_id == user_id,
        models.FriendRequest.to_user_id == current_user.id,
        models.FriendRequest.status == "pending"
    ).first()
    
    if incoming:
        return schemas.FriendshipStatus(
            user_id=user_id,
            full_name=user.full_name or user.email,
            email=user.email,
            status="pending_incoming",
            request_id=incoming.id
        )
    
    # No relationship
    return schemas.FriendshipStatus(
        user_id=user_id,
        full_name=user.full_name or user.email,
        email=user.email,
        status="none"
    )


@router.post("", response_model=schemas.Friend)
def add_friend(
    friend_request: schemas.FriendAddRequest, 
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    """Add friend by email (legacy - creates direct friendship)."""
    friend_user = get_user_by_email(db, friend_request.email)
    if not friend_user:
        raise HTTPException(status_code=404, detail="User not found")

    if friend_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself as friend")

    # Check if already friends
    existing = db.query(models.Friendship).filter(
        ((models.Friendship.user_id1 == current_user.id) & (models.Friendship.user_id2 == friend_user.id)) |
        ((models.Friendship.user_id1 == friend_user.id) & (models.Friendship.user_id2 == current_user.id))
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Already friends")

    new_friendship = models.Friendship(user_id1=current_user.id, user_id2=friend_user.id)
    db.add(new_friendship)
    db.commit()

    return friend_user


@router.get("", response_model=list[schemas.Friend])
def read_friends(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    # Find all friendships involving current_user
    friendships = db.query(models.Friendship).filter(
        (models.Friendship.user_id1 == current_user.id) | (models.Friendship.user_id2 == current_user.id)
    ).all()

    friends = []
    for f in friendships:
        friend_id = f.user_id2 if f.user_id1 == current_user.id else f.user_id1
        friend = db.query(models.User).filter(models.User.id == friend_id).first()
        if friend:
            friends.append(friend)

    return friends


@router.get("/{friend_id}", response_model=schemas.Friend)
def get_friend(
    friend_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Get details of a specific friend."""
    friend = verify_friendship(db, current_user.id, friend_id)
    return friend


@router.get("/{friend_id}/expenses", response_model=list[schemas.FriendExpenseWithSplits])
def get_friend_expenses(
    friend_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Get all expenses shared between current user and a friend.
    Includes both group expenses and direct (non-group) expenses.
    Also includes expenses where managed members/guests are involved.
    """
    friend = verify_friendship(db, current_user.id, friend_id)

    # Find groups where both users are members
    current_user_groups = db.query(models.GroupMember.group_id).filter(
        models.GroupMember.user_id == current_user.id
    ).subquery()
    
    friend_groups = db.query(models.GroupMember.group_id).filter(
        models.GroupMember.user_id == friend_id
    ).subquery()
    
    shared_group_ids = db.query(models.GroupMember.group_id).filter(
        models.GroupMember.group_id.in_(current_user_groups),
        models.GroupMember.group_id.in_(friend_groups)
    ).distinct().all()
    shared_group_ids = [g[0] for g in shared_group_ids]

    # Build the set of IDs that represent "current user's side"
    current_user_ids = {(current_user.id, False)}  # (id, is_guest)
    
    # Build the set of IDs that represent "friend's side"
    friend_ids_set = {(friend_id, False)}  # (id, is_guest)

    if shared_group_ids:
        # Get guests managed by current user in shared groups
        current_user_managed_guests = db.query(models.GuestMember).filter(
            models.GuestMember.group_id.in_(shared_group_ids),
            models.GuestMember.managed_by_id == current_user.id,
            models.GuestMember.managed_by_type == 'user',
            models.GuestMember.claimed_by_id == None
        ).all()
        for guest in current_user_managed_guests:
            current_user_ids.add((guest.id, True))
        
        # Get members managed by current user in shared groups
        current_user_managed_members = db.query(models.GroupMember).filter(
            models.GroupMember.group_id.in_(shared_group_ids),
            models.GroupMember.managed_by_id == current_user.id,
            models.GroupMember.managed_by_type == 'user'
        ).all()
        for member in current_user_managed_members:
            current_user_ids.add((member.user_id, False))
        
        # Get guests managed by friend in shared groups
        friend_managed_guests = db.query(models.GuestMember).filter(
            models.GuestMember.group_id.in_(shared_group_ids),
            models.GuestMember.managed_by_id == friend_id,
            models.GuestMember.managed_by_type == 'user',
            models.GuestMember.claimed_by_id == None
        ).all()
        for guest in friend_managed_guests:
            friend_ids_set.add((guest.id, True))
        
        # Get members managed by friend in shared groups
        friend_managed_members = db.query(models.GroupMember).filter(
            models.GroupMember.group_id.in_(shared_group_ids),
            models.GroupMember.managed_by_id == friend_id,
            models.GroupMember.managed_by_type == 'user'
        ).all()
        for member in friend_managed_members:
            friend_ids_set.add((member.user_id, False))

    # Build subqueries for expenses involving each side
    current_side_conditions = []
    for uid, is_guest in current_user_ids:
        current_side_conditions.append(
            and_(models.ExpenseSplit.user_id == uid, models.ExpenseSplit.is_guest == is_guest)
        )
    
    current_side_split_expenses = db.query(models.ExpenseSplit.expense_id).filter(
        or_(*current_side_conditions)
    ).subquery()

    friend_side_conditions = []
    for uid, is_guest in friend_ids_set:
        friend_side_conditions.append(
            and_(models.ExpenseSplit.user_id == uid, models.ExpenseSplit.is_guest == is_guest)
        )
    
    friend_side_split_expenses = db.query(models.ExpenseSplit.expense_id).filter(
        or_(*friend_side_conditions)
    ).subquery()

    # Build payer conditions for each side
    current_side_payer_conditions = []
    for uid, is_guest in current_user_ids:
        current_side_payer_conditions.append(
            and_(models.Expense.payer_id == uid, models.Expense.payer_is_guest == is_guest)
        )
    
    friend_side_payer_conditions = []
    for uid, is_guest in friend_ids_set:
        friend_side_payer_conditions.append(
            and_(models.Expense.payer_id == uid, models.Expense.payer_is_guest == is_guest)
        )

    # Find expenses where one side paid AND the other side is in splits
    expenses = db.query(models.Expense).filter(
        or_(
            # Current side paid AND friend side is in splits
            and_(
                or_(*current_side_payer_conditions),
                models.Expense.id.in_(friend_side_split_expenses)
            ),
            # Friend side paid AND current side is in splits
            and_(
                or_(*friend_side_payer_conditions),
                models.Expense.id.in_(current_side_split_expenses)
            )
        )
    ).order_by(models.Expense.date.desc(), models.Expense.id.desc()).all()

    if not expenses:
        return []

    expense_ids = [e.id for e in expenses]

    # Batch fetch all splits
    all_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.expense_id.in_(expense_ids)
    ).all()

    splits_by_expense = defaultdict(list)
    user_ids = set()
    guest_ids = set()

    for split in all_splits:
        splits_by_expense[split.expense_id].append(split)
        if split.is_guest:
            guest_ids.add(split.user_id)
        else:
            user_ids.add(split.user_id)

    # Batch fetch groups
    group_ids = {e.group_id for e in expenses if e.group_id}
    groups_map = {}
    if group_ids:
        groups = db.query(models.Group).filter(models.Group.id.in_(group_ids)).all()
        groups_map = {g.id: g for g in groups}

    # Batch fetch items for ITEMIZED expenses
    itemized_expense_ids = [e.id for e in expenses if e.split_type == "ITEMIZED"]
    items_by_expense = defaultdict(list)

    if itemized_expense_ids:
        items = db.query(models.ExpenseItem).filter(
            models.ExpenseItem.expense_id.in_(itemized_expense_ids)
        ).all()

        if items:
            item_ids = [i.id for i in items]
            assignments = db.query(models.ExpenseItemAssignment).filter(
                models.ExpenseItemAssignment.expense_item_id.in_(item_ids)
            ).all()

            assignments_by_item = defaultdict(list)
            for a in assignments:
                assignments_by_item[a.expense_item_id].append(a)
                if a.is_guest:
                    guest_ids.add(a.user_id)
                else:
                    user_ids.add(a.user_id)

            for item in items:
                # Attach assignments to item for easier access later
                item._assignments = assignments_by_item[item.id]
                items_by_expense[item.expense_id].append(item)

    # Batch fetch guests
    guests_map = {}
    if guest_ids:
        guests = db.query(models.GuestMember).filter(models.GuestMember.id.in_(guest_ids)).all()
        guests_map = {g.id: g for g in guests}

        # Collect claimed users
        claimed_user_ids = {g.claimed_by_id for g in guests if g.claimed_by_id}
        user_ids.update(claimed_user_ids)

    # Batch fetch users
    users_map = {}
    if user_ids:
        users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
        users_map = {u.id: u for u in users}

    result = []
    for expense in expenses:
        # Get splits with user names
        splits = splits_by_expense[expense.id]

        splits_with_names = []
        for split in splits:
            if split.is_guest:
                guest = guests_map.get(split.user_id)
                if guest:
                    if guest.claimed_by_id and guest.claimed_by_id in users_map:
                        u = users_map[guest.claimed_by_id]
                        user_name = u.full_name or u.email
                    else:
                        user_name = guest.name
                else:
                    user_name = "Unknown Guest"
            else:
                user = users_map.get(split.user_id)
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

        # Get group name if expense is in a group
        group_name = None
        if expense.group_id:
            group = groups_map.get(expense.group_id)
            group_name = group.name if group else None

        # Load items for ITEMIZED expenses
        items_data = []
        split_type = expense.split_type or "EQUAL"
        if split_type == "ITEMIZED":
            expense_items = items_by_expense.get(expense.id, [])

            for item in expense_items:
                assignments = getattr(item, '_assignments', [])

                assignment_details = []
                for a in assignments:
                    if a.is_guest:
                        guest = guests_map.get(a.user_id)
                        if guest:
                            if guest.claimed_by_id and guest.claimed_by_id in users_map:
                                u = users_map[guest.claimed_by_id]
                                name = u.full_name or u.email
                            else:
                                name = guest.name
                        else:
                            name = "Unknown Guest"
                    else:
                        user = users_map.get(a.user_id)
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

        # Calculate balance impact for this expense
        # Sum what friend side owes
        friend_side_owed = sum(
            s.amount_owed for s in splits 
            if (s.user_id, s.is_guest) in friend_ids_set
        )
        # Sum what current user side owes
        current_side_owed = sum(
            s.amount_owed for s in splits 
            if (s.user_id, s.is_guest) in current_user_ids
        )
        
        # Determine balance impact based on who paid
        payer_key = (expense.payer_id, expense.payer_is_guest)
        if payer_key in current_user_ids:
            # Current user side paid - friend side owes their split
            balance_impact = friend_side_owed
        elif payer_key in friend_ids_set:
            # Friend side paid - current user side owes (negative)
            balance_impact = -current_side_owed
        else:
            balance_impact = 0

        result.append(schemas.FriendExpenseWithSplits(
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
            notes=expense.notes,
            group_name=group_name,
            balance_impact=balance_impact
        ))

    return result


@router.get("/{friend_id}/balance", response_model=list[schemas.FriendBalance])
def get_friend_balance(
    friend_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Calculate the net balance between current user and a friend.
    Positive amount = friend owes you, Negative = you owe friend.
    Returns a list of balances grouped by currency.
    
    Includes balances from managed members/guests in shared groups.
    """
    friend = verify_friendship(db, current_user.id, friend_id)

    # Find groups where both users are members
    current_user_groups = db.query(models.GroupMember.group_id).filter(
        models.GroupMember.user_id == current_user.id
    ).subquery()
    
    friend_groups = db.query(models.GroupMember.group_id).filter(
        models.GroupMember.user_id == friend_id
    ).subquery()
    
    shared_group_ids = db.query(models.GroupMember.group_id).filter(
        models.GroupMember.group_id.in_(current_user_groups),
        models.GroupMember.group_id.in_(friend_groups)
    ).distinct().all()
    shared_group_ids = [g[0] for g in shared_group_ids]

    # Build the set of IDs that represent "current user's side"
    # (current user + guests/members they manage in shared groups)
    current_user_ids = {(current_user.id, False)}  # (id, is_guest)
    
    # Build the set of IDs that represent "friend's side"
    friend_ids = {(friend_id, False)}  # (id, is_guest)

    if shared_group_ids:
        # Get guests managed by current user in shared groups
        current_user_managed_guests = db.query(models.GuestMember).filter(
            models.GuestMember.group_id.in_(shared_group_ids),
            models.GuestMember.managed_by_id == current_user.id,
            models.GuestMember.managed_by_type == 'user',
            models.GuestMember.claimed_by_id == None  # Only unclaimed guests
        ).all()
        for guest in current_user_managed_guests:
            current_user_ids.add((guest.id, True))
        
        # Get members managed by current user in shared groups
        current_user_managed_members = db.query(models.GroupMember).filter(
            models.GroupMember.group_id.in_(shared_group_ids),
            models.GroupMember.managed_by_id == current_user.id,
            models.GroupMember.managed_by_type == 'user'
        ).all()
        for member in current_user_managed_members:
            current_user_ids.add((member.user_id, False))
        
        # Get guests managed by friend in shared groups
        friend_managed_guests = db.query(models.GuestMember).filter(
            models.GuestMember.group_id.in_(shared_group_ids),
            models.GuestMember.managed_by_id == friend_id,
            models.GuestMember.managed_by_type == 'user',
            models.GuestMember.claimed_by_id == None
        ).all()
        for guest in friend_managed_guests:
            friend_ids.add((guest.id, True))
        
        # Get members managed by friend in shared groups
        friend_managed_members = db.query(models.GroupMember).filter(
            models.GroupMember.group_id.in_(shared_group_ids),
            models.GroupMember.managed_by_id == friend_id,
            models.GroupMember.managed_by_type == 'user'
        ).all()
        for member in friend_managed_members:
            friend_ids.add((member.user_id, False))

    # Build subqueries for expenses involving each side
    # Current user side: expenses where any of current_user_ids is in splits
    current_side_conditions = []
    for uid, is_guest in current_user_ids:
        current_side_conditions.append(
            and_(models.ExpenseSplit.user_id == uid, models.ExpenseSplit.is_guest == is_guest)
        )
    
    current_side_split_expenses = db.query(models.ExpenseSplit.expense_id).filter(
        or_(*current_side_conditions)
    ).subquery()

    # Friend side: expenses where any of friend_ids is in splits
    friend_side_conditions = []
    for uid, is_guest in friend_ids:
        friend_side_conditions.append(
            and_(models.ExpenseSplit.user_id == uid, models.ExpenseSplit.is_guest == is_guest)
        )
    
    friend_side_split_expenses = db.query(models.ExpenseSplit.expense_id).filter(
        or_(*friend_side_conditions)
    ).subquery()

    # Build payer conditions for each side
    current_side_payer_conditions = []
    for uid, is_guest in current_user_ids:
        current_side_payer_conditions.append(
            and_(models.Expense.payer_id == uid, models.Expense.payer_is_guest == is_guest)
        )
    
    friend_side_payer_conditions = []
    for uid, is_guest in friend_ids:
        friend_side_payer_conditions.append(
            and_(models.Expense.payer_id == uid, models.Expense.payer_is_guest == is_guest)
        )

    # Find expenses where one side paid AND the other side is in splits
    expenses = db.query(models.Expense).filter(
        or_(
            # Current side paid AND friend side is in splits
            and_(
                or_(*current_side_payer_conditions),
                models.Expense.id.in_(friend_side_split_expenses)
            ),
            # Friend side paid AND current side is in splits
            and_(
                or_(*friend_side_payer_conditions),
                models.Expense.id.in_(current_side_split_expenses)
            )
        )
    ).all()

    if not expenses:
        return []

    # Batch fetch splits
    expense_ids = [e.id for e in expenses]
    splits_by_expense = defaultdict(list)
    if expense_ids:
        all_splits = db.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id.in_(expense_ids)
        ).all()
        for s in all_splits:
            splits_by_expense[s.expense_id].append(s)

    # Calculate balance per currency
    # Positive = friend side owes current user side, Negative = current user side owes friend side
    balances: dict[str, float] = defaultdict(float)

    for expense in expenses:
        currency = expense.currency
        splits = splits_by_expense[expense.id]

        # Sum what friend side owes in this expense
        friend_side_owed = sum(
            s.amount_owed for s in splits 
            if (s.user_id, s.is_guest) in friend_ids
        )
        
        # Sum what current user side owes in this expense
        current_side_owed = sum(
            s.amount_owed for s in splits 
            if (s.user_id, s.is_guest) in current_user_ids
        )

        payer_key = (expense.payer_id, expense.payer_is_guest)
        
        if payer_key in current_user_ids:
            # Current user side paid - friend side owes their split amount
            balances[currency] += friend_side_owed / 100.0
        elif payer_key in friend_ids:
            # Friend side paid - current user side owes their split amount
            balances[currency] -= current_side_owed / 100.0

    # Convert to list of FriendBalance objects, excluding zero balances
    result = [
        schemas.FriendBalance(amount=amount, currency=currency)
        for currency, amount in balances.items()
        if abs(amount) > 0.01  # Filter out near-zero balances
    ]

    # Sort by currency for consistent ordering
    result.sort(key=lambda x: x.currency)

    return result
