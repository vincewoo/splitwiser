"""
Unit tests for ``utils.summary.calculate_consumption_summary``.

These exercise the aggregation primitive directly — HTTP-endpoint tests for
the authenticated and public routes are covered in Unit 3 / Unit 4.
"""

from datetime import date, timedelta
from unittest.mock import patch

import pytest

import models
from auth import get_password_hash
from utils.currency import EXCHANGE_RATES
from utils.summary import (
    ConsumptionSummary,
    _period_key,
    _select_granularity,
    calculate_consumption_summary,
)


# --------------------------------------------------------------------------- #
# Helpers for building fixtures directly against the DB session.              #
#                                                                              #
# The HTTP test harness sets ``utils.currency.get_exchange_rate_for_expense``  #
# via the real helper (which fetches a live rate) — inserting rows straight   #
# into the session avoids that side-effect and lets each test pin the         #
# exchange_rate value it wants to exercise.                                   #
# --------------------------------------------------------------------------- #


def _mk_user(db_session, email: str, name: str) -> models.User:
    user = models.User(
        email=email,
        hashed_password=get_password_hash("pw"),
        full_name=name,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _mk_group(db_session, owner_id: int, default_currency: str = "USD") -> models.Group:
    group = models.Group(
        name="Summary Group",
        created_by_id=owner_id,
        default_currency=default_currency,
    )
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)
    return group


def _add_member(db_session, group_id: int, user_id: int) -> models.GroupMember:
    member = models.GroupMember(group_id=group_id, user_id=user_id)
    db_session.add(member)
    db_session.commit()
    db_session.refresh(member)
    return member


def _add_guest(db_session, group_id: int, name: str, creator_id: int, **kw) -> models.GuestMember:
    guest = models.GuestMember(
        group_id=group_id,
        name=name,
        created_by_id=creator_id,
        **kw,
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)
    return guest


def _mk_expense(
    db_session,
    *,
    group_id: int,
    amount: int,
    currency: str,
    expense_date: str,
    payer_id: int,
    splits,  # list of (user_id, amount_owed, is_guest)
    exchange_rate="1.0",
    is_settlement: bool = False,
) -> models.Expense:
    expense = models.Expense(
        description="Test Expense",
        amount=amount,
        currency=currency,
        date=expense_date,
        payer_id=payer_id,
        payer_is_guest=False,
        group_id=group_id,
        created_by_id=payer_id,
        exchange_rate=exchange_rate,
        split_type="EXACT",
        is_settlement=is_settlement,
    )
    db_session.add(expense)
    db_session.commit()
    db_session.refresh(expense)

    for user_id, amount_owed, is_guest in splits:
        db_session.add(
            models.ExpenseSplit(
                expense_id=expense.id,
                user_id=user_id,
                amount_owed=amount_owed,
                is_guest=is_guest,
            )
        )
    db_session.commit()
    return expense


# --------------------------------------------------------------------------- #
# Period-key / granularity unit tests                                         #
# --------------------------------------------------------------------------- #


def test_select_granularity_thresholds():
    # < 3 months → week
    assert _select_granularity(date(2026, 1, 1), date(2026, 1, 10)) == "week"
    assert _select_granularity(date(2026, 1, 1), date(2026, 3, 30)) == "week"
    # 3–18 months → month
    assert _select_granularity(date(2026, 1, 1), date(2026, 5, 1)) == "month"
    assert _select_granularity(date(2026, 1, 1), date(2027, 6, 1)) == "month"
    # ≥ 18 months → quarter
    assert _select_granularity(date(2024, 1, 1), date(2026, 1, 10)) == "quarter"


def test_period_key_formats():
    # ISO weeks — 2026-04-15 is a Wednesday in ISO week 16.
    label, start = _period_key(date(2026, 4, 15), "week")
    assert label == "2026-W16"
    assert start.weekday() == 0  # Monday

    label, start = _period_key(date(2026, 4, 15), "month")
    assert label == "2026-04"
    assert start == date(2026, 4, 1)

    label, start = _period_key(date(2026, 4, 15), "quarter")
    assert label == "2026-Q2"
    assert start == date(2026, 4, 1)


# --------------------------------------------------------------------------- #
# Happy-path scenarios                                                        #
# --------------------------------------------------------------------------- #


