"""
Group spending-summary aggregation.

This module exposes :func:`calculate_consumption_summary`, a read-only primitive
that computes how much each member of a group has *consumed* (i.e. owed on
splits) over the lifetime of the group, broken out by time-bucket and by member.

Design notes (see ``docs/plans/2026-04-17-001-feat-group-spending-summary-plan.md``):

* **Settlements are excluded.** Expenses with ``is_settlement == True`` are
  filtered out entirely. This filter is local to this primitive — the existing
  ``calculate_net_balances`` in ``utils.balances`` does NOT filter settlements.
* **Integer cents.** All monetary values are integer cents. The split-level
  conversion is truncated to ``int`` (matching ``calculate_net_balances``'s
  behavior at the response boundary), so higher-granularity totals formed by
  summing truncated split cents are exact and need no further truncation.
* **Group total is Σ converted split.amount_owed.** Not ``Σ expense.amount``.
  This preserves the invariant ``group_total == Σ members[].total ==
  Σ series[].total == Σ series[].per_member[].amount`` by construction, and
  is robust to payer-not-in-splits legacy data.
* **Hybrid two-leg currency conversion** (same as Balances):
    1. Historical leg → USD using ``Expense.exchange_rate`` if present;
       otherwise fall back to ``convert_to_usd`` (static rates).
    2. Static leg → target currency via ``convert_currency``.
* **``has_synthesized_historical_rate``** fires when — AND ONLY WHEN — leg 1
  fell back to ``convert_to_usd`` because ``Expense.exchange_rate`` was null
  AND the expense currency is not USD. Same-USD expenses with a null rate are
  no-ops and do not count as synthesis.
* **Three-tier granularity** keyed off non-settlement date span:
  ``< 3 months → week``, ``3–18 months → month``, ``≥ 18 months → quarter``.
  Empty groups default to ``"month"``.
* **ExpenseGuest / per-item expense-guest consumption is not counted.**
  Only rows in ``ExpenseSplit`` contribute. This is scoped as a v1 non-goal
  because ``expenses.py`` already rejects ExpenseGuests on group expenses —
  the scope-out is defensive against legacy data.
"""

import datetime
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, TypedDict

from sqlalchemy.orm import Session

import models
from routers.expenses import normalize_date
from utils.balances import _detect_managed_cycles, _managed_key_for_guest
from utils.currency import convert_currency, convert_to_usd
from utils.display import get_participant_display_name


logger = logging.getLogger(__name__)


# Thresholds for granularity selection. Values are in days.
# Reasoning:
#   - "< 3 months" → about one calendar quarter. Anything shorter than that
#     gets bucketed weekly so short trips / single-month groups render with
#     useful resolution.
#   - "3–18 months" → cover roughly one typical financial year + some slack.
#     Monthly is the natural unit there.
#   - "≥ 18 months" → long-running household / recurring-cost groups. Weekly
#     or monthly bars become too noisy; quarterly gives a readable axis.
_WEEK_SPAN_DAYS = 90          # ≈ 3 months
_QUARTER_SPAN_DAYS = 18 * 30  # ≈ 18 months


# Public return shape -------------------------------------------------------


class ManagedMemberBreakdown(TypedDict):
    """Per-managed-member breakdown entry folded into a manager's row."""
    display_name: str
    total: int


@dataclass
class SummaryMember:
    user_id: int
    is_guest: bool
    display_name: str
    total: int
    managed_members: List[ManagedMemberBreakdown] = field(default_factory=list)


@dataclass
class SummarySeriesPointMember:
    user_id: int
    is_guest: bool
    amount: int


@dataclass
class SummarySeriesPoint:
    period_label: str
    period_start: str  # ISO date YYYY-MM-DD
    total: int
    per_member: List[SummarySeriesPointMember] = field(default_factory=list)


@dataclass
class ConsumptionSummary:
    group_total: int
    currency: str
    granularity: str  # "week" | "month" | "quarter"
    has_synthesized_historical_rate: bool
    skipped_unparseable_dates: int
    members: List[SummaryMember] = field(default_factory=list)
    series: List[SummarySeriesPoint] = field(default_factory=list)


# Period-key helpers --------------------------------------------------------


def _select_granularity(min_date: datetime.date, max_date: datetime.date) -> str:
    """Three-tier granularity selection keyed off the non-settlement date span."""
    span_days = (max_date - min_date).days
    if span_days < _WEEK_SPAN_DAYS:
        return "week"
    if span_days < _QUARTER_SPAN_DAYS:
        return "month"
    return "quarter"


