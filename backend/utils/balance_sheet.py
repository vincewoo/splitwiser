"""Balance-sheet aggregation: the settlement calculation, shown step by step.

``/groups/{id}/balances`` answers *what* you owe. This answers *why*, by
emitting every intermediate value between a receipt line and the final "pay
Priya $23.40": the item allocation, the currency conversion, the management
fold, the netting, and the greedy simplification.

Nothing here recomputes money maths that lives elsewhere. Item allocation comes
from ``utils.splits.allocate_items``, conversion and folding from
``utils.balances``, simplification from ``utils.balances.simplify``. If this
module disagrees with the Balances screen, that is a bug in this module, and
the ``matches_balances_endpoint`` check exists to catch exactly that.

Read-only. No writes, no commits.
"""

import datetime
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

import models
from utils.balances import (
    _detect_managed_cycles,
    _fold_managed_relationships,
    _managed_key_for_guest,
    calculate_net_balances,
    calculate_raw_balances,
    convert_split_to_currency,
    simplify,
    used_synthesized_rate,
)
from utils.splits import AllocationInput, allocate_items

logger = logging.getLogger(__name__)

# A participant key: (id, is_guest). The id spaces overlap — user 7 and guest 7
# are different people — so the flag is never optional.
Key = Tuple[int, bool]

USER = "user"
GROUP_GUEST = "group_guest"


def _person_type(is_guest: bool) -> str:
    return GROUP_GUEST if is_guest else USER


def _alloc_key(key: Key) -> str:
    """The string key form used by ``utils.splits``."""
    return f"{'guest' if key[1] else 'user'}_{key[0]}"


def _from_alloc_key(alloc_key: str) -> Optional[Key]:
    """Inverse of :func:`_alloc_key`; ``None`` for ad-hoc expense-guest keys."""
    prefix, _, raw_id = alloc_key.rpartition("_")
    if prefix == "user":
        return (int(raw_id), False)
    if prefix == "guest":
        return (int(raw_id), True)
    return None


@dataclass(frozen=True)
class PersonRow:
    key: Key
    display_name: str
    person_type: str
    status: str           # active | claimed_guest | managed | cycle_skipped
    managed_by: str       # display name of manager, or ""
    note: str


@dataclass(frozen=True)
class LedgerRow:
    row_type: str         # EXPENSE | ITEM | ITEM_SHARE | SPLIT | RECONCILIATION
    expense_id: int
    expense_description: str
    date: str
    payer_name: str
    payer_type: str
    item_id: Optional[int]
    item_description: str
    is_tax_tip: Optional[bool]
    person_name: str
    person_id: Optional[int]
    person_type: str
    split_type: str
    currency: str
    amount_cents: int
    exchange_rate: str
    converted_cents: Optional[int]
    note: str


@dataclass(frozen=True)
class AmountRow:
    """A per-person total in one native currency, plus its converted value."""

    key: Key
    display_name: str
    person_type: str
    currency: str
    amount_cents: int
    converted_cents: int
    note: str


@dataclass(frozen=True)
class ConversionRow:
    currency: str
    target_currency: str
    expense_count: int
    historical_rates: str      # distinct stored rates, comma-joined
    synthesized_count: int
    note: str


@dataclass(frozen=True)
class ManagementRow:
    source_name: str
    source_id: int
    source_type: str
    manager_name: str
    manager_id: Optional[int]
    manager_type: str
    amount_cents: int
    currency: str
    reason: str
    folded: bool
    note: str


@dataclass(frozen=True)
class IdentityRow:
    guest_id: int
    guest_name: str
    claimed_by_id: int
    claimed_by_name: str
    rows_still_under_guest: int
    note: str


@dataclass(frozen=True)
class NetRow:
    key: Key
    display_name: str
    person_type: str
    consumed_cents: int
    paid_cents: int
    net_cents: int
    currency: str
    note: str


@dataclass(frozen=True)
class TransactionRow:
    from_name: str
    from_id: int
    from_type: str
    to_name: str
    to_id: int
    to_type: str
    amount_cents: int
    currency: str


@dataclass(frozen=True)
class CheckRow:
    check: str
    passed: bool
    detail: str
    # A real finding that is not a problem. Derived rather than stored
    # alongside a separate severity string, so the two cannot contradict
    # each other: a row that did not pass is a failure, full stop.
    notice: bool = False

    @property
    def severity(self) -> str:
        if not self.passed:
            return "fail"
        return "notice" if self.notice else "pass"


