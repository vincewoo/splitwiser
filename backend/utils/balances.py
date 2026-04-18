"""Balance calculation utilities with management relationship aggregation."""

import logging
from typing import Dict, Optional, Tuple, Union, overload
from sqlalchemy.orm import Session

import models
from utils.currency import convert_to_usd, convert_currency


logger = logging.getLogger(__name__)


def _fold_managed_relationships(
    db: Session,
    group_id: int,
    totals: Dict[Tuple[int, bool], float],
) -> None:
    """
    Fold managed guests and managed members into their managers in-place.

    Scoped to the scalar case: ``totals`` is a dict keyed by ``(user_id, is_guest)``
    with scalar numeric (int/float) values. For each managed guest or managed member
    found in the group, the entry is added to the manager's entry and then removed
    from ``totals``.

    The multi-currency (dict-of-dicts) folding path in ``calculate_net_balances``
    deliberately stays inline and does NOT use this helper.

    Args:
        db: Database session.
        group_id: ID of the group whose managed relationships should be folded.
        totals: Mutable dict mapping ``(user_id, is_guest)`` to a scalar amount.
            Mutated in place — folded entries are deleted, manager entries are
            incremented (and created if missing when iterating in an order that
            produces them).
    """
    # Aggregate managed guests with their managers
    managed_guests = db.query(models.GuestMember).filter(
        models.GuestMember.group_id == group_id,
        models.GuestMember.managed_by_id != None
    ).all()

    for guest in managed_guests:
        # Defensive check: claimed guests should not have managed_by set
        # This would cause double-counting since the user inherits the management relationship
        if guest.claimed_by_id and guest.managed_by_id:
            logger.warning(
                "Data integrity issue: Claimed guest id=%s has managed_by_id=%s set. "
                "This should be None. Skipping aggregation to prevent double-counting.",
                guest.id,
                guest.managed_by_id,
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

        if guest_key in totals:
            totals[manager_key] = totals.get(manager_key, 0) + totals[guest_key]
            del totals[guest_key]

    # Aggregate managed members with their managers
    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.managed_by_id != None
    ).all()

    for managed_member in managed_members:
        member_key = (managed_member.user_id, False)
        manager_is_guest = (managed_member.managed_by_type == 'guest')
        manager_key = (managed_member.managed_by_id, manager_is_guest)

        if member_key in totals:
            totals[manager_key] = totals.get(manager_key, 0) + totals[member_key]
            del totals[member_key]


@overload
def calculate_net_balances(
    db: Session,
    group_id: int,
    target_currency: None = None,
) -> Dict[Tuple[int, bool], Dict[str, float]]: ...


@overload
def calculate_net_balances(
    db: Session,
    group_id: int,
    target_currency: str,
) -> Dict[Tuple[int, bool], float]: ...


def calculate_net_balances(
    db: Session,
    group_id: int,
    target_currency: Optional[str] = None,
) -> Union[Dict[Tuple[int, bool], float], Dict[Tuple[int, bool], Dict[str, float]]]:
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

    if target_currency:
        # Single-currency (scalar) mode — delegate folding to the shared helper
        # so the upcoming consumption-summary primitive can reuse the same logic.
        _fold_managed_relationships(db, group_id, net_balances)
    else:
        # Multi-currency mode — kept inline; the helper is scoped to scalar values.
        # Aggregate managed guests with their managers
        managed_guests = db.query(models.GuestMember).filter(
            models.GuestMember.group_id == group_id,
            models.GuestMember.managed_by_id != None
        ).all()

        for guest in managed_guests:
            # Defensive check: claimed guests should not have managed_by set
            # This would cause double-counting since the user inherits the management relationship
            if guest.claimed_by_id and guest.managed_by_id:
                logger.warning(
                    "Data integrity issue: Claimed guest id=%s has managed_by_id=%s set. "
                    "This should be None. Skipping aggregation to prevent double-counting.",
                    guest.id,
                    guest.managed_by_id,
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
                # Multi-currency mode - aggregate per currency
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                for currency, amount in net_balances[member_key].items():
                    if currency not in net_balances[manager_key]:
                        net_balances[manager_key][currency] = 0
                    net_balances[manager_key][currency] += amount

                del net_balances[member_key]

    return net_balances
