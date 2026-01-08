"""Balances router: balance calculations and debt simplification."""

from typing import Annotated, Dict, List, Tuple
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from utils.validation import get_group_or_404, verify_group_membership
from utils.display import get_guest_display_name
from utils.balances import calculate_net_balances
from utils.currency import (
    format_currency,
    convert_to_usd,
    convert_currency,
    get_current_exchange_rates,
    EXCHANGE_RATES
)


router = APIRouter(tags=["balances"])


@router.get("/groups/{group_id}/balances", response_model=list[schemas.GroupBalance])
def get_group_balances(
    group_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    convert_to: str = None  # Optional: convert all balances to this currency using historical rates
):
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    # Calculate net balances with management relationships aggregated
    # If convert_to is specified, convert using historical exchange rates
    net_balances = calculate_net_balances(db, group_id, target_currency=convert_to)

    # Get all managed guests and members for breakdown display
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.managed_by_id != None
    ).all()

    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.managed_by_id != None
    ).all()

    # Build breakdown info before aggregation (to show what was aggregated)
    # We need to recalculate raw balances for breakdown display
    manager_guest_breakdown = {}

    # Get all expenses to recalculate raw balances for breakdown
    expenses = db.query(models.Expense).filter(models.Expense.group_id == group_id).all()

    # Optimization: Batch fetch splits for all expenses
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

    raw_balances = {}  # (user_id, is_guest) -> {currency -> amount}

    for expense in expenses:
        splits = splits_by_expense.get(expense.id, [])
        for split in splits:
            key = (split.user_id, split.is_guest)
            if key not in raw_balances:
                raw_balances[key] = {}
            if expense.currency not in raw_balances[key]:
                raw_balances[key][expense.currency] = 0
            raw_balances[key][expense.currency] -= split.amount_owed

            payer_key = (expense.payer_id, expense.payer_is_guest)
            if payer_key not in raw_balances:
                raw_balances[payer_key] = {}
            if expense.currency not in raw_balances[payer_key]:
                raw_balances[payer_key][expense.currency] = 0
            raw_balances[payer_key][expense.currency] += split.amount_owed

    # Batch fetch users and guests to avoid N+1 queries during display name resolution
    user_ids_to_fetch = set()
    guest_ids_to_fetch = set()

    # Collect IDs from net_balances keys
    for (pid, is_guest) in net_balances.keys():
        if is_guest:
            guest_ids_to_fetch.add(pid)
        else:
            user_ids_to_fetch.add(pid)

    # Collect IDs from managed guests/members
    for g in managed_guests:
        guest_ids_to_fetch.add(g.id)
        if g.managed_by_type == 'user' and g.managed_by_id:
            user_ids_to_fetch.add(g.managed_by_id)
        elif g.managed_by_type == 'guest' and g.managed_by_id:
            guest_ids_to_fetch.add(g.managed_by_id)
        if g.claimed_by_id:
            user_ids_to_fetch.add(g.claimed_by_id)

    for m in managed_members:
        user_ids_to_fetch.add(m.user_id)
        if m.managed_by_type == 'user' and m.managed_by_id:
            user_ids_to_fetch.add(m.managed_by_id)
        elif m.managed_by_type == 'guest' and m.managed_by_id:
            guest_ids_to_fetch.add(m.managed_by_id)

    # Fetch users
    users_map = {}
    if user_ids_to_fetch:
        users = db.query(models.User).filter(models.User.id.in_(user_ids_to_fetch)).all()
        users_map = {u.id: u for u in users}

    # Fetch guests
    guests_map = {}
    if guest_ids_to_fetch:
        guests = db.query(models.GuestMember).filter(models.GuestMember.id.in_(guest_ids_to_fetch)).all()
        guests_map = {g.id: g for g in guests}

    # Helper function to get display name using prefetched maps
    def get_prefetched_guest_display_name(guest_obj):
        if guest_obj.claimed_by_id and guest_obj.claimed_by_id in users_map:
            u = users_map[guest_obj.claimed_by_id]
            return u.full_name or u.email
        return guest_obj.name

    # Build breakdown for managed guests
    # Use dict to deduplicate by name within each breakdown key
    for guest in managed_guests:
        if guest.claimed_by_id:
            guest_key = (guest.claimed_by_id, False)
        else:
            guest_key = (guest.id, True)

        manager_is_guest = (guest.managed_by_type == 'guest')

        if guest_key in raw_balances:
            display_name = get_prefetched_guest_display_name(guest)
            for currency, amount in raw_balances[guest_key].items():
                breakdown_key = (guest.managed_by_id, manager_is_guest, currency)
                if breakdown_key not in manager_guest_breakdown:
                    manager_guest_breakdown[breakdown_key] = {}
                # Use name as key to avoid duplicates, sum amounts if name appears multiple times
                if display_name not in manager_guest_breakdown[breakdown_key]:
                    manager_guest_breakdown[breakdown_key][display_name] = 0
                manager_guest_breakdown[breakdown_key][display_name] += amount

    # Build breakdown for managed members
    for managed_member in managed_members:
        member_key = (managed_member.user_id, False)
        manager_is_guest = (managed_member.managed_by_type == 'guest')

        if member_key in raw_balances:
            member_user = users_map.get(managed_member.user_id)
            member_name = (member_user.full_name or member_user.email) if member_user else "Unknown Member"
            for currency, amount in raw_balances[member_key].items():
                breakdown_key = (managed_member.managed_by_id, manager_is_guest, currency)
                if breakdown_key not in manager_guest_breakdown:
                    manager_guest_breakdown[breakdown_key] = {}
                # Use name as key to avoid duplicates, sum amounts if name appears multiple times
                if member_name not in manager_guest_breakdown[breakdown_key]:
                    manager_guest_breakdown[breakdown_key][member_name] = 0
                manager_guest_breakdown[breakdown_key][member_name] += amount

    # Build response with participant details
    result = []

    if convert_to:
        # Single currency mode - net_balances is {(user_id, is_guest): amount}
        # Build breakdown in converted currency
        # Use dict to deduplicate by name
        manager_breakdown_converted = {}

        # Convert raw balances to target currency for breakdown display
        for guest in managed_guests:
            if guest.claimed_by_id:
                guest_key = (guest.claimed_by_id, False)
            else:
                guest_key = (guest.id, True)

            manager_is_guest = (guest.managed_by_type == 'guest')
            breakdown_key = (guest.managed_by_id, manager_is_guest)

            if guest_key in raw_balances:
                display_name = get_prefetched_guest_display_name(guest)
                total_amount = 0
                # Convert all currencies to target currency
                for currency, amount in raw_balances[guest_key].items():
                    # Convert through USD
                    amount_usd = convert_to_usd(amount, currency)
                    amount_converted = convert_currency(amount_usd, "USD", convert_to)
                    total_amount += amount_converted

                if breakdown_key not in manager_breakdown_converted:
                    manager_breakdown_converted[breakdown_key] = {}
                # Use name as key to avoid duplicates, sum amounts if name appears multiple times
                if display_name not in manager_breakdown_converted[breakdown_key]:
                    manager_breakdown_converted[breakdown_key][display_name] = 0
                manager_breakdown_converted[breakdown_key][display_name] += int(total_amount)

        # Same for managed members
        for managed_member in managed_members:
            member_key = (managed_member.user_id, False)
            manager_is_guest = (managed_member.managed_by_type == 'guest')
            breakdown_key = (managed_member.managed_by_id, manager_is_guest)

            if member_key in raw_balances:
                member_user = users_map.get(managed_member.user_id)
                member_name = (member_user.full_name or member_user.email) if member_user else "Unknown Member"
                total_amount = 0
                # Convert all currencies to target currency
                for currency, amount in raw_balances[member_key].items():
                    # Convert through USD
                    amount_usd = convert_to_usd(amount, currency)
                    amount_converted = convert_currency(amount_usd, "USD", convert_to)
                    total_amount += amount_converted

                if breakdown_key not in manager_breakdown_converted:
                    manager_breakdown_converted[breakdown_key] = {}
                # Use name as key to avoid duplicates, sum amounts if name appears multiple times
                if member_name not in manager_breakdown_converted[breakdown_key]:
                    manager_breakdown_converted[breakdown_key][member_name] = 0
                manager_breakdown_converted[breakdown_key][member_name] += int(total_amount)

        for (participant_id, is_guest), amount in net_balances.items():
            if amount == 0:
                continue

            if is_guest:
                guest = guests_map.get(participant_id)
                name = guest.name if guest else "Unknown Guest"
            else:
                user = users_map.get(participant_id)
                name = (user.full_name or user.email) if user else "Unknown User"

            # Build managed guests list for this participant
            managed_guests_list = []
            breakdown_key = (participant_id, is_guest)
            if breakdown_key in manager_breakdown_converted:
                managed_guests_list = [
                    f"{guest_name} ({format_currency(guest_amount, convert_to)})"
                    for guest_name, guest_amount in manager_breakdown_converted[breakdown_key].items()
                ]

            result.append(schemas.GroupBalance(
                user_id=participant_id,
                is_guest=is_guest,
                full_name=name,
                amount=int(amount),
                currency=convert_to,
                managed_guests=managed_guests_list
            ))
    else:
        # Multi-currency mode - net_balances is {(user_id, is_guest): {currency: amount}}
        for (participant_id, is_guest), currencies in net_balances.items():
            if is_guest:
                guest = guests_map.get(participant_id)
                name = guest.name if guest else "Unknown Guest"
            else:
                user = users_map.get(participant_id)
                name = (user.full_name or user.email) if user else "Unknown User"

            for currency, amount in currencies.items():
                if amount != 0:
                    managed_guests_list = []
                    breakdown_key = (participant_id, is_guest, currency)
                    if breakdown_key in manager_guest_breakdown:
                        managed_guests_list = [
                            f"{guest_name} ({format_currency(guest_amount, currency)})"
                            for guest_name, guest_amount in manager_guest_breakdown[breakdown_key].items()
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


@router.get("/balances", response_model=dict[str, list[schemas.Balance]])
def get_balances(
    current_user: Annotated[models.User, Depends(get_current_user)], 
    db: Session = Depends(get_db)
):
    # Money user paid (only non-guest expenses where I'm the payer)
    paid_expenses = db.query(models.Expense).filter(
        models.Expense.payer_id == current_user.id,
        models.Expense.payer_is_guest == False
    ).all()

    # Money user owes (only non-guest splits where I'm a participant)
    my_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.user_id == current_user.id,
        models.ExpenseSplit.is_guest == False
    ).all()

    # Individual user balances (for 1-to-1 IOUs): (user_id, currency) -> amount
    user_balances = {}
    
    # Group balances (for group expenses): (group_id, currency) -> amount
    group_balances = {}

    # Analyze expenses I paid
    for expense in paid_expenses:
        splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()
        for split in splits:
            if split.user_id == current_user.id and not split.is_guest:
                continue  # I don't owe myself

            # Someone else owes me 'split.amount_owed'
            if expense.group_id:
                key = (expense.group_id, expense.currency)
                group_balances[key] = group_balances.get(key, 0) + split.amount_owed
            else:
                if split.is_guest:
                    guest = db.query(models.GuestMember).filter(models.GuestMember.id == split.user_id).first()
                    if guest:
                        key = (guest.group_id, expense.currency)
                        group_balances[key] = group_balances.get(key, 0) + split.amount_owed
                else:
                    key = (split.user_id, expense.currency)
                    user_balances[key] = user_balances.get(key, 0) + split.amount_owed

    # Analyze expenses I owe (someone else paid)
    for split in my_splits:
        expense = db.query(models.Expense).filter(models.Expense.id == split.expense_id).first()
        if not expense:
            continue
            
        if expense.payer_id == current_user.id and not expense.payer_is_guest:
            continue  # I paid, handled above

        # I owe the payer 'split.amount_owed'
        if expense.group_id:
            key = (expense.group_id, expense.currency)
            group_balances[key] = group_balances.get(key, 0) - split.amount_owed
        else:
            if expense.payer_is_guest:
                guest = db.query(models.GuestMember).filter(models.GuestMember.id == expense.payer_id).first()
                if guest:
                    key = (guest.group_id, expense.currency)
                    group_balances[key] = group_balances.get(key, 0) - split.amount_owed
            else:
                key = (expense.payer_id, expense.currency)
                user_balances[key] = user_balances.get(key, 0) - split.amount_owed

    result = {"balances": []}

    # Add individual user balances (1-to-1 IOUs only)
    for (uid, currency), amount in user_balances.items():
        if amount != 0:
            user = db.query(models.User).filter(models.User.id == uid).first()
            full_name = user.full_name if user else f"User {uid}"
            result["balances"].append(schemas.Balance(
                user_id=uid, 
                full_name=full_name, 
                amount=amount, 
                currency=currency,
                is_guest=False
            ))

    # Add consolidated group balances
    for (group_id, currency), amount in group_balances.items():
        if amount != 0:
            group = db.query(models.Group).filter(models.Group.id == group_id).first()
            group_name = group.name if group else f"Group {group_id}"
            result["balances"].append(schemas.Balance(
                user_id=0,
                full_name=group_name,
                amount=amount,
                currency=currency,
                is_guest=True,
                group_name=group_name,
                group_id=group_id
            ))

    return result