def test_happy_path_two_members_three_expenses_totals_reconcile(db_session):
    """2 members, 3 non-settlement expenses → per-member totals sum to group_total."""
    u1 = _mk_user(db_session, "h1@ex.com", "Alice")
    u2 = _mk_user(db_session, "h2@ex.com", "Bob")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)
    _add_member(db_session, group.id, u2.id)

    # Three USD expenses, evenly split.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=2000,
        currency="USD",
        expense_date="2026-01-15",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False), (u2.id, 1000, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=3000,
        currency="USD",
        expense_date="2026-02-01",
        payer_id=u2.id,
        splits=[(u1.id, 1500, False), (u2.id, 1500, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=600,
        currency="USD",
        expense_date="2026-02-20",
        payer_id=u1.id,
        splits=[(u1.id, 300, False), (u2.id, 300, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")

    assert isinstance(summary, ConsumptionSummary)
    assert summary.currency == "USD"
    assert summary.group_total == 5600
    assert sum(m.total for m in summary.members) == summary.group_total
    assert sum(s.total for s in summary.series) == summary.group_total

    # 2 members, both appear.
    amounts_by_uid = {m.user_id: m.total for m in summary.members}
    assert amounts_by_uid == {u1.id: 2800, u2.id: 2800}

    # Sorted desc by total (ties keep insertion order).
    assert summary.members == sorted(
        summary.members, key=lambda m: m.total, reverse=True
    )

    # No synthesis, no skipped dates.
    assert summary.has_synthesized_historical_rate is False
    assert summary.skipped_unparseable_dates == 0


def test_happy_path_within_three_months_granularity_week(db_session):
    u1 = _mk_user(db_session, "w1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2026-01-05",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=500,
        currency="USD",
        expense_date="2026-02-20",
        payer_id=u1.id,
        splits=[(u1.id, 500, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.granularity == "week"
    # Labels look like "YYYY-Www".
    assert all("-W" in s.period_label for s in summary.series)


def test_happy_path_spanning_four_months_granularity_month(db_session):
    u1 = _mk_user(db_session, "m1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2026-01-05",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2026-05-15",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.granularity == "month"
    # Five buckets: 2026-01, 2026-02, 2026-03, 2026-04, 2026-05.
    assert [s.period_label for s in summary.series] == [
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
    ]


def test_happy_path_spanning_two_years_granularity_quarter(db_session):
    u1 = _mk_user(db_session, "q1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2024-01-05",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2026-02-15",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.granularity == "quarter"
    # Labels look like "YYYY-Qn".
    assert all("-Q" in s.period_label for s in summary.series)


# --------------------------------------------------------------------------- #
# Settlement exclusion                                                        #
# --------------------------------------------------------------------------- #


def test_settlements_are_excluded(db_session):
    u1 = _mk_user(db_session, "s1@ex.com", "A")
    u2 = _mk_user(db_session, "s2@ex.com", "B")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)
    _add_member(db_session, group.id, u2.id)

    # Normal expense.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=2000,
        currency="USD",
        expense_date="2026-02-01",
        payer_id=u1.id,
        splits=[(u1.id, 1000, False), (u2.id, 1000, False)],
    )
    # Settlement (B pays back A) — must be fully ignored.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2026-02-10",
        payer_id=u2.id,
        splits=[(u1.id, 1000, False)],
        is_settlement=True,
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")

    assert summary.group_total == 2000
    # Settlement amount does not appear anywhere.
    for m in summary.members:
        assert m.total in {1000}
    assert sum(s.total for s in summary.series) == 2000


# --------------------------------------------------------------------------- #
# Managed-member folding                                                      #
# --------------------------------------------------------------------------- #


def test_managed_guest_consumption_folds_into_manager(db_session):
    """Guest's $60 consumption shows up on manager; guest key is absent."""
    u1 = _mk_user(db_session, "mg1@ex.com", "Manager")
    u2 = _mk_user(db_session, "mg2@ex.com", "Payer")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)
    _add_member(db_session, group.id, u2.id)

    guest = _add_guest(
        db_session,
        group.id,
        "Guest",
        creator_id=u1.id,
        managed_by_id=u1.id,
        managed_by_type="user",
    )

    # Payer u2 covers an $80 dinner; guest owes $60, manager owes $20.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=8000,
        currency="USD",
        expense_date="2026-02-01",
        payer_id=u2.id,
        splits=[
            (u1.id, 2000, False),
            (guest.id, 6000, True),
        ],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")

    # Only one member row — the manager — with folded total = 8000.
    manager_row = next(m for m in summary.members if m.user_id == u1.id)
    assert manager_row.total == 8000

    # The guest key must not appear.
    assert not any(m.is_guest and m.user_id == guest.id for m in summary.members)

    # Managed-member breakdown surfaces the guest.
    assert any(
        entry["display_name"] == "Guest" and entry["total"] == 6000
        for entry in manager_row.managed_members
    )

    # group_total reconciles.
    assert summary.group_total == 8000
    assert sum(s.total for s in summary.series) == 8000


# --------------------------------------------------------------------------- #
# Multi-currency                                                              #
# --------------------------------------------------------------------------- #


def test_multi_currency_uses_stored_exchange_rate_and_static_leg(db_session):
    """EUR + GBP expenses in a USD group convert via stored rate + static leg."""
    u1 = _mk_user(db_session, "mc1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    # 1 EUR = 1.10 USD on the expense date.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=10000,
        currency="EUR",
        expense_date="2026-02-01",
        payer_id=u1.id,
        splits=[(u1.id, 10000, False)],
        exchange_rate="1.10",
    )
    # 1 GBP = 1.25 USD on the expense date.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=8000,
        currency="GBP",
        expense_date="2026-02-05",
        payer_id=u1.id,
        splits=[(u1.id, 8000, False)],
        exchange_rate="1.25",
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")

    # Convert manually: EUR → USD via stored rate, then USD → USD identity.
    expected_eur_usd = int(10000 * 1.10)  # 11000
    expected_gbp_usd = int(8000 * 1.25)   # 10000
    expected_total = expected_eur_usd + expected_gbp_usd
    assert summary.group_total == expected_total
    # No synthesis — stored rates were non-null for both.
    assert summary.has_synthesized_historical_rate is False


def test_legacy_null_rate_non_usd_flips_flag(db_session):
    """exchange_rate = None on a non-USD expense triggers fallback + sets flag."""
    u1 = _mk_user(db_session, "lf1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=10000,
        currency="EUR",
        expense_date="2026-02-01",
        payer_id=u1.id,
        splits=[(u1.id, 10000, False)],
        exchange_rate=None,
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.has_synthesized_historical_rate is True
    # Fallback used the static EXCHANGE_RATES table.
    # convert_to_usd: amount / EXCHANGE_RATES[currency]
    expected = int(10000 / EXCHANGE_RATES["EUR"])
    assert summary.group_total == expected


def test_legacy_null_rate_same_currency_does_not_flip_flag(db_session):
    """exchange_rate = None on a USD expense in a USD group is a no-op — no synthesis."""
    u1 = _mk_user(db_session, "lnf1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=10000,
        currency="USD",
        expense_date="2026-02-01",
        payer_id=u1.id,
        splits=[(u1.id, 10000, False)],
        exchange_rate=None,
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.has_synthesized_historical_rate is False
    assert summary.group_total == 10000


# --------------------------------------------------------------------------- #
# Edge cases                                                                  #
# --------------------------------------------------------------------------- #


def test_empty_group_returns_zero_totals_and_default_granularity(db_session):
    u1 = _mk_user(db_session, "eg1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    summary = calculate_consumption_summary(db_session, group.id, "USD")

    assert summary.group_total == 0
    assert summary.members == []
    assert summary.series == []
    assert summary.granularity == "month"
    assert summary.has_synthesized_historical_rate is False
    assert summary.skipped_unparseable_dates == 0


def test_single_period_single_bucket(db_session):
    u1 = _mk_user(db_session, "sp1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=500,
        currency="USD",
        expense_date="2026-03-10",
        payer_id=u1.id,
        splits=[(u1.id, 500, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert len(summary.series) == 1
    assert summary.series[0].total == 500


def test_empty_periods_between_filled_ones_monthly(db_session):
    """Expenses in Jan + Mar (month granularity) → series includes a zero Feb bucket."""
    u1 = _mk_user(db_session, "ep1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=500,
        currency="USD",
        expense_date="2026-01-10",
        payer_id=u1.id,
        splits=[(u1.id, 500, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=800,
        currency="USD",
        expense_date="2026-05-10",
        payer_id=u1.id,
        splits=[(u1.id, 800, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.granularity == "month"
    labels = [s.period_label for s in summary.series]
    # Expect every month between 2026-01 and 2026-05, zero buckets for dead months.
    assert labels == ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]
    totals_by_label = {s.period_label: s.total for s in summary.series}
    assert totals_by_label == {
        "2026-01": 500,
        "2026-02": 0,
        "2026-03": 0,
        "2026-04": 0,
        "2026-05": 800,
    }


def test_payer_not_in_splits_consumption_reconciles(db_session):
    """Payer has no ExpenseSplit; splits sum to full expense amount."""
    u1 = _mk_user(db_session, "pn1@ex.com", "Payer")
    u2 = _mk_user(db_session, "pn2@ex.com", "B")
    u3 = _mk_user(db_session, "pn3@ex.com", "C")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)
    _add_member(db_session, group.id, u2.id)
    _add_member(db_session, group.id, u3.id)

    # Payer u1 buys $30 gift for u2+u3, isn't in the splits.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=3000,
        currency="USD",
        expense_date="2026-02-10",
        payer_id=u1.id,
        splits=[(u2.id, 1500, False), (u3.id, 1500, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    # Σ splits.amount_owed (authoritative) — u1 consumes nothing.
    assert summary.group_total == 3000
    amounts_by_uid = {m.user_id: m.total for m in summary.members}
    assert u1.id not in amounts_by_uid
    assert amounts_by_uid[u2.id] == 1500
    assert amounts_by_uid[u3.id] == 1500


def test_expense_guest_consumption_not_counted(db_session):
    """ExpenseGuest rows don't contribute to group_total or members[] — v1 non-goal."""
    u1 = _mk_user(db_session, "xg1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    expense = _mk_expense(
        db_session,
        group_id=group.id,
        amount=10000,
        currency="USD",
        expense_date="2026-02-10",
        payer_id=u1.id,
        splits=[(u1.id, 5000, False)],
    )

    # Orphan ExpenseGuest row with a 5000 cent obligation — aggregation must ignore it.
    db_session.add(
        models.ExpenseGuest(
            expense_id=expense.id,
            name="Ad-hoc Guest",
            amount_owed=5000,
            created_by_id=u1.id,
        )
    )
    db_session.commit()

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.group_total == 5000
    assert [m.user_id for m in summary.members] == [u1.id]
    assert summary.members[0].total == 5000


def test_malformed_date_is_skipped_and_counter_surfaces(db_session):
    """Unparseable date → expense skipped, counter incremented, totals reconcile."""
    u1 = _mk_user(db_session, "md1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    # One good expense + one with a garbage date.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=2000,
        currency="USD",
        expense_date="2026-02-10",
        payer_id=u1.id,
        splits=[(u1.id, 2000, False)],
    )
    bad = _mk_expense(
        db_session,
        group_id=group.id,
        amount=5000,
        currency="USD",
        expense_date="not-a-date",
        payer_id=u1.id,
        splits=[(u1.id, 5000, False)],
    )
    # Sanity: bad expense is in the DB.
    assert db_session.query(models.Expense).filter(models.Expense.id == bad.id).first() is not None

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.skipped_unparseable_dates == 1
    # Only the good expense contributes.
    assert summary.group_total == 2000
    assert sum(m.total for m in summary.members) == 2000


def test_all_dates_malformed_falls_back_to_empty_summary(db_session):
    """If every expense has an unparseable date we behave like an empty group."""
    u1 = _mk_user(db_session, "amd1@ex.com", "A")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=2000,
        currency="USD",
        expense_date="",
        payer_id=u1.id,
        splits=[(u1.id, 2000, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")
    assert summary.skipped_unparseable_dates == 1
    assert summary.group_total == 0
    assert summary.members == []
    assert summary.series == []
    assert summary.granularity == "month"


def test_per_member_per_period_reconciles_with_member_totals(db_session):
    """Σ series[].per_member[].amount == members[].total, per member."""
    u1 = _mk_user(db_session, "r1@ex.com", "A")
    u2 = _mk_user(db_session, "r2@ex.com", "B")
    group = _mk_group(db_session, u1.id)
    _add_member(db_session, group.id, u1.id)
    _add_member(db_session, group.id, u2.id)

    _mk_expense(
        db_session,
        group_id=group.id,
        amount=1000,
        currency="USD",
        expense_date="2026-01-10",
        payer_id=u1.id,
        splits=[(u1.id, 500, False), (u2.id, 500, False)],
    )
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=400,
        currency="USD",
        expense_date="2026-02-20",
        payer_id=u2.id,
        splits=[(u1.id, 200, False), (u2.id, 200, False)],
    )

    summary = calculate_consumption_summary(db_session, group.id, "USD")

    by_member: dict = {}
    for s in summary.series:
        for p in s.per_member:
            by_member[(p.user_id, p.is_guest)] = by_member.get(
                (p.user_id, p.is_guest), 0
            ) + p.amount

    for m in summary.members:
        assert by_member[(m.user_id, m.is_guest)] == m.total


# --------------------------------------------------------------------------- #
# Query-count regression                                                      #
# --------------------------------------------------------------------------- #


def test_calculate_consumption_summary_query_count_is_bounded(db_session):
    """
    Pins the N+1 fixes in ``utils.summary``. Previously the primitive issued:

      * 2 queries per time-bucket for managed-relationship folding
        (``_fold_managed_relationships``), and
      * 1 join-query per managed member/guest for the breakdown totals
        (``_guest_totals_from_splits``), and
      * 1 SELECT per rendered member for display-name resolution
        (``get_participant_display_name``).

    With the fixes, all three collapse to at most a fixed number of queries
    regardless of how many periods or members exist.

    The scenario below creates a group spanning ~2 years (quarterly
    granularity, ~9 buckets) with enough managed members and guests to have
    been painful under the old code path. The threshold is chosen to catch
    regressions (any N-per-period pattern would blow past it) while being
    loose enough not to wobble on minor internal refactors.
    """
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    # Small but non-trivial fixture: multiple managed rows + multi-period span
    # so pre-fix behaviour would issue dozens of extra queries.
    manager = _mk_user(db_session, "qc-mgr@ex.com", "Manager")
    payer = _mk_user(db_session, "qc-pay@ex.com", "Payer")
    other = _mk_user(db_session, "qc-oth@ex.com", "Other")
    group = _mk_group(db_session, manager.id)
    _add_member(db_session, group.id, manager.id)
    _add_member(db_session, group.id, payer.id)
    _add_member(db_session, group.id, other.id)

    # Managed guest #1 (unclaimed) managed by ``manager``.
    guest_a = _add_guest(
        db_session,
        group.id,
        "Guest A",
        creator_id=manager.id,
        managed_by_id=manager.id,
        managed_by_type="user",
    )
    # Managed guest #2 (unclaimed).
    guest_b = _add_guest(
        db_session,
        group.id,
        "Guest B",
        creator_id=manager.id,
        managed_by_id=manager.id,
        managed_by_type="user",
    )
    # ``other`` is a managed registered user, also managed by ``manager``.
    managed_member = db_session.query(models.GroupMember).filter_by(
        group_id=group.id, user_id=other.id
    ).first()
    managed_member.managed_by_id = manager.id
    managed_member.managed_by_type = "user"
    db_session.commit()

    # Scatter expenses across ~2 years to force quarterly granularity
    # (≥18-month span) and therefore ≥8 period buckets — the old per-period
    # fold would have issued 2 queries per bucket on top of everything else.
    dates_and_amounts = [
        ("2024-01-15", 1200),
        ("2024-04-03", 800),
        ("2024-07-22", 1500),
        ("2024-10-09", 700),
        ("2025-01-18", 2000),
        ("2025-05-05", 1100),
        ("2025-08-28", 900),
        ("2025-12-01", 1300),
        ("2026-02-15", 1700),
    ]
    for expense_date, amount in dates_and_amounts:
        _mk_expense(
            db_session,
            group_id=group.id,
            amount=amount,
            currency="USD",
            expense_date=expense_date,
            payer_id=payer.id,
            splits=[
                (manager.id, amount // 5, False),
                (payer.id, amount // 5, False),
                (other.id, amount // 5, False),
                (guest_a.id, amount // 5, True),
                (guest_b.id, amount // 5, True),
            ],
        )

    # Bind the query counter only around the primitive call itself.
    query_count = 0

    def _count_query(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1

    event.listen(Engine, "before_cursor_execute", _count_query)
    try:
        summary = calculate_consumption_summary(db_session, group.id, "USD")
    finally:
        event.remove(Engine, "before_cursor_execute", _count_query)

    # Sanity: the fixture produced a quarter-granularity series with multiple
    # buckets so any per-bucket N+1 would blow past the threshold below.
    assert summary.granularity == "quarter"
    assert len(summary.series) >= 8

    # Threshold rationale:
    #   * 1 expenses query
    #   * 1 splits (IN list) query
    #   * 1 managed-guests query
    #   * 1 managed-members query
    #   * 1 users IN-list query for display-name resolution
    #   * 1 guests IN-list query for display-name resolution
    #   * possibly 1 extra users-by-id fetch if any guest is claimed (none here)
    # → 6-ish queries in practice. We use 15 as a ceiling that leaves headroom
    # for minor refactors but would still catch any N-per-period regression.
    assert query_count < 15, (
        f"Expected bounded query count (< 15), got {query_count}. "
        "This suggests an N+1 regression in calculate_consumption_summary — "
        "the fold / breakdown / display-name paths must not re-query per "
        "bucket or per member."
    )


# --------------------------------------------------------------------------- #
# Managed_by cycle detection                                                  #
# --------------------------------------------------------------------------- #


def test_circular_managed_by_guest_and_member_breaks_cycle_defensively(
    db_session, caplog
):
    """
    Guest A managed_by user U, user U managed_by guest A. Without cycle
    detection, folding would delete guest A's key, then fold U's (now
    inflated) total onto guest A's deleted key — amounts silently lost.

    With cycle detection, both entries stay unfolded (visible as individual
    rows) AND a WARNING is logged. ``group_total`` still reconciles with
    ``Σ members[].total``.
    """
    import logging as _logging

    u = _mk_user(db_session, "cycle-u@ex.com", "U")
    payer = _mk_user(db_session, "cycle-p@ex.com", "Payer")
    group = _mk_group(db_session, u.id)
    _add_member(db_session, group.id, u.id)
    _add_member(db_session, group.id, payer.id)

    # Create the guest first (managed by user U).
    guest = _add_guest(
        db_session,
        group.id,
        "Cycle Guest",
        creator_id=u.id,
        managed_by_id=u.id,
        managed_by_type="user",
    )

    # Flip user U's GroupMember to be managed by guest — closes the cycle.
    u_member = (
        db_session.query(models.GroupMember)
        .filter(models.GroupMember.group_id == group.id, models.GroupMember.user_id == u.id)
        .first()
    )
    u_member.managed_by_id = guest.id
    u_member.managed_by_type = "guest"
    db_session.commit()

    # Payer funds a $30 dinner; split evenly across payer / U / guest.
    _mk_expense(
        db_session,
        group_id=group.id,
        amount=3000,
        currency="USD",
        expense_date="2026-02-01",
        payer_id=payer.id,
        splits=[
            (payer.id, 1000, False),
            (u.id, 1000, False),
            (guest.id, 1000, True),
        ],
    )

    with caplog.at_level(_logging.WARNING):
        summary = calculate_consumption_summary(db_session, group.id, "USD")

    # Reconciles even though the fold was skipped for the cyclic pair.
    assert summary.group_total == sum(m.total for m in summary.members)
    assert summary.group_total == 3000

    # Cyclic entries remain as their own rows (not folded into a zombie key).
    keys = {(m.user_id, m.is_guest) for m in summary.members}
    assert (u.id, False) in keys
    assert (guest.id, True) in keys
    assert (payer.id, False) in keys

    # A warning was logged identifying the cycle.
    assert any(
        "Managed_by cycle detected" in record.getMessage()
        and str(group.id) in record.getMessage()
        for record in caplog.records
    )
