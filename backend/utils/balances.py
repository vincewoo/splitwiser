"""Balance calculation utilities with management relationship aggregation."""

from typing import Dict, Tuple
from sqlalchemy.orm import Session

import models
from utils.currency import convert_to_usd, convert_currency


def calculate_net_balances(
    db: Session,
    group_id: int,
    target_currency: str = None
) -> Dict[Tuple[int, bool], float]:
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
    # Get all expenses in group
    expenses = db.query(models.Expense).filter(models.Expense.group_id == group_id).all()

    if not expenses:
        return {}

    # Optimization: Batch fetch all splits for these expenses to avoid N+1 queries
    expense_ids = [e.id for e in expenses]
    all_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.expense_id.in_(expense_ids)
    ).all()

    # Group splits by expense_id
    splits_by_expense = {}
    for split in all_splits:
        if split.expense_id not in splits_by_expense:
            splits_by_expense[split.expense_id] = []
        splits_by_expense[split.expense_id].append(split)

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
                        # exchange_rate represents: how many USD you get for 1 unit of expense currency
                        # (e.g., 1 EUR = 1.0945 USD, so rate = 1.0945)
                        # So to convert from expense currency to USD: multiply by rate
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
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.managed_by_id != None
    ).all()

    for guest in managed_guests:
        # Defensive check: claimed guests should not have managed_by set
        # This would cause double-counting since the user inherits the management relationship
        if guest.claimed_by_id and guest.managed_by_id:
            import logging
            logging.warning(
                f"Data integrity issue: Claimed guest '{guest.name}' (ID: {guest.id}) "
                f"has managed_by_id={guest.managed_by_id} set. This should be None. "
                f"Skipping aggregation to prevent double-counting."
            )
            continue

        if guest.claimed_by_id:
            # If guest is claimed, their balance is now under the user ID
            guest_key = (guest.claimed_by_id, False)
        else:
            # If guest is unclaimed, their balance is under the guest ID
            guest_key = (guest.id, True)

        manager_is_guest = (guest.managed_by_type == 'guest')
        manager_key = (guest.managed_by_id, manager_is_guest)

        if guest_key in net_balances:
            if target_currency:
                # Single currency mode - simple addition
                net_balances[manager_key] = net_balances.get(manager_key, 0) + net_balances[guest_key]
            else:
                # Multi-currency mode - aggregate per currency
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                for currency, amount in net_balances[guest_key].items():
                    if currency not in net_balances[manager_key]:
                        net_balances[manager_key][currency] = 0
                    net_balances[manager_key][currency] += amount

            del net_balances[guest_key]

    # Aggregate managed members with their managers
    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.managed_by_id != None
    ).all()

    for managed_member in managed_members:
        member_key = (managed_member.user_id, False)
        manager_is_guest = (managed_member.managed_by_type == 'guest')
        manager_key = (managed_member.managed_by_id, manager_is_guest)

        if member_key in net_balances:
            if target_currency:
                # Single currency mode - simple addition
                net_balances[manager_key] = net_balances.get(manager_key, 0) + net_balances[member_key]
            else:
                # Multi-currency mode - aggregate per currency
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                for currency, amount in net_balances[member_key].items():
                    if currency not in net_balances[manager_key]:
                        net_balances[manager_key][currency] = 0
                    net_balances[manager_key][currency] += amount

            del net_balances[member_key]

    return net_balances


def calculate_net_balances_batch(
    db: Session,
    group_ids: list[int],
    target_currencies: Dict[int, str] = None
) -> Dict[int, Dict[Tuple[int, bool], float]]:
    """
    Calculate net balances for all participants in multiple groups, aggregating managed relationships.

    Args:
        db: Database session
        group_ids: List of group IDs to calculate balances for.
        target_currencies: Dictionary mapping group_id to target currency.
                           If provided, balances for that group are converted to the target currency.

    Returns:
        Dictionary mapping group_id to:
            Dictionary mapping (user_id, is_guest) tuples to net balance amounts (if target_currency provided for group)
            OR
            Dictionary mapping (user_id, is_guest) tuples to {currency: amount} (if no target_currency provided for group)
    """
    if not group_ids:
        return {}

    target_currencies = target_currencies or {}

    # 1. Batch fetch all expenses
    expenses = db.query(models.Expense).filter(models.Expense.group_id.in_(group_ids)).all()

    expenses_by_group = {}
    for expense in expenses:
        if expense.group_id not in expenses_by_group:
            expenses_by_group[expense.group_id] = []
        expenses_by_group[expense.group_id].append(expense)

    # 2. Batch fetch all splits
    expense_ids = [e.id for e in expenses]
    all_splits = []
    if expense_ids:
        all_splits = db.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id.in_(expense_ids)
        ).all()

    splits_by_expense = {}
    for split in all_splits:
        if split.expense_id not in splits_by_expense:
            splits_by_expense[split.expense_id] = []
        splits_by_expense[split.expense_id].append(split)

    # 3. Batch fetch all managed guests
    all_managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id.in_(group_ids),
        models.GuestMember.managed_by_id != None
    ).all()

    managed_guests_by_group = {}
    for guest in all_managed_guests:
        if guest.group_id not in managed_guests_by_group:
            managed_guests_by_group[guest.group_id] = []
        managed_guests_by_group[guest.group_id].append(guest)

    # 4. Batch fetch all managed members
    all_managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id.in_(group_ids),
        models.GroupMember.managed_by_id != None
    ).all()

    managed_members_by_group = {}
    for member in all_managed_members:
        if member.group_id not in managed_members_by_group:
            managed_members_by_group[member.group_id] = []
        managed_members_by_group[member.group_id].append(member)

    # 5. Calculate for each group
    results = {}

    for group_id in group_ids:
        group_expenses = expenses_by_group.get(group_id, [])
        target_currency = target_currencies.get(group_id)

        # Calculate raw net balances per participant
        if target_currency:
            # Single currency mode - convert everything to target currency
            net_balances = {}  # (user_id, is_guest) -> amount

            for expense in group_expenses:
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

            for expense in group_expenses:
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

        # Aggregate managed guests
        group_managed_guests = managed_guests_by_group.get(group_id, [])
        for guest in group_managed_guests:
            if guest.claimed_by_id and guest.managed_by_id:
                # Same check as original, logging skipped for brevity but logic maintained
                continue

            # Since the query filters for managed_by_id != None, and we skipped claimed+managed above,
            # we are only dealing with unclaimed managed guests here.
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

        # Aggregate managed members
        group_managed_members = managed_members_by_group.get(group_id, [])
        for managed_member in group_managed_members:
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

        results[group_id] = net_balances

    return results