def _period_key(d: datetime.date, granularity: str) -> Tuple[str, datetime.date]:
    """
    Return the (period_label, period_start) for date ``d`` at ``granularity``.

    ``period_start`` is the first day of the bucket so the frontend can sort
    chronologically without reparsing the label.
    """
    if granularity == "week":
        iso_year, iso_week, _ = d.isocalendar()
        # Monday of that ISO week.
        start = datetime.date.fromisocalendar(iso_year, iso_week, 1)
        return f"{iso_year:04d}-W{iso_week:02d}", start

    if granularity == "month":
        start = datetime.date(d.year, d.month, 1)
        return f"{d.year:04d}-{d.month:02d}", start

    # quarter
    quarter = (d.month - 1) // 3 + 1
    start = datetime.date(d.year, 3 * (quarter - 1) + 1, 1)
    return f"{d.year:04d}-Q{quarter}", start


def _next_period_start(period_start: datetime.date, granularity: str) -> datetime.date:
    """Advance a bucket start-date to the next bucket's start-date."""
    if granularity == "week":
        return period_start + datetime.timedelta(days=7)

    if granularity == "month":
        year = period_start.year + (1 if period_start.month == 12 else 0)
        month = 1 if period_start.month == 12 else period_start.month + 1
        return datetime.date(year, month, 1)

    # quarter — always aligned to Jan / Apr / Jul / Oct on the 1st
    month = period_start.month + 3
    year = period_start.year
    if month > 12:
        month -= 12
        year += 1
    return datetime.date(year, month, 1)


# Core primitive ------------------------------------------------------------