@router.get("/exchange_rates")
def get_exchange_rates():
    """Get current exchange rates from API or fallback to static rates."""
    return get_current_exchange_rates()


@router.get("/simplify_debts/{group_id}")
def simplify_debts(
    group_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """Simplify debts in a group using a graph algorithm. Returns transactions in group's default currency."""
    # Get group to determine default currency
    group = get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    target_currency = group.default_currency or "USD"

    # Calculate net balances with management relationships aggregated
    net_balances = calculate_net_balances(db, group_id, target_currency)

    # Simplify in target currency
    transactions = []
    debtors = []
    creditors = []

    for (uid, is_guest), amount in net_balances.items():
        if amount < -0.01:
            debtors.append({'id': uid, 'is_guest': is_guest, 'amount': amount})
        elif amount > 0.01:
            creditors.append({'id': uid, 'is_guest': is_guest, 'amount': amount})

    debtors.sort(key=lambda x: x['amount'])
    creditors.sort(key=lambda x: x['amount'], reverse=True)

    i = 0
    j = 0

    while i < len(debtors) and j < len(creditors):
        debtor = debtors[i]
        creditor = creditors[j]

        amount = min(abs(debtor['amount']), creditor['amount'])

        transactions.append({
            "from_id": debtor['id'],
            "from_is_guest": debtor['is_guest'],
            "to_id": creditor['id'],
            "to_is_guest": creditor['is_guest'],
            "amount": amount,
            "currency": target_currency
        })

        debtor['amount'] += amount
        creditor['amount'] -= amount

        if abs(debtor['amount']) < 0.01:
            i += 1
        if creditor['amount'] < 0.01:
            j += 1

    return {"transactions": transactions}