@dataclass
class BalanceSheet:
    group_id: int
    group_name: str
    currency: str
    generated_at: str
    generated_for: str
    rate_note: str
    people: List[PersonRow] = field(default_factory=list)
    ledger: List[LedgerRow] = field(default_factory=list)
    consumption: List[AmountRow] = field(default_factory=list)
    paid: List[AmountRow] = field(default_factory=list)
    conversion: List[ConversionRow] = field(default_factory=list)
    management: List[ManagementRow] = field(default_factory=list)
    identity: List[IdentityRow] = field(default_factory=list)
    net: List[NetRow] = field(default_factory=list)
    simplified: List[TransactionRow] = field(default_factory=list)
    checks: List[CheckRow] = field(default_factory=list)


class _Names:
    """Display names for every participant, resolved once and batched.

    Two distinct questions, deliberately kept apart:

    * :meth:`ledger_name` — what the *row* recorded. A group guest is named as
      the guest, always, even after somebody claimed that guest, because the
      receipt was split with "Dave the guest" and pretending otherwise is how
      the export would start lying about history.
    * :meth:`display_name` — who the balance belongs to *now*, matching what
      ``/groups/{id}/balances`` shows.
    """

    def __init__(self, db: Session, group_id: int, keys: List[Key]):
        user_ids = {k[0] for k in keys if not k[1]}
        guest_ids = {k[0] for k in keys if k[1]}

        self.guests: Dict[int, models.GuestMember] = {
            g.id: g
            for g in db.query(models.GuestMember).filter(
                models.GuestMember.group_id == group_id
            ).all()
        }
        guest_ids |= set(self.guests)
        # A claimed guest's balance is displayed under the claiming user.
        user_ids |= {g.claimed_by_id for g in self.guests.values() if g.claimed_by_id}

        self.users: Dict[int, models.User] = {}
        if user_ids:
            self.users = {
                u.id: u
                for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all()
            }
        if guest_ids:
            missing = guest_ids - set(self.guests)
            if missing:
                for g in db.query(models.GuestMember).filter(
                    models.GuestMember.id.in_(missing)
                ).all():
                    self.guests[g.id] = g

    def user_name(self, user_id: int) -> str:
        user = self.users.get(user_id)
        if not user:
            return f"Unknown user {user_id}"
        return user.full_name or user.email

    def ledger_name(self, key: Key) -> str:
        person_id, is_guest = key
        if not is_guest:
            return self.user_name(person_id)
        guest = self.guests.get(person_id)
        return guest.name if guest else f"Unknown guest {person_id}"

    def display_name(self, key: Key) -> str:
        person_id, is_guest = key
        if not is_guest:
            return self.user_name(person_id)
        guest = self.guests.get(person_id)
        if not guest:
            return f"Unknown guest {person_id}"
        if guest.claimed_by_id:
            return self.user_name(guest.claimed_by_id)
        return guest.name


def _reconciliation_note(delta: int, rounding_only: bool, has_claimed_guests: bool) -> str:
    """Explain one reconciliation row in terms of what actually happened."""
    direction = (
        "stored split exceeds the sum of item shares by this much"
        if delta > 0
        else "stored split falls short of the sum of item shares by this much"
    )
    if not rounding_only:
        return direction

    note = (
        "rounding only — the expense still totals the same, but leftover cents "
        "sit with a different person than when it was saved"
    )
    if has_claimed_guests:
        # Naming the cause saves the reader from having to work out that
        # allocation keys sort differently once a guest becomes an account.
        note += "; participants have been re-identified since (see IDENTITY)"
    return note


def _to_cents(amount: float) -> int:
    """Round a converted amount to whole cents for presentation."""
    return round(amount)


def _item_keys(
    assignments: List[models.ExpenseItemAssignment],
) -> Tuple[List[str], int]:
    """Allocation keys for one item's assignments, plus a count of ad-hoc guests.

    Ad-hoc expense guests cannot legally be on a group expense
    (``routers/expenses.py`` rejects them), so their count feeds a check rather
    than an allocation.
    """
    keys: List[str] = []
    expense_guest_count = 0
    for assignment in assignments:
        if assignment.expense_guest_id is not None:
            expense_guest_count += 1
            continue
        keys.append(f"{'guest' if assignment.is_guest else 'user'}_{assignment.user_id}")
    return keys, expense_guest_count


