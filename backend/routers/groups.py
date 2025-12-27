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
