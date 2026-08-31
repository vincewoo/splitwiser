"""Split calculation utilities for itemized expenses.

The arithmetic lives in one place — :func:`allocate_items` — and everything
else in this module is an adapter onto it.

Two callers need the same maths from different angles. The write path
(``routers/expenses.py``) starts from Pydantic ``ExpenseItemCreate`` objects and
wants one total per person, which is what gets persisted as
``ExpenseSplit.amount_owed``. The balance-sheet export starts from ORM
``ExpenseItem`` / ``ExpenseItemAssignment`` rows and wants the opposite: every
intermediate step, including which person absorbed the remainder cents, because
the whole point of that export is showing the arithmetic.

Reimplementing the allocation for the second caller would guarantee the two
drift apart, and a CSV that disagrees with the app is worse than no CSV. So the
core computes the detailed form and the write path collapses it.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import schemas


def get_assignment_key(assignment: schemas.ItemAssignment) -> str:
    """Get a unique key for an assignment (user, group guest, or expense guest)."""
    if assignment.temp_guest_id is not None:
        return f"expense_guest_{assignment.temp_guest_id}"
    elif assignment.expense_guest_id is not None:
        return f"expense_guest_{assignment.expense_guest_id}"
    elif assignment.is_guest:
        return f"guest_{assignment.user_id}"
    else:
        return f"user_{assignment.user_id}"


def get_participant_key(assignment: schemas.ItemAssignment) -> str:
    """Key an assignment as a group participant, ignoring expense-guest identity.

    This is the pre-existing behaviour of :func:`calculate_itemized_splits`,
    which predates ad-hoc expense guests and is only ever called for expenses
    that have none.
    """
    return f"{'guest' if assignment.is_guest else 'user'}_{assignment.user_id}"


@dataclass(frozen=True)
class AllocationInput:
    """One receipt line, as the allocator wants it.

    ``keys`` is the ordered list of participant keys assigned to the line.
    Order is significant: an equal split hands the remainder cents to the
    assignees at the front of this list.
    """

    price: int
    keys: List[str]
    item_id: Optional[int] = None
    is_tax_tip: bool = False
    split_type: str = "EQUAL"
    split_details: Dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Allocation:
    """What one person owes for one line, and why.

    ``item_id`` is ``None`` for the tax/tip allocation, which is computed
    against a person's whole subtotal rather than against any single line.
    """

    key: str
    item_id: Optional[int]
    subtotal_cents: int
    tax_tip_cents: int
    total_cents: int
    rounding_cents: int
    note: str


def _detail_value(details: Dict[str, object], key: str, attr: str, default):
    """Read one field from a split-detail entry, which may be a dict or a model."""
    detail = details.get(key, {}) if details else {}
    if hasattr(detail, attr):
        value = getattr(detail, attr)
    elif isinstance(detail, dict):
        value = detail.get(attr, default)
    else:
        return default
    return default if value is None else value


def _allocate_regular_item(item: AllocationInput) -> List[Allocation]:
    """Split one non-tax/tip line across its assignees."""
    allocations: List[Allocation] = []
    keys = item.keys
    details = item.split_details or {}

    # A single assignee takes the whole line whatever the split type says.
    if item.split_type == "EQUAL" or len(keys) == 1:
        share = item.price // len(keys)
        remainder = item.price % len(keys)
        for idx, key in enumerate(keys):
            # The first `remainder` assignees each absorb one extra cent.
            extra = 1 if idx < remainder else 0
            note = "split equally" if len(keys) > 1 else "sole assignee"
            if extra:
                note += " (+0.01 rounding)"
            allocations.append(Allocation(
                key=key,
                item_id=item.item_id,
                subtotal_cents=share + extra,
                tax_tip_cents=0,
                total_cents=share + extra,
                rounding_cents=extra,
                note=note,
            ))
        return allocations

    if item.split_type == "EXACT":
        for key in keys:
            amount = _detail_value(details, key, "amount", 0)
            allocations.append(Allocation(
                key=key,
                item_id=item.item_id,
                subtotal_cents=amount,
                tax_tip_cents=0,
                total_cents=amount,
                rounding_cents=0,
                note="exact amount",
            ))
        return allocations

    if item.split_type == "PERCENT":
        remaining = item.price
        sorted_keys = sorted(keys)
        for idx, key in enumerate(sorted_keys):
            percentage = _detail_value(details, key, "percentage", 0)
            nominal = int(item.price * (percentage / 100))
            if idx == len(sorted_keys) - 1:
                # Last key takes whatever is left, absorbing the rounding.
                amount = remaining
                rounding = amount - nominal
            else:
                amount = nominal
                rounding = 0
                remaining -= amount
            note = f"{percentage}% of line"
            if rounding:
                note += f" ({rounding:+d} cents rounding)"
            allocations.append(Allocation(
                key=key,
                item_id=item.item_id,
                subtotal_cents=amount,
                tax_tip_cents=0,
                total_cents=amount,
                rounding_cents=rounding,
                note=note,
            ))
        return allocations

    if item.split_type == "SHARES":
        sorted_keys = sorted(keys)
        total_shares = sum(_detail_value(details, key, "shares", 1) for key in sorted_keys)
        if total_shares <= 0:
            return allocations

        remaining = item.price
        for idx, key in enumerate(sorted_keys):
            shares = _detail_value(details, key, "shares", 1)
            nominal = int((item.price * shares) / total_shares)
            if idx == len(sorted_keys) - 1:
                amount = remaining
                rounding = amount - nominal
            else:
                amount = nominal
                rounding = 0
                remaining -= amount
            note = f"{shares} of {total_shares} shares"
            if rounding:
                note += f" ({rounding:+d} cents rounding)"
            allocations.append(Allocation(
                key=key,
                item_id=item.item_id,
                subtotal_cents=amount,
                tax_tip_cents=0,
                total_cents=amount,
                rounding_cents=rounding,
                note=note,
            ))
        return allocations

    return allocations


def allocate_items(items: List[AllocationInput]) -> List[Allocation]:
    """Allocate every line of an itemized expense across its participants.

    Two passes, matching how a receipt is actually read:

    1. Each non-tax/tip line is split across its assignees per the line's own
       split type, giving every person a subtotal.
    2. Tax and tip are pooled and spread across people in proportion to those
       subtotals, with the last key (sorted) absorbing the remainder.

    Returns one :class:`Allocation` per (line, person), plus one per person for
    the pooled tax/tip with ``item_id=None``. A line with no assignees
    contributes nothing — and note that when the regular lines allocate to
    nothing at all, pooled tax/tip is *not* distributed either. That is
    long-standing behaviour and the balance sheet reports it as a
    reconciliation gap rather than silently inventing an allocation.
    """
    allocations: List[Allocation] = []
    person_subtotals: Dict[str, int] = {}

    for item in items:
        if item.is_tax_tip or not item.keys:
            continue
        for allocation in _allocate_regular_item(item):
            allocations.append(allocation)
            person_subtotals[allocation.key] = (
                person_subtotals.get(allocation.key, 0) + allocation.subtotal_cents
            )

    regular_total = sum(person_subtotals.values())
    tax_tip_total = sum(i.price for i in items if i.is_tax_tip)

    if regular_total <= 0 or tax_tip_total <= 0:
        return allocations

    remaining_tax_tip = tax_tip_total
    sorted_keys = sorted(person_subtotals.keys())
    for idx, key in enumerate(sorted_keys):
        subtotal = person_subtotals[key]
        nominal = int((subtotal / regular_total) * tax_tip_total)
        if idx == len(sorted_keys) - 1:
            # Last key absorbs the remainder so the pool is fully distributed.
            share = remaining_tax_tip
            rounding = share - nominal
        else:
            share = nominal
            rounding = 0
            remaining_tax_tip -= share

        percent = (subtotal / regular_total) * 100
        note = f"{percent:.1f}% of subtotal"
        if rounding:
            note += f" ({rounding:+d} cents rounding)"

        allocations.append(Allocation(
            key=key,
            item_id=None,
            subtotal_cents=0,
            tax_tip_cents=share,
            total_cents=share,
            rounding_cents=rounding,
            note=note,
        ))

    return allocations


def _totals_by_key(allocations: List[Allocation]) -> Dict[str, int]:
    """Collapse allocations to one total per person, in sorted-key order."""
    totals: Dict[str, int] = {}
    for allocation in allocations:
        totals[allocation.key] = totals.get(allocation.key, 0) + allocation.total_cents
    return {key: totals[key] for key in sorted(totals)}


def _allocation_inputs(
    items: list[schemas.ExpenseItemCreate],
    key_fn,
) -> List[AllocationInput]:
    """Adapt create-schema items to allocator inputs using the given key function."""
    return [
        AllocationInput(
            price=item.price,
            keys=[key_fn(a) for a in item.assignments],
            item_id=None,
            is_tax_tip=item.is_tax_tip,
            split_type=getattr(item, "split_type", "EQUAL") or "EQUAL",
            split_details=getattr(item, "split_details", {}) or {},
        )
        for item in items
    ]


def calculate_itemized_splits(items: list[schemas.ExpenseItemCreate]) -> list[schemas.ExpenseSplitBase]:
    """
    Calculate each person's share based on assigned items.

    Thin adapter over :func:`allocate_items`; see that function for the
    algorithm. Keys assignments as group participants, ignoring ad-hoc expense
    guests — use :func:`calculate_itemized_splits_with_expense_guests` when the
    expense may have any.
    """
    allocations = allocate_items(_allocation_inputs(items, get_participant_key))

    splits = []
    for key, amount in _totals_by_key(allocations).items():
        is_guest = key.startswith("guest_")
        user_id = int(key.split("_")[1])
        splits.append(schemas.ExpenseSplitBase(
            user_id=user_id,
            is_guest=is_guest,
            amount_owed=amount
        ))

    return splits


def calculate_itemized_splits_with_expense_guests(
    items: list[schemas.ExpenseItemCreate]
) -> Tuple[list[schemas.ExpenseSplitBase], Dict[str, int]]:
    """
    Calculate each person's share based on assigned items, supporting expense guests.

    Thin adapter over :func:`allocate_items`.

    Returns:
        - List of ExpenseSplitBase for registered users and group guests
        - Dict mapping temp_guest_id to amount_owed for expense guests
    """
    allocations = allocate_items(_allocation_inputs(items, get_assignment_key))

    splits = []
    expense_guest_amounts = {}

    for key, amount in _totals_by_key(allocations).items():
        if key.startswith("expense_guest_"):
            expense_guest_amounts[key.replace("expense_guest_", "")] = amount
        elif key.startswith("guest_"):
            splits.append(schemas.ExpenseSplitBase(
                user_id=int(key.split("_")[1]),
                is_guest=True,
                amount_owed=amount
            ))
        else:
            splits.append(schemas.ExpenseSplitBase(
                user_id=int(key.split("_")[1]),
                is_guest=False,
                amount_owed=amount
            ))

    return splits, expense_guest_amounts
