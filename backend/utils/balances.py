"""Balance calculation utilities with management relationship aggregation."""

import logging
from typing import Dict, Iterable, List, Optional, Set, Tuple, Union, overload
from sqlalchemy.orm import Session

import models
from utils.currency import convert_to_usd, convert_currency


logger = logging.getLogger(__name__)


def _managed_key_for_guest(guest: "models.GuestMember") -> Tuple[int, bool]:
    """Resolve the ``(id, is_guest)`` key that a managed guest's balance lives under.

    Claimed guests are reattributed to the user who claimed them (so their
    totals accrue under ``(claimed_by_id, False)``); unclaimed guests stay
    under their own ``(guest.id, True)`` key.
    """
    if guest.claimed_by_id:
        return (guest.claimed_by_id, False)
    return (guest.id, True)


def _detect_managed_cycles(
    managed_guests: Iterable["models.GuestMember"],
    managed_members: Iterable["models.GroupMember"],
) -> Set[Tuple[int, bool]]:
    """
    Detect participant keys whose managed_by chain forms a cycle.

    Returns the set of ``(user_id, is_guest)`` keys that participate in a
    cycle — folding these would silently drop amounts onto deleted keys
    (because folding deletes the source key before its manager is visited),
    so callers should SKIP folding for any key in the returned set.

    Implementation: build the directed edge set ``source_key -> manager_key``
    from all managed entities, then for each source walk its chain up to
    ``len(edges) + 1`` hops. If a node is revisited during a walk, every
    node on the walked path is in a cycle.

    Args:
        managed_guests: Pre-fetched ``GuestMember`` rows with ``managed_by_id``
            set (already scoped to a single group).
        managed_members: Pre-fetched ``GroupMember`` rows with ``managed_by_id``
            set (already scoped to a single group).

    Returns:
        Set of ``(id, is_guest)`` keys that participate in any cycle.
    """
    edges: Dict[Tuple[int, bool], Tuple[int, bool]] = {}

    for guest in managed_guests:
        # Claimed guests that also have managed_by set are intentionally
        # excluded from the fold (see ``_fold_managed_relationships``),
        # so they should not contribute an edge here either.
        if guest.claimed_by_id and guest.managed_by_id:
            continue
        source_key = _managed_key_for_guest(guest)
        manager_key = (guest.managed_by_id, guest.managed_by_type == "guest")
        edges[source_key] = manager_key

    for member in managed_members:
        source_key = (member.user_id, False)
        manager_key = (member.managed_by_id, member.managed_by_type == "guest")
        edges[source_key] = manager_key

    max_depth = len(edges) + 1
    in_cycle: Set[Tuple[int, bool]] = set()

    for start in edges:
        if start in in_cycle:
            continue
        visited: List[Tuple[int, bool]] = []
        seen: Set[Tuple[int, bool]] = set()
        cursor: Optional[Tuple[int, bool]] = start
        for _ in range(max_depth):
            if cursor is None or cursor not in edges:
                break
            if cursor in seen:
                # Cycle detected. Every node from the first occurrence of
                # ``cursor`` onward is on the cycle. Nodes before that are
                # tails leading INTO the cycle; mark them as in_cycle too
                # since folding them still risks data loss (their value
                # lands on a cycle participant whose key may be deleted).
                for node in visited:
                    in_cycle.add(node)
                in_cycle.add(cursor)
                break
            seen.add(cursor)
            visited.append(cursor)
            cursor = edges.get(cursor)

    return in_cycle


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

    # Aggregate managed members with their managers
    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.managed_by_id != None
    ).all()

    # Detect managed_by cycles (e.g. guest A managed_by user 20, user 20
    # managed_by guest A). Folding cyclic entries would silently drop
    # amounts onto a deleted key — skip the fold for these participants
    # so their totals stay visible as individual rows instead.
    cyclic_keys = _detect_managed_cycles(managed_guests, managed_members)
    if cyclic_keys:
        logger.warning(
            "Managed_by cycle detected for group_id=%s, keys involved=%s; "
            "skipping fold to prevent silent data loss.",
            group_id,
            sorted(cyclic_keys),
        )

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

        guest_key = _managed_key_for_guest(guest)
        manager_is_guest = (guest.managed_by_type == 'guest')
        manager_key = (guest.managed_by_id, manager_is_guest)

        # Cycle-aware: don't fold participants whose chain loops back.
        if guest_key in cyclic_keys or manager_key in cyclic_keys:
            continue

        if guest_key in totals:
            totals[manager_key] = totals.get(manager_key, 0) + totals[guest_key]
            del totals[guest_key]

    for managed_member in managed_members:
        member_key = (managed_member.user_id, False)
        manager_is_guest = (managed_member.managed_by_type == 'guest')
        manager_key = (managed_member.managed_by_id, manager_is_guest)

        # Cycle-aware: don't fold participants whose chain loops back.
        if member_key in cyclic_keys or manager_key in cyclic_keys:
            continue

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

        # Aggregate managed members with their managers
        managed_members = db.query(models.GroupMember).filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.managed_by_id != None
        ).all()

        # Detect managed_by cycles and skip folding cyclic participants so
        # amounts aren't silently dropped onto a deleted key.
        cyclic_keys = _detect_managed_cycles(managed_guests, managed_members)
        if cyclic_keys:
            logger.warning(
                "Managed_by cycle detected for group_id=%s, keys involved=%s; "
                "skipping fold to prevent silent data loss.",
                group_id,
                sorted(cyclic_keys),
            )

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

            guest_key = _managed_key_for_guest(guest)
            manager_is_guest = (guest.managed_by_type == 'guest')
            manager_key = (guest.managed_by_id, manager_is_guest)

            # Cycle-aware: don't fold participants whose chain loops back.
            if guest_key in cyclic_keys or manager_key in cyclic_keys:
                continue

            if guest_key in net_balances:
                # Multi-currency mode - aggregate per currency
                if manager_key not in net_balances:
                    net_balances[manager_key] = {}
                for currency, amount in net_balances[guest_key].items():
                    if currency not in net_balances[manager_key]:
                        net_balances[manager_key][currency] = 0
                    net_balances[manager_key][currency] += amount

                del net_balances[guest_key]

        for managed_member in managed_members:
            member_key = (managed_member.user_id, False)
            manager_is_guest = (managed_member.managed_by_type == 'guest')
            manager_key = (managed_member.managed_by_id, manager_is_guest)

            # Cycle-aware: don't fold participants whose chain loops back.
            if member_key in cyclic_keys or manager_key in cyclic_keys:
                continue

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