def calculate_consumption_summary(
    db: Session,
    group_id: int,
    target_currency: str,
) -> ConsumptionSummary:
    """
    Aggregate per-member consumption totals, bucketed series, and a synthesized-rate
    flag for a group.

    Args:
        db: Database session.
        group_id: ID of the group to summarize.
        target_currency: Output currency (typically ``group.default_currency``).

    Returns:
        A :class:`ConsumptionSummary` with:
          * ``group_total``     — int cents, Σ converted ``split.amount_owed``.
          * ``currency``        — the passed-through ``target_currency``.
          * ``granularity``     — ``"week" | "month" | "quarter"``.
          * ``has_synthesized_historical_rate`` — True iff leg-1 fallback fired
            for any expense whose currency was not USD.
          * ``skipped_unparseable_dates`` — count of expenses skipped because
            their ``date`` field could not be parsed. Surfaces silently-bad
            data.
          * ``members[]``       — one row per top-level member (managed members
            folded in), sorted by ``total`` descending.
          * ``series[]``        — one entry per time bucket between min and
            max expense date, with zero-valued buckets inserted for periods
            with no spending.

    Notes:
        * Settlements (``expense.is_settlement == True``) are filtered out.
        * Expense-guest consumption (ExpenseGuest / ExpenseItemAssignment.expense_guest_id)
          is not counted; only ``ExpenseSplit`` rows contribute.
        * Managed guests and managed members are folded into their managers via
          :func:`_fold_with_prefetched` (mirrors the scalar-mode semantics of
          :func:`utils.balances._fold_managed_relationships` but operates on
          pre-fetched row lists so the fold can be called per time-bucket
          without extra round-trips).
    """

    # ------------------------------------------------------------------
    # Load non-settlement expenses and their splits.
    # ------------------------------------------------------------------
    expenses: List[models.Expense] = (
        db.query(models.Expense)
        .filter(models.Expense.group_id == group_id)
        .filter(models.Expense.is_settlement != True)  # noqa: E712 — explicit SQL compare
        .all()
    )

    # Empty-group fast path.
    if not expenses:
        return ConsumptionSummary(
            group_total=0,
            currency=target_currency,
            granularity="month",
            has_synthesized_historical_rate=False,
            skipped_unparseable_dates=0,
            members=[],
            series=[],
        )

    # Parse dates up-front; drive granularity + bucketing from the same list.
    parsed: List[Tuple[models.Expense, datetime.date]] = []
    skipped_unparseable_dates = 0
    for expense in expenses:
        raw = normalize_date(expense.date) if expense.date else None
        if not raw:
            skipped_unparseable_dates += 1
            continue
        try:
            parsed_date = datetime.date.fromisoformat(raw)
        except (ValueError, TypeError):
            skipped_unparseable_dates += 1
            logger.debug(
                "calculate_consumption_summary: skipping expense %s with unparseable date %r",
                expense.id,
                expense.date,
            )
            continue
        parsed.append((expense, parsed_date))

    # All expenses had unparseable dates. Treat like an empty group.
    if not parsed:
        return ConsumptionSummary(
            group_total=0,
            currency=target_currency,
            granularity="month",
            has_synthesized_historical_rate=False,
            skipped_unparseable_dates=skipped_unparseable_dates,
            members=[],
            series=[],
        )

    # Batch-fetch splits to avoid N+1 queries.
    expense_ids = [e.id for e, _ in parsed]
    splits_by_expense: Dict[int, List[models.ExpenseSplit]] = {}
    for split in (
        db.query(models.ExpenseSplit)
        .filter(models.ExpenseSplit.expense_id.in_(expense_ids))
        .all()
    ):
        splits_by_expense.setdefault(split.expense_id, []).append(split)

    # ------------------------------------------------------------------
    # Determine granularity from the non-settlement span.
    # ------------------------------------------------------------------
    min_date = min(d for _, d in parsed)
    max_date = max(d for _, d in parsed)
    granularity = _select_granularity(min_date, max_date)

    # ------------------------------------------------------------------
    # Prefetch managed relationships once — the rows are static across the
    # call, so we avoid re-querying for every time-bucket period below.
    # (Named ``managed_members_managed`` to avoid clashing with the
    #  ``models.GroupMember`` fetch that lives upstream of this primitive.)
    # ------------------------------------------------------------------
    managed_guests: List[models.GuestMember] = (
        db.query(models.GuestMember)
        .filter(
            models.GuestMember.group_id == group_id,
            models.GuestMember.managed_by_id != None,  # noqa: E711
        )
        .all()
    )
    managed_members_managed: List[models.GroupMember] = (
        db.query(models.GroupMember)
        .filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.managed_by_id != None,  # noqa: E711
        )
        .all()
    )

    # ------------------------------------------------------------------
    # Single scan: accumulate consumption + per-period-per-member totals.
    # period_order preserves chronological ordering of filled buckets for
    # the empty-bucket fill below.
    #
    # ``pre_fold_totals`` mirrors ``consumption`` but is never folded. We
    # use it to reconstruct each manager's per-member breakdown in memory
    # (no extra query per managed member), so the breakdown shares the same
    # hybrid conversion path as the main scan.
    # ------------------------------------------------------------------
    consumption: Dict[Tuple[int, bool], int] = {}
    pre_fold_totals: Dict[Tuple[int, bool], int] = defaultdict(int)
    bucket_totals_per_member: Dict[str, Dict[Tuple[int, bool], int]] = {}
    bucket_starts: Dict[str, datetime.date] = {}
    has_synthesized_historical_rate = False

    for expense, parsed_date in parsed:
        # Leg 1: expense currency → USD (historical).
        if expense.exchange_rate is not None:
            try:
                rate = float(expense.exchange_rate)
                use_stored_rate = True
            except (TypeError, ValueError):
                rate = None
                use_stored_rate = False
        else:
            rate = None
            use_stored_rate = False

        if not use_stored_rate and expense.currency != "USD":
            # Synthesis fires: null/invalid historical rate for a non-USD expense.
            has_synthesized_historical_rate = True

        period_label, period_start = _period_key(parsed_date, granularity)
        bucket_starts.setdefault(period_label, period_start)

        for split in splits_by_expense.get(expense.id, []):
            if use_stored_rate:
                amount_usd = split.amount_owed * rate
            else:
                # Same-USD expenses fall through this branch without synthesis.
                amount_usd = convert_to_usd(split.amount_owed, expense.currency)

            amount_in_target = convert_currency(amount_usd, "USD", target_currency)

            # Truncate to int at the split level — matches existing Balances
            # behavior and keeps all downstream arithmetic in integer cents.
            amount_cents = int(amount_in_target)

            key = (split.user_id, bool(split.is_guest))
            consumption[key] = consumption.get(key, 0) + amount_cents
            pre_fold_totals[key] += amount_cents

            per_member = bucket_totals_per_member.setdefault(period_label, {})
            per_member[key] = per_member.get(key, 0) + amount_cents

    # ------------------------------------------------------------------
    # Detect managed_by cycles up-front so we apply the same cycle-skip
    # logic to every fold below (top-level + each time-bucket) without
    # re-walking the edge graph.
    # ------------------------------------------------------------------
    cyclic_keys = _detect_managed_cycles(managed_guests, managed_members_managed)
    if cyclic_keys:
        logger.warning(
            "Managed_by cycle detected for group_id=%s, keys involved=%s; "
            "skipping fold to prevent silent data loss.",
            group_id,
            sorted(cyclic_keys),
        )

    # ------------------------------------------------------------------
    # Fold managed relationships using the prefetched lists — no DB hits in
    # the per-period loop.
    # ------------------------------------------------------------------
    _fold_with_prefetched(
        consumption, managed_guests, managed_members_managed, cyclic_keys
    )
    for period_label in bucket_totals_per_member:
        _fold_with_prefetched(
            bucket_totals_per_member[period_label],
            managed_guests,
            managed_members_managed,
            cyclic_keys,
        )

    # ------------------------------------------------------------------
    # Build the managed-member breakdown from the in-memory ``pre_fold_totals``
    # dict — no per-managed-member DB queries. Skip entries with a zero
    # total so empty rows don't surface.
    # ------------------------------------------------------------------
    manager_breakdown: Dict[Tuple[int, bool], List[Tuple[Tuple[int, bool], int]]] = {}

    for guest in managed_guests:
        # Mirror the defensive skip in _fold_managed_relationships.
        if guest.claimed_by_id and guest.managed_by_id:
            continue

        managed_key = _managed_key_for_guest(guest)
        manager_key = (
            guest.managed_by_id,
            guest.managed_by_type == "guest",
        )

        # Cycle-aware: if this entry wasn't folded (cycle), don't emit a
        # breakdown row — the managed entry is already surfaced as its own
        # top-level member row.
        if managed_key in cyclic_keys or manager_key in cyclic_keys:
            continue

        total_for_guest = pre_fold_totals.get(managed_key, 0)
        if total_for_guest == 0:
            # Skip zero-total managed guests — they'd otherwise surface as
            # a breakdown row with no useful data.
            continue

        manager_breakdown.setdefault(manager_key, []).append(
            (managed_key, total_for_guest)
        )

    for managed_member in managed_members_managed:
        managed_key = (managed_member.user_id, False)
        manager_key = (
            managed_member.managed_by_id,
            managed_member.managed_by_type == "guest",
        )

        # Cycle-aware: same rationale as the guest loop above.
        if managed_key in cyclic_keys or manager_key in cyclic_keys:
            continue

        total_for_member = pre_fold_totals.get(managed_key, 0)
        if total_for_member == 0:
            # Match the zero-total skip behaviour above: registered members
            # with no consumption in this group don't deserve a breakdown row.
            continue
        manager_breakdown.setdefault(manager_key, []).append(
            (managed_key, total_for_member)
        )

    # ------------------------------------------------------------------
    # Batch-prefetch display-name tables. Collect every (user_id, is_guest)
    # key that will surface in the response — post-fold consumption rows and
    # every managed-member breakdown entry — then issue at most two IN-list
    # queries (``User`` + ``GuestMember``) instead of one SELECT per name.
    # ------------------------------------------------------------------
    all_user_ids: set = {uid for (uid, is_guest) in consumption.keys() if not is_guest}
    all_guest_ids: set = {uid for (uid, is_guest) in consumption.keys() if is_guest}
    for entries in manager_breakdown.values():
        for (uid, is_guest), _ in entries:
            if is_guest:
                all_guest_ids.add(uid)
            else:
                all_user_ids.add(uid)

    users_by_id: Dict[int, models.User] = {}
    guests_by_id: Dict[int, models.GuestMember] = {}
    if all_user_ids:
        users_by_id = {
            u.id: u
            for u in db.query(models.User)
            .filter(models.User.id.in_(all_user_ids))
            .all()
        }
    if all_guest_ids:
        guests_by_id = {
            g.id: g
            for g in db.query(models.GuestMember)
            .filter(models.GuestMember.id.in_(all_guest_ids))
            .all()
        }

    # Some claimed guests point at a User that's not already in
    # ``users_by_id`` (e.g. the manager is a guest, so the claimed user never
    # appears in ``consumption`` or breakdown keys). Fetch those too so
    # ``resolve_name`` never falls back to a per-row query.
    claimed_user_ids_to_fetch = {
        g.claimed_by_id
        for g in guests_by_id.values()
        if g.claimed_by_id is not None and g.claimed_by_id not in users_by_id
    }
    if claimed_user_ids_to_fetch:
        for u in (
            db.query(models.User)
            .filter(models.User.id.in_(claimed_user_ids_to_fetch))
            .all()
        ):
            users_by_id[u.id] = u

    def resolve_name(user_id: int, is_guest: bool) -> str:
        """Read from the prefetched dicts; fall back to the shared helper only
        if a key is unexpectedly missing (shouldn't happen in practice)."""
        if is_guest:
            guest = guests_by_id.get(user_id)
            if guest is None:
                return get_participant_display_name(user_id, True, db)
            if guest.claimed_by_id:
                claimed_user = users_by_id.get(guest.claimed_by_id)
                if claimed_user:
                    return claimed_user.full_name or claimed_user.email
                return guest.name
            return guest.name
        user = users_by_id.get(user_id)
        if user is None:
            return get_participant_display_name(user_id, False, db)
        return user.full_name or user.email

    # Now that names are resolvable, build the breakdown list shape the
    # dataclass expects.
    manager_breakdown_resolved: Dict[Tuple[int, bool], List[ManagedMemberBreakdown]] = {}
    for manager_key, entries in manager_breakdown.items():
        manager_breakdown_resolved[manager_key] = [
            {
                "display_name": resolve_name(managed_uid, managed_is_guest),
                "total": total,
            }
            for (managed_uid, managed_is_guest), total in entries
        ]

    # Assemble member rows.
    members: List[SummaryMember] = []
    for (user_id, is_guest), total in consumption.items():
        members.append(
            SummaryMember(
                user_id=user_id,
                is_guest=is_guest,
                display_name=resolve_name(user_id, is_guest),
                total=total,
                managed_members=manager_breakdown_resolved.get((user_id, is_guest), []),
            )
        )
    members.sort(key=lambda m: m.total, reverse=True)

    # ------------------------------------------------------------------
    # Build series[] with empty-period fill.
    # ------------------------------------------------------------------
    min_label, min_start = _period_key(min_date, granularity)
    max_label, max_start = _period_key(max_date, granularity)

    series: List[SummarySeriesPoint] = []
    cursor = min_start
    while cursor <= max_start:
        period_label, period_start = _period_key(cursor, granularity)
        per_member_dict = bucket_totals_per_member.get(period_label, {})
        per_member_rows = [
            SummarySeriesPointMember(
                user_id=uid, is_guest=is_guest, amount=amount,
            )
            for (uid, is_guest), amount in per_member_dict.items()
        ]
        # Deterministic ordering for repeatable tests and UI stability.
        per_member_rows.sort(key=lambda r: (r.user_id, r.is_guest))
        series.append(
            SummarySeriesPoint(
                period_label=period_label,
                period_start=period_start.isoformat(),
                total=sum(r.amount for r in per_member_rows),
                per_member=per_member_rows,
            )
        )
        cursor = _next_period_start(period_start, granularity)

    group_total = sum(m.total for m in members)

    return ConsumptionSummary(
        group_total=group_total,
        currency=target_currency,
        granularity=granularity,
        has_synthesized_historical_rate=has_synthesized_historical_rate,
        skipped_unparseable_dates=skipped_unparseable_dates,
        members=members,
        series=series,
    )


