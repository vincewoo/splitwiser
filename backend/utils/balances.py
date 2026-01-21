"""Balance calculation utilities with management relationship aggregation."""

from typing import Dict, Tuple, List, Union, Any
from sqlalchemy.orm import Session
import logging

import models
from utils.currency import convert_to_usd, convert_currency

logger = logging.getLogger(__name__)

def calculate_net_balances(
    db: Session,
    group_id: int,
    target_currency: str = None
) -> Dict[Tuple[int, bool], Any]:
    """
    Calculate net balances for all participants in a group, aggregating managed relationships.

    Args:
        db: Database session
        group_id: ID of the group
        target_currency: Optional currency to convert all balances to. If None, returns balances per currency.

    Returns:
        Dictionary mapping (user_id, is_guest) tuples to net balance amounts.
        If target_currency is specified, all balances are converted to that currency.
        If target_currency is None, returns dict mapping to dict of {currency: amount}.
    """
    # Use the batch function for a single group
    # Note: If target_currency is None, we pass that as is.
    group_target_currencies = {group_id: target_currency}
    result = calculate_net_balances_batch(db, group_target_currencies)
    return result.get(group_id, {})


def calculate_net_balances_batch(
    db: Session,
    group_target_currencies: Dict[int, Union[str, None]]
) -> Dict[int, Dict[Tuple[int, bool], Any]]:
    """
    Batch calculate net balances for multiple groups to avoid N+1 queries.

    Args:
        db: Database session
        group_target_currencies: Dict mapping group_id to target_currency (or None).

    Returns:
        Dict mapping group_id to its balance dictionary (same format as calculate_net_balances return).
    """
    group_ids = list(group_target_currencies.keys())
    if not group_ids:
        return {}

    # 1. Fetch Expenses
    expenses = db.query(models.Expense).filter(models.Expense.group_id.in_(group_ids)).all()
    if not expenses:
        return {gid: {} for gid in group_ids}

    # Group expenses by group_id
    expenses_by_group = {gid: [] for gid in group_ids}
    expense_ids = []
    for expense in expenses:
        if expense.group_id in expenses_by_group:
            expenses_by_group[expense.group_id].append(expense)
            expense_ids.append(expense.id)

    # 2. Fetch Splits
    all_splits = []
    if expense_ids:
        all_splits = db.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id.in_(expense_ids)
        ).all()

    # Group splits by expense_id
    splits_by_expense = {}
    for split in all_splits:
        if split.expense_id not in splits_by_expense:
            splits_by_expense[split.expense_id] = []
        splits_by_expense[split.expense_id].append(split)

    # 3. Fetch Managed Guests
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id.in_(group_ids),
        models.GuestMember.managed_by_id != None
    ).all()

    managed_guests_by_group = {gid: [] for gid in group_ids}
    for guest in managed_guests:
        if guest.group_id in managed_guests_by_group:
            managed_guests_by_group[guest.group_id].append(guest)

    # 4. Fetch Managed Members
    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id.in_(group_ids),
        models.GroupMember.managed_by_id != None
    ).all()

    managed_members_by_group = {gid: [] for gid in group_ids}
    for member in managed_members:
        if member.group_id in managed_members_by_group:
            managed_members_by_group[member.group_id].append(member)

    # Calculate for each group
    results = {}

    for group_id in group_ids:
        target_currency = group_target_currencies.get(group_id)
        group_expenses = expenses_by_group.get(group_id, [])
        group_managed_guests = managed_guests_by_group.get(group_id, [])
        group_managed_members = managed_members_by_group.get(group_id, [])

        results[group_id] = calculate_balances_from_data(
            group_expenses,
            splits_by_expense,
            group_managed_guests,
            group_managed_members,
            target_currency
        )

    return results


def calculate_balances_from_data(
    expenses: List[models.Expense],
    splits_by_expense: Dict[int, List[models.ExpenseSplit]],
    managed_guests: List[models.GuestMember],
    managed_members: List[models.GroupMember],
    target_currency: str = None
) -> Dict[Tuple[int, bool], Any]:
    """Pure logic for calculating balances from pre-fetched data."""

    # Calculate raw net balances per participant
    if target_currency:
        # Single currency mode - convert everything to target currency
        net_balances = {}  # (user_id, is_guest) -> amount

        for expense in expenses:
            splits = splits_by_expense.get(expense.id, [])

            for split in splits:
                # First convert to USD using historical rate, then to target currency
                if expense.exchange_rate:
                    try:
                        rate = float(expense.exchange_rate)
                        amount_usd = split.amount_owed * rate
                    except ValueError:
                        amount_usd = convert_to_usd(split.amount_owed, expense.currency)
                else:
                    amount_usd = convert_to_usd(split.amount_owed, expense.currency)

                # Convert from USD to target currency
                amount_in_target = convert_currency(amount_usd, "USD", target_currency)

                # Debtor decreases balance
                debtor_key = (split.user_id, split.is_guest)
                net_balances[debtor_key] = net_balances.get(debtor_key, 0) - amount_in_target

                # Creditor (Payer) increases balance
                payer_key = (expense.payer_id, expense.payer_is_guest)
                net_balances[payer_key] = net_balances.get(payer_key, 0) + amount_in_target
    else:
        # Multi-currency mode - keep balances per currency
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

    # Aggregate managed guests with their managers
    for guest in managed_guests:
        # Defensive check
        if guest.claimed_by_id and guest.managed_by_id:
            logger.warning(
                f"Data integrity issue: Claimed guest '{guest.name}' (ID: {guest.id}) "
                f"has managed_by_id={guest.managed_by_id} set. This should be None. "
                f"Skipping aggregation to prevent double-counting."
            )
            continue

        if guest.claimed_by_id:
            guest_key = (guest.claimed_by_id, False)
        else:
            guest_key = (guest.id, True)

        manager_is_guest = (guest.managed_by_type == 'guest')
        manager_key = (guest.managed_by_id, manager_is_guest)

        if guest_key in net_balances:
            if target_currency:
                net_balances[manager_key] = net_balances.get(manager_key, 0) + net_balances[guest_key]
            else:
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                for currency, amount in net_balances[guest_key].items():
                    if currency not in net_balances[manager_key]:
                        net_balances[manager_key][currency] = 0
                    net_balances[manager_key][currency] += amount

            del net_balances[guest_key]

    # Aggregate managed members with their managers
    for managed_member in managed_members:
        member_key = (managed_member.user_id, False)
        manager_is_guest = (managed_member.managed_by_type == 'guest')
        manager_key = (managed_member.managed_by_id, manager_is_guest)

        if member_key in net_balances:
            if target_currency:
                net_balances[manager_key] = net_balances.get(manager_key, 0) + net_balances[member_key]
            else:
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                for currency, amount in net_balances[member_key].items():
                    if currency not in net_balances[manager_key]:
                        net_balances[manager_key][currency] = 0
                    net_balances[manager_key][currency] += amount

            del net_balances[member_key]

    return net_balances