def build_balance_sheet(
    db: Session,
    group_id: int,
    generated_for: str = "",
) -> BalanceSheet:
    """Assemble the full balance sheet for one group.

    All amounts are integer cents in the group's default currency, except the
    ledger's native ``amount_cents`` which stays in each expense's own currency
    alongside a converted column.
    """
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    currency = (group.default_currency if group else None) or "USD"
    group_name = group.name if group else f"Group {group_id}"

    expenses = db.query(models.Expense).filter(
        models.Expense.group_id == group_id
    ).all()
    expenses.sort(key=lambda e: (e.date or "", e.id))
    expense_ids = [e.id for e in expenses]

    splits_by_expense: Dict[int, List[models.ExpenseSplit]] = {}
    items_by_expense: Dict[int, List[models.ExpenseItem]] = {}
    assignments_by_item: Dict[int, List[models.ExpenseItemAssignment]] = {}

    if expense_ids:
        for split in db.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id.in_(expense_ids)
        ).all():
            splits_by_expense.setdefault(split.expense_id, []).append(split)

        items = db.query(models.ExpenseItem).filter(
            models.ExpenseItem.expense_id.in_(expense_ids)
        ).all()
        for item in items:
            items_by_expense.setdefault(item.expense_id, []).append(item)

        item_ids = [i.id for i in items]
        if item_ids:
            for assignment in db.query(models.ExpenseItemAssignment).filter(
                models.ExpenseItemAssignment.expense_item_id.in_(item_ids)
            ).all():
                assignments_by_item.setdefault(
                    assignment.expense_item_id, []
                ).append(assignment)

    for expense_splits in splits_by_expense.values():
        expense_splits.sort(key=lambda s: s.id)
    for expense_items in items_by_expense.values():
        expense_items.sort(key=lambda i: i.id)
    for item_assignments in assignments_by_item.values():
        item_assignments.sort(key=lambda a: a.id)

    # ------------------------------------------------------------------ people
    keys: List[Key] = []
    for expense in expenses:
        keys.append((expense.payer_id, bool(expense.payer_is_guest)))
        for split in splits_by_expense.get(expense.id, []):
            keys.append((split.user_id, bool(split.is_guest)))
    for member in db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id
    ).all():
        keys.append((member.user_id, False))

    names = _Names(db, group_id, keys)

    managed_guests = [g for g in names.guests.values() if g.managed_by_id]
    managed_members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id,
        models.GroupMember.managed_by_id != None
    ).all()
    cyclic_keys = _detect_managed_cycles(managed_guests, managed_members)

    # Claiming or merging a guest rewrites its rows onto an account, which
    # changes the allocation keys and therefore who absorbs the remainder cents.
    # Knowing that lets a reconciliation row name its own cause.
    has_claimed_guests = any(g.claimed_by_id for g in names.guests.values())

    # --------------------------------------------------------------- the ledger
    ledger: List[LedgerRow] = []
    consumption: Dict[Tuple[Key, str], int] = {}   # native cents
    paid: Dict[Tuple[Key, str], int] = {}
    consumption_target: Dict[Key, float] = {}      # converted, unrounded
    paid_target: Dict[Key, float] = {}
    # Converted totals per native currency. Each expense converts at its own
    # stored rate, so a currency's total cannot be re-derived from one rate.
    consumption_conv: Dict[Tuple[Key, str], float] = {}
    paid_conv: Dict[Tuple[Key, str], float] = {}
    currencies_used: Dict[str, Dict[str, object]] = {}
    expense_guest_assignments = 0
    real_mismatches: List[str] = []
    rounding_reassignments: List[str] = []
    split_total_mismatches: List[str] = []

    for expense in expenses:
        expense_currency = expense.currency or "USD"
        payer_key = (expense.payer_id, bool(expense.payer_is_guest))
        expense_splits = splits_by_expense.get(expense.id, [])

        seen = currencies_used.setdefault(
            expense_currency,
            {"count": 0, "rates": set(), "synthesized": 0},
        )
        seen["count"] += 1
        if expense.exchange_rate:
            seen["rates"].add(str(expense.exchange_rate))
        if used_synthesized_rate(expense):
            seen["synthesized"] += 1

        expense_note = "settlement payment" if expense.is_settlement else ""
        split_sum = sum(s.amount_owed for s in expense_splits)
        if expense.amount is not None and split_sum != expense.amount:
            split_total_mismatches.append(
                f"expense {expense.id}: splits {split_sum} vs total {expense.amount}"
            )

        ledger.append(LedgerRow(
            row_type="EXPENSE",
            expense_id=expense.id,
            expense_description=expense.description or "",
            date=expense.date or "",
            payer_name=names.ledger_name(payer_key),
            payer_type=_person_type(payer_key[1]),
            item_id=None,
            item_description="",
            is_tax_tip=None,
            person_name="",
            person_id=None,
            person_type="",
            split_type=expense.split_type or "EQUAL",
            currency=expense_currency,
            amount_cents=expense.amount or 0,
            exchange_rate=str(expense.exchange_rate or ""),
            converted_cents=_to_cents(
                convert_split_to_currency(expense.amount or 0, expense, currency)
            ),
            note=expense_note,
        ))

        # -- itemized detail: recomputed, never authoritative
        allocations_by_key: Dict[Key, int] = {}
        items = items_by_expense.get(expense.id, [])
        if items:
            allocation_inputs = []
            for item in items:
                item_assignments = assignments_by_item.get(item.id, [])
                item_keys, guest_count = _item_keys(item_assignments)
                expense_guest_assignments += guest_count
                try:
                    details = json.loads(item.split_details) if item.split_details else {}
                except (ValueError, TypeError):
                    details = {}
                allocation_inputs.append(AllocationInput(
                    price=item.price,
                    keys=item_keys,
                    item_id=item.id,
                    is_tax_tip=bool(item.is_tax_tip),
                    split_type=item.split_type or "EQUAL",
                    split_details=details,
                ))

            allocations = allocate_items(allocation_inputs)
            allocations_by_item: Dict[Optional[int], List] = {}
            for allocation in allocations:
                allocations_by_item.setdefault(allocation.item_id, []).append(allocation)
                participant = _from_alloc_key(allocation.key)
                if participant is not None:
                    allocations_by_key[participant] = (
                        allocations_by_key.get(participant, 0) + allocation.total_cents
                    )

            for item in items:
                ledger.append(LedgerRow(
                    row_type="ITEM",
                    expense_id=expense.id,
                    expense_description=expense.description or "",
                    date=expense.date or "",
                    payer_name=names.ledger_name(payer_key),
                    payer_type=_person_type(payer_key[1]),
                    item_id=item.id,
                    item_description=item.description or "",
                    is_tax_tip=bool(item.is_tax_tip),
                    person_name="",
                    person_id=None,
                    person_type="",
                    split_type=item.split_type or "EQUAL",
                    currency=expense_currency,
                    amount_cents=item.price,
                    exchange_rate="",
                    converted_cents=None,
                    note=(
                        "spread across everyone in proportion to their subtotal"
                        if item.is_tax_tip
                        else f"shared by {len(assignments_by_item.get(item.id, []))}"
                    ),
                ))
                for allocation in allocations_by_item.get(item.id, []):
                    participant = _from_alloc_key(allocation.key)
                    ledger.append(LedgerRow(
                        row_type="ITEM_SHARE",
                        expense_id=expense.id,
                        expense_description=expense.description or "",
                        date=expense.date or "",
                        payer_name=names.ledger_name(payer_key),
                        payer_type=_person_type(payer_key[1]),
                        item_id=item.id,
                        item_description=item.description or "",
                        is_tax_tip=bool(item.is_tax_tip),
                        person_name=names.ledger_name(participant) if participant else allocation.key,
                        person_id=participant[0] if participant else None,
                        person_type=_person_type(participant[1]) if participant else "expense_guest",
                        split_type=item.split_type or "EQUAL",
                        currency=expense_currency,
                        amount_cents=allocation.total_cents,
                        exchange_rate="",
                        converted_cents=None,
                        note=allocation.note,
                    ))

            # Pooled tax/tip is allocated against each person's whole subtotal,
            # so it belongs to no single line.
            pooled = allocations_by_item.get(None, [])
            if pooled:
                tax_tip_items = [i for i in items if i.is_tax_tip]
                label = (
                    tax_tip_items[0].description
                    if len(tax_tip_items) == 1
                    else "Tax & tip (all lines)"
                )
                for allocation in pooled:
                    participant = _from_alloc_key(allocation.key)
                    ledger.append(LedgerRow(
                        row_type="ITEM_SHARE",
                        expense_id=expense.id,
                        expense_description=expense.description or "",
                        date=expense.date or "",
                        payer_name=names.ledger_name(payer_key),
                        payer_type=_person_type(payer_key[1]),
                        item_id=None,
                        item_description=label,
                        is_tax_tip=True,
                        person_name=names.ledger_name(participant) if participant else allocation.key,
                        person_id=participant[0] if participant else None,
                        person_type=_person_type(participant[1]) if participant else "expense_guest",
                        split_type="PROPORTIONAL",
                        currency=expense_currency,
                        amount_cents=allocation.total_cents,
                        exchange_rate="",
                        converted_cents=None,
                        note=allocation.note,
                    ))

        # -- how the recomputed item shares differ from the stored splits
        #
        # Two very different things produce a difference, and conflating them
        # makes the check useless. If an expense's deltas sum to zero and are
        # within the rounding bound, the same total was simply allocated to
        # different people: `allocate_items` hands leftover cents to the last
        # participant key in sorted order, and those keys change when somebody
        # claims a guest (guest_59 becomes user_28, which sorts elsewhere), so
        # a recomputation lands the remainder on a different person than the
        # write did. Nobody owes a different amount. A non-zero sum, or a
        # difference too large to be remainder cents, means money was actually
        # invented or lost — that is the real failure.
        deltas: Dict[Key, int] = {}
        if items:
            for split in expense_splits:
                key = (split.user_id, bool(split.is_guest))
                if key in allocations_by_key:
                    delta = split.amount_owed - allocations_by_key[key]
                    if delta:
                        deltas[key] = delta

        # At most one remainder cent per line, plus one for the pooled tax/tip.
        rounding_bound = len(items) + 1
        rounding_only = bool(deltas) and sum(deltas.values()) == 0 and max(
            abs(d) for d in deltas.values()
        ) <= rounding_bound

        if deltas:
            label = f"expense {expense.id} ({expense.description or 'untitled'})"
            if rounding_only:
                # Everything nets off, so the interesting number is how much
                # changed hands between people.
                moved = sum(d for d in deltas.values() if d > 0)
                rounding_reassignments.append(
                    f"{label}: {moved} cent(s) across {len(deltas)} people"
                )
            else:
                residual = sum(deltas.values())
                largest = max(abs(d) for d in deltas.values())
                real_mismatches.append(
                    f"{label}: differs for {len(deltas)} people, "
                    f"largest {largest} cent(s), residual {residual} cent(s)"
                )

        # -- the stored splits, which are what balances are actually built from
        for split in expense_splits:
            split_key = (split.user_id, bool(split.is_guest))
            converted = convert_split_to_currency(split.amount_owed, expense, currency)

            note = "stored"
            if (expense.split_type or "") == "PERCENTAGE" and split.percentage is not None:
                note = f"{split.percentage}% of total"
            elif (expense.split_type or "") == "SHARES" and split.shares is not None:
                note = f"{split.shares} shares"
            elif (expense.split_type or "") == "EQUAL":
                note = f"1 of {len(expense_splits)} equal shares"

            ledger.append(LedgerRow(
                row_type="SPLIT",
                expense_id=expense.id,
                expense_description=expense.description or "",
                date=expense.date or "",
                payer_name=names.ledger_name(payer_key),
                payer_type=_person_type(payer_key[1]),
                item_id=None,
                item_description="",
                is_tax_tip=None,
                person_name=names.ledger_name(split_key),
                person_id=split_key[0],
                person_type=_person_type(split_key[1]),
                split_type=expense.split_type or "EQUAL",
                currency=expense_currency,
                amount_cents=split.amount_owed,
                exchange_rate=str(expense.exchange_rate or ""),
                converted_cents=_to_cents(converted),
                note=note,
            ))

            consumption[(split_key, expense_currency)] = (
                consumption.get((split_key, expense_currency), 0) + split.amount_owed
            )
            paid[(payer_key, expense_currency)] = (
                paid.get((payer_key, expense_currency), 0) + split.amount_owed
            )
            consumption_target[split_key] = consumption_target.get(split_key, 0) + converted
            paid_target[payer_key] = paid_target.get(payer_key, 0) + converted
            consumption_conv[(split_key, expense_currency)] = (
                consumption_conv.get((split_key, expense_currency), 0) + converted
            )
            paid_conv[(payer_key, expense_currency)] = (
                paid_conv.get((payer_key, expense_currency), 0) + converted
            )

            # -- reconciliation: recomputed item shares vs the stored split
            if split_key in deltas:
                delta = deltas[split_key]
                ledger.append(LedgerRow(
                    row_type="RECONCILIATION",
                    expense_id=expense.id,
                    expense_description=expense.description or "",
                    date=expense.date or "",
                    payer_name=names.ledger_name(payer_key),
                    payer_type=_person_type(payer_key[1]),
                    item_id=None,
                    item_description="",
                    is_tax_tip=None,
                    person_name=names.ledger_name(split_key),
                    person_id=split_key[0],
                    person_type=_person_type(split_key[1]),
                    split_type=expense.split_type or "EQUAL",
                    currency=expense_currency,
                    amount_cents=delta,
                    exchange_rate="",
                    converted_cents=None,
                    note=_reconciliation_note(delta, rounding_only, has_claimed_guests),
                ))

    # ------------------------------------------------- consumption / paid rows
    consumption_rows = [
        AmountRow(
            key=key,
            display_name=names.ledger_name(key),
            person_type=_person_type(key[1]),
            currency=native_currency,
            amount_cents=amount,
            converted_cents=_to_cents(consumption_conv[(key, native_currency)]),
            note="" if native_currency == currency else f"converted to {currency}",
        )
        for (key, native_currency), amount in sorted(
            consumption.items(), key=lambda kv: (names.ledger_name(kv[0][0]), kv[0][1])
        )
    ]
    paid_rows = [
        AmountRow(
            key=key,
            display_name=names.ledger_name(key),
            person_type=_person_type(key[1]),
            currency=native_currency,
            amount_cents=amount,
            converted_cents=_to_cents(paid_conv[(key, native_currency)]),
            note="" if native_currency == currency else f"converted to {currency}",
        )
        for (key, native_currency), amount in sorted(
            paid.items(), key=lambda kv: (names.ledger_name(kv[0][0]), kv[0][1])
        )
    ]

    # ----------------------------------------------------------------- folding
    raw_scalar = calculate_raw_balances(db, group_id, currency)
    folded_consumption = dict(consumption_target)
    folded_paid = dict(paid_target)
    _fold_managed_relationships(db, group_id, folded_consumption)
    _fold_managed_relationships(db, group_id, folded_paid)

    management_rows: List[ManagementRow] = []
    for guest in sorted(managed_guests, key=lambda g: g.id):
        source_key = _managed_key_for_guest(guest)
        manager_key = (guest.managed_by_id, guest.managed_by_type == "guest")
        skipped_reason = ""
        if guest.claimed_by_id and guest.managed_by_id:
            skipped_reason = (
                "guest is both claimed and managed; the fold skips it to avoid "
                "counting the same person twice"
            )
        elif source_key in cyclic_keys or manager_key in cyclic_keys:
            skipped_reason = "management chain forms a cycle; not folded"

        management_rows.append(ManagementRow(
            source_name=guest.name,
            source_id=guest.id,
            source_type=GROUP_GUEST,
            manager_name=names.display_name(manager_key),
            manager_id=manager_key[0],
            manager_type=_person_type(manager_key[1]),
            amount_cents=_to_cents(raw_scalar.get(source_key, 0)),
            currency=currency,
            reason="claimed guest, managed" if guest.claimed_by_id else "managed guest",
            folded=not skipped_reason,
            note=skipped_reason,
        ))

    for member in sorted(managed_members, key=lambda m: m.user_id):
        source_key = (member.user_id, False)
        manager_key = (member.managed_by_id, member.managed_by_type == "guest")
        skipped_reason = ""
        if source_key in cyclic_keys or manager_key in cyclic_keys:
            skipped_reason = "management chain forms a cycle; not folded"
        management_rows.append(ManagementRow(
            source_name=names.display_name(source_key),
            source_id=member.user_id,
            source_type=USER,
            manager_name=names.display_name(manager_key),
            manager_id=manager_key[0],
            manager_type=_person_type(manager_key[1]),
            amount_cents=_to_cents(raw_scalar.get(source_key, 0)),
            currency=currency,
            reason="managed member",
            folded=not skipped_reason,
            note=skipped_reason,
        ))

    # ---------------------------------------------------------------- identity
    ledger_keys = {(r.person_id, r.person_type == GROUP_GUEST) for r in ledger if r.person_id}
    identity_rows: List[IdentityRow] = []
    for guest in sorted(names.guests.values(), key=lambda g: g.id):
        if not guest.claimed_by_id:
            continue
        still_present = sum(
            1 for r in ledger
            if r.row_type == "SPLIT" and r.person_id == guest.id and r.person_type == GROUP_GUEST
        )
        identity_rows.append(IdentityRow(
            guest_id=guest.id,
            guest_name=guest.name,
            claimed_by_id=guest.claimed_by_id,
            claimed_by_name=names.user_name(guest.claimed_by_id),
            rows_still_under_guest=still_present,
            note=(
                "history was merged onto the account, so ledger rows above show "
                "the account's name"
                if still_present == 0
                else "ledger rows above still record the guest; their balance is "
                     "counted under the account"
            ),
        ))

    # ------------------------------------------------------------ net balances
    net_keys = sorted(
        set(folded_consumption) | set(folded_paid),
        key=lambda k: names.display_name(k),
    )
    net_rows: List[NetRow] = []
    net_scalar: Dict[Key, float] = {}
    for key in net_keys:
        consumed = folded_consumption.get(key, 0)
        was_paid = folded_paid.get(key, 0)
        net = was_paid - consumed
        net_scalar[key] = net
        note = ""
        if key in cyclic_keys:
            note = "not folded into a manager: management chain forms a cycle"
        net_rows.append(NetRow(
            key=key,
            display_name=names.display_name(key),
            person_type=_person_type(key[1]),
            consumed_cents=_to_cents(consumed),
            paid_cents=_to_cents(was_paid),
            net_cents=_to_cents(net),
            currency=currency,
            note=note,
        ))

    # ---------------------------------------------------------- simplification
    transactions = simplify(net_scalar, currency)
    simplified_rows = [
        TransactionRow(
            from_name=names.display_name((t["from_id"], t["from_is_guest"])),
            from_id=t["from_id"],
            from_type=_person_type(t["from_is_guest"]),
            to_name=names.display_name((t["to_id"], t["to_is_guest"])),
            to_id=t["to_id"],
            to_type=_person_type(t["to_is_guest"]),
            amount_cents=_to_cents(t["amount"]),
            currency=currency,
        )
        for t in transactions
    ]

    # ------------------------------------------------------------------ people
    roster_keys = sorted(
        set(net_scalar) | set(raw_scalar) | ledger_keys,
        key=lambda k: names.display_name(k),
    )
    managed_source_keys = {
        _managed_key_for_guest(g): g for g in managed_guests
    }
    managed_member_keys = {(m.user_id, False): m for m in managed_members}
    people_rows: List[PersonRow] = []
    for key in roster_keys:
        person_id, is_guest = key
        guest = names.guests.get(person_id) if is_guest else None
        status = "active"
        note = ""
        manager_name = ""
        if guest and guest.claimed_by_id:
            status = "claimed_guest"
            note = f"claimed by {names.user_name(guest.claimed_by_id)}"
        if key in managed_source_keys or key in managed_member_keys:
            status = "managed"
            source = managed_source_keys.get(key) or managed_member_keys.get(key)
            manager_name = names.display_name(
                (source.managed_by_id, source.managed_by_type == "guest")
            )
        if key in cyclic_keys:
            status = "cycle_skipped"
            note = "management chain forms a cycle; balance left standalone"
        people_rows.append(PersonRow(
            key=key,
            display_name=names.display_name(key),
            person_type=_person_type(is_guest),
            status=status,
            managed_by=manager_name,
            note=note,
        ))

    # -------------------------------------------------------------- conversion
    conversion_rows = [
        ConversionRow(
            currency=code,
            target_currency=currency,
            expense_count=int(seen["count"]),
            historical_rates=", ".join(sorted(seen["rates"])) or "none stored",
            synthesized_count=int(seen["synthesized"]),
            note=(
                "converted at the rate stored on each expense, then to the group "
                "currency at today's rate"
                if code != currency
                else "no conversion needed"
            ),
        )
        for code, seen in sorted(currencies_used.items())
    ]

    # ------------------------------------------------------------------ checks
    checks: List[CheckRow] = []

    net_sum = sum(net_scalar.values())
    checks.append(CheckRow(
        check="net_balances_sum_to_zero",
        passed=abs(net_sum) < 1.0,
        detail=f"residual {_to_cents(net_sum)} cents",
    ))

    checks.append(CheckRow(
        check="splits_match_expense_totals",
        passed=not split_total_mismatches,
        detail="; ".join(split_total_mismatches[:5]) or "every expense's splits sum to its total",
    ))

    checks.append(CheckRow(
        check="item_shares_match_splits",
        passed=not real_mismatches,
        detail=(
            "; ".join(real_mismatches[:5])
            if real_mismatches
            else "recomputed item shares match the stored splits"
        ),
    ))

    if rounding_reassignments:
        # Deliberately not a failure: the totals agree and no balance moves.
        # Reporting it as one would train the reader to ignore this block.
        checks.append(CheckRow(
            check="item_share_rounding_reassigned",
            passed=True,
            notice=True,
            detail=(
                "; ".join(rounding_reassignments[:5])
                + ". Leftover cents sit with a different person than at write "
                "time; totals and balances are unaffected"
                + (
                    ", and participants have been re-identified since (see IDENTITY)"
                    if has_claimed_guests
                    else ""
                )
            ),
        ))

    per_person_simplified: Dict[Key, float] = {}
    for t in transactions:
        per_person_simplified[(t["from_id"], t["from_is_guest"])] = (
            per_person_simplified.get((t["from_id"], t["from_is_guest"]), 0) - t["amount"]
        )
        per_person_simplified[(t["to_id"], t["to_is_guest"])] = (
            per_person_simplified.get((t["to_id"], t["to_is_guest"]), 0) + t["amount"]
        )
    simplified_mismatch = [
        names.display_name(key)
        for key, net in net_scalar.items()
        if abs(net - per_person_simplified.get(key, 0)) >= 1.0
    ]
    checks.append(CheckRow(
        check="simplified_matches_net",
        passed=not simplified_mismatch,
        detail=(
            "differs for " + ", ".join(simplified_mismatch[:5])
            if simplified_mismatch
            else "every person's payments add up to their net balance"
        ),
    ))

    endpoint_balances = calculate_net_balances(db, group_id, currency)
    endpoint_mismatch = [
        names.display_name(key)
        for key in set(endpoint_balances) | set(net_scalar)
        if abs(endpoint_balances.get(key, 0) - net_scalar.get(key, 0)) >= 1.0
    ]
    checks.append(CheckRow(
        check="matches_balances_endpoint",
        passed=not endpoint_mismatch,
        detail=(
            "differs for " + ", ".join(endpoint_mismatch[:5])
            if endpoint_mismatch
            else "this sheet agrees with the group's Balances screen"
        ),
    ))

    claimed_and_managed = [
        g.name for g in managed_guests if g.claimed_by_id and g.managed_by_id
    ]
    checks.append(CheckRow(
        check="no_claimed_and_managed_guests",
        passed=not claimed_and_managed,
        detail=", ".join(claimed_and_managed) or "none",
    ))

    checks.append(CheckRow(
        check="no_managed_cycles",
        passed=not cyclic_keys,
        detail=(
            ", ".join(names.display_name(k) for k in sorted(cyclic_keys))
            if cyclic_keys
            else "none"
        ),
    ))

    checks.append(CheckRow(
        check="no_expense_guests_on_group_expenses",
        passed=expense_guest_assignments == 0,
        detail=(
            f"{expense_guest_assignments} item assignment(s) reference an ad-hoc "
            "expense guest and were not allocated"
            if expense_guest_assignments
            else "none"
        ),
    ))

    for check in checks:
        if not check.passed:
            logger.warning(
                "balance sheet check failed for group_id=%s: %s (%s)",
                group_id,
                check.check,
                check.detail,
            )

    synthesized_total = sum(int(s["synthesized"]) for s in currencies_used.values())
    rate_note = ""
    if synthesized_total:
        rate_note = (
            f"{synthesized_total} expense(s) had no stored historical rate; "
            "today's rate was used instead"
        )

    return BalanceSheet(
        group_id=group_id,
        group_name=group_name,
        currency=currency,
        generated_at=datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        generated_for=generated_for,
        rate_note=rate_note,
        people=people_rows,
        ledger=ledger,
        consumption=consumption_rows,
        paid=paid_rows,
        conversion=conversion_rows,
        management=management_rows,
        identity=identity_rows,
        net=net_rows,
        simplified=simplified_rows,
        checks=checks,
    )
