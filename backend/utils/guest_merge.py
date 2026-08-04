"""
Folding a guest's history onto a real account.

Two things want this. Claiming is somebody saying "that guest was me", and
merging is the group owner saying "that guest was them" — after a person joined
with their own account instead of taking the guest's seat, so the group holds
two of them. Both end the same way: every expense, split and item the guest was
in now belongs to a user id, and the guest row survives only as the record of
who absorbed it.

The one thing claiming never had to think about is a collision. When the target
is already on an expense the guest was on, moving the guest's row would leave
that expense with two splits for one person — which the balance maths would
still add up correctly, but every screen that keys participants by id would show
the person twice and let an edit clobber one row with the other. So the two are
summed into a single split instead.
"""

from typing import Dict

from sqlalchemy.orm import Session

import models


def absorb_guest_into_user(db: Session, guest: models.GuestMember, user_id: int) -> Dict[str, int]:
    """
    Move everything a guest was part of onto ``user_id``.

    Does not commit, and does not touch ``guest.claimed_by_id`` — the caller
    decides what the guest row means afterwards and when the transaction ends.

    Returns counts of what moved, keyed for the caller's response body.
    """
    counts = {
        "expenses_transferred": 0,
        "splits_moved": 0,
        "splits_merged": 0,
        "items_moved": 0,
        "items_merged": 0,
        "managed_guests_updated": 0,
        "managed_members_updated": 0,
    }

    # ---------------------------------------------------------------- payer
    counts["expenses_transferred"] = db.query(models.Expense).filter(
        models.Expense.payer_id == guest.id,
        models.Expense.payer_is_guest == True
    ).update({"payer_id": user_id, "payer_is_guest": False})

    # --------------------------------------------------------------- splits
    guest_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == guest.id,
        models.ExpenseSplit.is_guest == True
    ).all()

    # The target's existing splits on those same expenses — the collisions.
    existing_splits: Dict[int, models.ExpenseSplit] = {}
    if guest_splits:
        for split in db.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id.in_([s.expense_id for s in guest_splits]),
            models.ExpenseSplit.user_id == user_id,
            models.ExpenseSplit.is_guest == False
        ).all():
            existing_splits.setdefault(split.expense_id, split)

    for split in guest_splits:
        target = existing_splits.get(split.expense_id)
        if target is None:
            split.user_id = user_id
            split.is_guest = False
            # A later guest split on the same expense (possible if the guest
            # somehow has two) now collides with this one.
            existing_splits[split.expense_id] = split
            counts["splits_moved"] += 1
            continue

        # One person, one line: add the guest's share to the account's own.
        target.amount_owed = (target.amount_owed or 0) + (split.amount_owed or 0)
        if target.percentage is not None or split.percentage is not None:
            target.percentage = (target.percentage or 0) + (split.percentage or 0)
        if target.shares is not None or split.shares is not None:
            target.shares = (target.shares or 0) + (split.shares or 0)
        db.delete(split)
        counts["splits_merged"] += 1

    # ---------------------------------------------- itemized assignments
    guest_assignments = db.query(models.ExpenseItemAssignment).filter(
        models.ExpenseItemAssignment.user_id == guest.id,
        models.ExpenseItemAssignment.is_guest == True
    ).all()

    already_assigned = set()
    if guest_assignments:
        already_assigned = {
            assignment.expense_item_id
            for assignment in db.query(models.ExpenseItemAssignment).filter(
                models.ExpenseItemAssignment.expense_item_id.in_(
                    [a.expense_item_id for a in guest_assignments]
                ),
                models.ExpenseItemAssignment.user_id == user_id,
                models.ExpenseItemAssignment.is_guest == False
            ).all()
        }

    for assignment in guest_assignments:
        if assignment.expense_item_id in already_assigned:
            # Being on a line twice would give the person a double share of it.
            db.delete(assignment)
            counts["items_merged"] += 1
        else:
            assignment.user_id = user_id
            assignment.is_guest = False
            already_assigned.add(assignment.expense_item_id)
            counts["items_moved"] += 1

    # ------------------------------------------------ inherited management
    # Anyone this guest settled up for is now settled up for by the account.
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.managed_by_id == guest.id,
        models.GuestMember.managed_by_type == 'guest'
    ).all()
    for managed_guest in managed_guests:
        managed_guest.managed_by_id = user_id
        managed_guest.managed_by_type = 'user'
        counts["managed_guests_updated"] += 1

    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.managed_by_id == guest.id,
        models.GroupMember.managed_by_type == 'guest'
    ).all()
    for managed_member in managed_members:
        if managed_member.user_id == user_id:
            # The account was folded into the guest that is now the account.
            # Left alone that reads as settling up for yourself, which the
            # balance fold treats as a cycle and refuses.
            managed_member.managed_by_id = None
            managed_member.managed_by_type = None
        else:
            managed_member.managed_by_id = user_id
            managed_member.managed_by_type = 'user'
        counts["managed_members_updated"] += 1

    return counts