# Internal helpers ----------------------------------------------------------


def _fold_with_prefetched(
    totals: Dict[Tuple[int, bool], int],
    managed_guests: List[models.GuestMember],
    managed_members: List[models.GroupMember],
    cyclic_keys: "frozenset[Tuple[int, bool]] | set[Tuple[int, bool]] | None" = None,
) -> None:
    """
    In-place fold managed guests and managed members into their managers
    using pre-fetched rows — no DB session needed.

    Mirrors the behaviour of :func:`utils.balances._fold_managed_relationships`
    for the scalar case. The DB-coupled helper in ``utils.balances`` is kept
    as the source of truth for ``calculate_net_balances``; this copy exists so
    the consumption-summary primitive can call the fold N+1 times (once for
    the top-level dict + once per time-bucket) without re-querying the same
    static management rows.

    Args:
        totals: Mutable dict mapping ``(user_id, is_guest)`` to a scalar amount.
            Mutated in place — folded entries are deleted, manager entries are
            incremented (and created if missing).
        managed_guests: Pre-fetched ``GuestMember`` rows with ``managed_by_id``
            set, already scoped to the group.
        managed_members: Pre-fetched ``GroupMember`` rows with
            ``managed_by_id`` set, already scoped to the group.
        cyclic_keys: Optional pre-computed set of participant keys that are
            part of a managed_by cycle — these are excluded from the fold so
            their amounts stay visible under their own key instead of being
            dropped onto a deleted key. Pass ``None`` to skip the check
            (caller has already validated cycle-freeness or doesn't care).
    """
    if cyclic_keys is None:
        cyclic_keys = frozenset()

    for guest in managed_guests:
        # Defensive check: claimed guests should not have managed_by set.
        # This would cause double-counting since the user inherits the
        # management relationship.
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
