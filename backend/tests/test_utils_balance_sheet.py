"""Unit tests for the balance-sheet primitive.

These build rows directly in the session rather than through the API, because
several of the cases under test — a stored split that disagrees with its items,
a management cycle, a guest that is both claimed and managed — are states the
API deliberately refuses to create but which exist in older data. The export's
job is to render them legibly, not to fall over.
"""

import pytest

from auth import get_password_hash
from models import (
    Expense,
    ExpenseItem,
    ExpenseItemAssignment,
    ExpenseSplit,
    Group,
    GroupMember,
    GuestMember,
    User,
)
from utils.balance_sheet import build_balance_sheet


@pytest.fixture
def group(db_session):
    g = Group(name="Tahoe Trip", created_by_id=1, default_currency="USD")
    db_session.add(g)
    db_session.commit()
    db_session.refresh(g)
    return g


def _user(db_session, email, name):
    user = User(
        email=email,
        hashed_password=get_password_hash("password123"),
        full_name=name,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _member(db_session, group, user):
    db_session.add(GroupMember(group_id=group.id, user_id=user.id))
    db_session.commit()


def _guest(db_session, group, name, **kwargs):
    guest = GuestMember(
        group_id=group.id, name=name, created_by_id=1, **kwargs
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)
    return guest


def _expense(db_session, group, *, payer_id, payer_is_guest=False, amount=10000,
             split_type="EQUAL", currency="USD", rate=None, date="2026-07-04",
             description="Dinner"):
    expense = Expense(
        description=description,
        amount=amount,
        currency=currency,
        date=date,
        payer_id=payer_id,
        payer_is_guest=payer_is_guest,
        group_id=group.id,
        created_by_id=payer_id,
        split_type=split_type,
        exchange_rate=rate,
    )
    db_session.add(expense)
    db_session.commit()
    db_session.refresh(expense)
    return expense


def _split(db_session, expense, user_id, amount, is_guest=False):
    db_session.add(ExpenseSplit(
        expense_id=expense.id, user_id=user_id, is_guest=is_guest,
        amount_owed=amount,
    ))
    db_session.commit()


def _item(db_session, expense, description, price, assignees, is_tax_tip=False):
    """``assignees`` is a list of (id, is_guest) tuples."""
    item = ExpenseItem(
        expense_id=expense.id, description=description, price=price,
        is_tax_tip=is_tax_tip, split_type="EQUAL",
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    for person_id, is_guest in assignees:
        db_session.add(ExpenseItemAssignment(
            expense_item_id=item.id, user_id=person_id, is_guest=is_guest,
        ))
    db_session.commit()
    return item


def _recomputed_totals(db_session, expense):
    """What allocate_items produces for an expense as it stands right now."""
    from utils.splits import AllocationInput, allocate_items

    inputs = []
    items = db_session.query(ExpenseItem).filter(
        ExpenseItem.expense_id == expense.id
    ).order_by(ExpenseItem.id).all()
    for item in items:
        assignments = db_session.query(ExpenseItemAssignment).filter(
            ExpenseItemAssignment.expense_item_id == item.id
        ).order_by(ExpenseItemAssignment.id).all()
        inputs.append(AllocationInput(
            price=item.price,
            keys=[
                f"{'guest' if a.is_guest else 'user'}_{a.user_id}" for a in assignments
            ],
            item_id=item.id,
            is_tax_tip=bool(item.is_tax_tip),
            split_type=item.split_type or "EQUAL",
        ))

    totals = {}
    for allocation in allocate_items(inputs):
        prefix, _, raw_id = allocation.key.rpartition("_")
        key = (int(raw_id), prefix == "guest")
        totals[key] = totals.get(key, 0) + allocation.total_cents
    return totals


def _rows(sheet, row_type):
    return [r for r in sheet.ledger if r.row_type == row_type]


def _check(sheet, name):
    return next(c for c in sheet.checks if c.check == name)


class TestTheBasicLedger:
    def test_an_equal_split_reconciles_end_to_end(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(db_session, group, payer_id=alice.id, amount=10000)
        _split(db_session, expense, alice.id, 5000)
        _split(db_session, expense, bob.id, 5000)

        sheet = build_balance_sheet(db_session, group.id, "alice@example.com")

        assert len(_rows(sheet, "EXPENSE")) == 1
        assert len(_rows(sheet, "SPLIT")) == 2
        assert _rows(sheet, "RECONCILIATION") == []

        net = {r.display_name: r.net_cents for r in sheet.net}
        assert net == {"Alice": 5000, "Bob": -5000}

        assert len(sheet.simplified) == 1
        payment = sheet.simplified[0]
        assert (payment.from_name, payment.to_name, payment.amount_cents) == (
            "Bob", "Alice", 5000,
        )
        assert all(c.passed for c in sheet.checks)

    def test_consumed_and_paid_are_reported_separately(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(db_session, group, payer_id=alice.id, amount=10000)
        _split(db_session, expense, alice.id, 5000)
        _split(db_session, expense, bob.id, 5000)

        sheet = build_balance_sheet(db_session, group.id)
        alice_row = next(r for r in sheet.net if r.display_name == "Alice")
        assert alice_row.consumed_cents == 5000
        assert alice_row.paid_cents == 10000
        assert alice_row.net_cents == 5000

    def test_an_empty_group_still_renders(self, db_session, group):
        sheet = build_balance_sheet(db_session, group.id)
        assert sheet.ledger == []
        assert sheet.net == []
        assert all(c.passed for c in sheet.checks)


class TestItemizedAllocation:
    def test_item_shares_are_shown_under_their_parent_expense(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=6000, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Chicken", 3000, [(alice.id, False), (bob.id, False)])
        _item(db_session, expense, "Wine", 2000, [(bob.id, False)])
        _item(db_session, expense, "Tip", 1000, [], is_tax_tip=True)
        # Alice: 1500 + 1000*(1500/5000) = 1800; Bob: 1500+2000 + 700 = 4200
        _split(db_session, expense, alice.id, 1800)
        _split(db_session, expense, bob.id, 4200)

        sheet = build_balance_sheet(db_session, group.id)

        shares = _rows(sheet, "ITEM_SHARE")
        chicken = [s for s in shares if s.item_description == "Chicken"]
        assert {s.person_name for s in chicken} == {"Alice", "Bob"}
        assert all(s.amount_cents == 1500 for s in chicken)

        # Pooled tax/tip belongs to no single line, so it carries no item_id.
        tip = [s for s in shares if s.is_tax_tip]
        assert {s.item_id for s in tip} == {None}
        assert sum(s.amount_cents for s in tip) == 1000

        assert _rows(sheet, "RECONCILIATION") == []
        assert _check(sheet, "item_shares_match_splits").passed

    def test_rounding_is_named_in_the_note(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=501, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Coffee", 501, [(alice.id, False), (bob.id, False)])
        _split(db_session, expense, alice.id, 251)
        _split(db_session, expense, bob.id, 250)

        sheet = build_balance_sheet(db_session, group.id)
        shares = _rows(sheet, "ITEM_SHARE")
        odd_cent = [s for s in shares if s.amount_cents == 251]
        assert len(odd_cent) == 1
        assert "rounding" in odd_cent[0].note

    def test_a_split_that_disagrees_with_its_items_produces_one_reconciliation_row(
        self, db_session, group
    ):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=4000, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Chicken", 4000, [(alice.id, False), (bob.id, False)])
        # Stored splits deliberately disagree with the items, as legacy rows can.
        _split(db_session, expense, alice.id, 2500)
        _split(db_session, expense, bob.id, 1500)

        sheet = build_balance_sheet(db_session, group.id)

        reconciliations = _rows(sheet, "RECONCILIATION")
        assert len(reconciliations) == 2
        by_person = {r.person_name: r.amount_cents for r in reconciliations}
        assert by_person == {"Alice": 500, "Bob": -500}
        assert not _check(sheet, "item_shares_match_splits").passed

        # The stored split still wins: balances must match the app.
        assert _check(sheet, "matches_balances_endpoint").passed
        net = {r.display_name: r.net_cents for r in sheet.net}
        assert net["Bob"] == -1500


class TestRoundingReassignment:
    """A claim changes who absorbs the remainder cents, but not what is owed.

    ``allocate_items`` gives leftover cents to the last participant key in
    sorted order. Claiming a guest rewrites its rows onto an account, so
    ``guest_59`` becomes ``user_28`` and sorts somewhere else — a later
    recomputation lands the remainder on a different person than the write
    did. Reported as a notice, because reporting it as a failure would train
    people to ignore the CHECKS block.
    """

    def test_a_claim_moves_the_remainder_and_is_reported_as_a_notice(
        self, db_session, group
    ):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)
        guest = _guest(db_session, group, "Tina")
        claimer = _user(db_session, "tina@example.com", "Tina Sung")
        _member(db_session, group, claimer)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=10000, split_type="ITEMIZED",
        )
        # Post-claim state: absorb_guest_into_user rewrote the item assignments
        # onto the account, so nothing here still points at the guest.
        _item(
            db_session, expense, "Pizza", 9000,
            [(alice.id, False), (bob.id, False), (claimer.id, False)],
        )
        _item(db_session, expense, "Tip", 1000, [], is_tax_tip=True)
        guest.claimed_by_id = claimer.id
        db_session.commit()

        # The splits are the ones saved *before* the claim, when the third
        # participant keyed as guest_N and a different person therefore sorted
        # last. Reproduce that by moving the leftover cent off whoever the
        # recomputation now picks.
        recomputed = _recomputed_totals(db_session, expense)
        holder = max(recomputed, key=lambda k: (recomputed[k], k))
        other = min(recomputed, key=lambda k: (recomputed[k], k))
        for key, amount in recomputed.items():
            adjustment = -1 if key == holder else (1 if key == other else 0)
            _split(db_session, expense, key[0], amount + adjustment, is_guest=key[1])

        sheet = build_balance_sheet(db_session, group.id)

        reconciliations = _rows(sheet, "RECONCILIATION")
        assert reconciliations, "the difference must still be visible in the ledger"
        assert sum(r.amount_cents for r in reconciliations) == 0
        assert all("rounding only" in r.note for r in reconciliations)
        assert all("re-identified" in r.note for r in reconciliations)

        # Not a failure — the totals agree and no balance moves.
        assert _check(sheet, "item_shares_match_splits").passed
        notice = _check(sheet, "item_share_rounding_reassigned")
        assert notice.passed
        assert notice.severity == "notice"
        assert "unaffected" in notice.detail
        assert _check(sheet, "matches_balances_endpoint").passed
        assert _check(sheet, "splits_match_expense_totals").passed

    def test_a_difference_too_large_to_be_rounding_is_still_a_failure(
        self, db_session, group
    ):
        """Equal and opposite, but far beyond a remainder cent per line."""
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=4000, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Chicken", 4000, [(alice.id, False), (bob.id, False)])
        _split(db_session, expense, alice.id, 2500)
        _split(db_session, expense, bob.id, 1500)

        sheet = build_balance_sheet(db_session, group.id)
        assert not _check(sheet, "item_shares_match_splits").passed
        assert not any(
            c.check == "item_share_rounding_reassigned" for c in sheet.checks
        )

    def test_a_difference_that_does_not_net_to_zero_is_a_failure(
        self, db_session, group
    ):
        """One cent, but conjured from nowhere — money, not attribution."""
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=4001, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Chicken", 4000, [(alice.id, False), (bob.id, False)])
        _split(db_session, expense, alice.id, 2001)
        _split(db_session, expense, bob.id, 2000)

        sheet = build_balance_sheet(db_session, group.id)
        check = _check(sheet, "item_shares_match_splits")
        assert not check.passed
        assert "1 cent" in check.detail

    def test_no_notice_when_nothing_drifted(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        expense = _expense(
            db_session, group, payer_id=alice.id, amount=4000, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Chicken", 4000, [(alice.id, False)])
        _split(db_session, expense, alice.id, 4000)

        sheet = build_balance_sheet(db_session, group.id)
        assert not any(
            c.check == "item_share_rounding_reassigned" for c in sheet.checks
        )
        assert all(c.severity == "pass" for c in sheet.checks)


class TestChecks:
    def test_splits_not_summing_to_the_expense_total_is_reported(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        expense = _expense(db_session, group, payer_id=alice.id, amount=10000)
        _split(db_session, expense, alice.id, 9000)

        sheet = build_balance_sheet(db_session, group.id)
        check = _check(sheet, "splits_match_expense_totals")
        assert not check.passed
        assert "9000" in check.detail

    def test_the_sheet_is_pinned_against_the_balances_endpoint(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)
        first = _expense(db_session, group, payer_id=alice.id, amount=9000)
        _split(db_session, first, alice.id, 3000)
        _split(db_session, first, bob.id, 6000)
        second = _expense(db_session, group, payer_id=bob.id, amount=4000)
        _split(db_session, second, alice.id, 2000)
        _split(db_session, second, bob.id, 2000)

        sheet = build_balance_sheet(db_session, group.id)
        assert _check(sheet, "matches_balances_endpoint").passed
        assert _check(sheet, "net_balances_sum_to_zero").passed
        assert _check(sheet, "simplified_matches_net").passed


class TestCurrencyConversion:
    def test_a_foreign_expense_is_converted_at_its_stored_rate(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=10000,
            currency="EUR", rate="1.10",
        )
        _split(db_session, expense, alice.id, 5000)
        _split(db_session, expense, bob.id, 5000)

        sheet = build_balance_sheet(db_session, group.id)

        split_rows = _rows(sheet, "SPLIT")
        assert all(r.currency == "EUR" for r in split_rows)
        assert all(r.amount_cents == 5000 for r in split_rows)
        assert all(r.converted_cents == 5500 for r in split_rows)

        conversion = {r.currency: r for r in sheet.conversion}
        assert conversion["EUR"].historical_rates == "1.10"
        assert conversion["EUR"].synthesized_count == 0

        net = {r.display_name: r.net_cents for r in sheet.net}
        assert net["Bob"] == -5500

    def test_a_missing_rate_is_flagged_rather_than_hidden(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        expense = _expense(
            db_session, group, payer_id=alice.id, amount=10000,
            currency="EUR", rate=None,
        )
        _split(db_session, expense, alice.id, 10000)

        sheet = build_balance_sheet(db_session, group.id)
        assert "no stored historical rate" in sheet.rate_note
        assert sheet.conversion[0].synthesized_count == 1

    def test_a_usd_expense_without_a_rate_is_not_a_synthesis(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        expense = _expense(db_session, group, payer_id=alice.id, amount=10000, rate=None)
        _split(db_session, expense, alice.id, 10000)

        sheet = build_balance_sheet(db_session, group.id)
        assert sheet.rate_note == ""
