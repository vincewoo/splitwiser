"""Guest handling in the balance sheet.

"Guest" means four different things in this codebase and they do not behave
alike, so these are the cases most likely to misattribute money:

* a user and a group guest that share a numeric id on the same expense;
* two guests in one group with the same name (nothing prevents it);
* a guest who paid, and so is owed money;
* a claimed guest, whose history was rewritten onto an account;
* a guest that is both claimed and managed, which the fold refuses to touch;
* a management cycle, which the fold also refuses to touch.

The last three are states the API will not create today but which exist in
older data — the sheet has to stay legible and stay in agreement with
``/groups/{id}/balances``.
"""

import pytest

from models import Group, GroupMember, GuestMember
from tests.test_utils_balance_sheet import (  # reuse the row builders
    _expense,
    _guest,
    _item,
    _member,
    _split,
    _user,
)
from utils.balance_sheet import build_balance_sheet
from utils.balances import calculate_net_balances


@pytest.fixture
def group(db_session):
    g = Group(name="Tahoe Trip", created_by_id=1, default_currency="USD")
    db_session.add(g)
    db_session.commit()
    db_session.refresh(g)
    return g


def _check(sheet, name):
    return next(c for c in sheet.checks if c.check == name)


def _people(sheet):
    return {(p.key[0], p.person_type): p for p in sheet.people}


class TestGuestsAreFullParticipants:
    def test_a_guest_who_paid_is_owed_money(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        dave = _guest(db_session, group, "Dave")

        expense = _expense(
            db_session, group, payer_id=dave.id, payer_is_guest=True, amount=8000,
        )
        _split(db_session, expense, alice.id, 4000)
        _split(db_session, expense, dave.id, 4000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        net = {(r.display_name, r.person_type): r.net_cents for r in sheet.net}
        assert net[("Dave", "group_guest")] == 4000
        assert net[("Alice", "user")] == -4000

        # And the guest is on the receiving end of the settlement.
        assert len(sheet.simplified) == 1
        assert sheet.simplified[0].to_name == "Dave"
        assert sheet.simplified[0].to_type == "group_guest"
        assert all(c.passed for c in sheet.checks)

    def test_a_user_and_a_guest_sharing_a_numeric_id_stay_distinct(
        self, db_session, group
    ):
        """The id spaces overlap, so a name-only export would merge these two."""
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)

        # Force a guest whose id equals the user's id.
        guest = GuestMember(
            id=alice.id, group_id=group.id, name="Dave", created_by_id=alice.id,
        )
        db_session.add(guest)
        db_session.commit()
        assert guest.id == alice.id

        expense = _expense(db_session, group, payer_id=alice.id, amount=6000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, guest.id, 3000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        split_rows = [r for r in sheet.ledger if r.row_type == "SPLIT"]
        assert {(r.person_name, r.person_type) for r in split_rows} == {
            ("Alice", "user"), ("Dave", "group_guest"),
        }
        # Same person_id, different person_type — the pair is what disambiguates.
        assert {r.person_id for r in split_rows} == {alice.id}

        net = {(r.display_name, r.person_type): r.net_cents for r in sheet.net}
        assert net[("Alice", "user")] == 3000
        assert net[("Dave", "group_guest")] == -3000

    def test_two_guests_with_the_same_name_are_kept_apart(self, db_session, group):
        """add_guest does not check for name collisions, so this is real data."""
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        first = _guest(db_session, group, "Dave")
        second = _guest(db_session, group, "Dave")

        expense = _expense(db_session, group, payer_id=alice.id, amount=9000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, first.id, 4000, is_guest=True)
        _split(db_session, expense, second.id, 2000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        guest_rows = [r for r in sheet.net if r.person_type == "group_guest"]
        assert len(guest_rows) == 2
        assert {r.display_name for r in guest_rows} == {"Dave"}
        assert {r.key[0] for r in guest_rows} == {first.id, second.id}
        assert {r.net_cents for r in guest_rows} == {-4000, -2000}
        assert all(c.passed for c in sheet.checks)

    def test_a_guest_takes_item_shares_like_anyone_else(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        dave = _guest(db_session, group, "Dave")

        expense = _expense(
            db_session, group, payer_id=alice.id, amount=5000, split_type="ITEMIZED",
        )
        _item(db_session, expense, "Pizza", 4000, [(alice.id, False), (dave.id, True)])
        _item(db_session, expense, "Tip", 1000, [], is_tax_tip=True)
        _split(db_session, expense, alice.id, 2500)
        _split(db_session, expense, dave.id, 2500, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)
        shares = [r for r in sheet.ledger if r.row_type == "ITEM_SHARE"]
        dave_shares = [s for s in shares if s.person_type == "group_guest"]
        assert sum(s.amount_cents for s in dave_shares) == 2500
        assert [r for r in sheet.ledger if r.row_type == "RECONCILIATION"] == []


class TestClaimedGuests:
    def test_a_claimed_guest_is_declared_in_the_identity_section(
        self, db_session, group
    ):
        """Claiming rewrites the rows, so the ledger shows the account's name.

        The IDENTITY section is what explains why an expense the user
        remembers splitting with "Dave the guest" now reads as their own.
        """
        alice = _user(db_session, "alice@example.com", "Alice")
        dave_user = _user(db_session, "dave@example.com", "Dave Chen")
        _member(db_session, group, alice)
        _member(db_session, group, dave_user)
        _guest(db_session, group, "Dave", claimed_by_id=dave_user.id)

        # absorb_guest_into_user has already moved the rows onto the account.
        expense = _expense(db_session, group, payer_id=alice.id, amount=6000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, dave_user.id, 3000)

        sheet = build_balance_sheet(db_session, group.id)

        assert len(sheet.identity) == 1
        row = sheet.identity[0]
        assert (row.guest_name, row.claimed_by_name) == ("Dave", "Dave Chen")
        assert row.rows_still_under_guest == 0
        assert "merged onto the account" in row.note

        net = {r.display_name: r.net_cents for r in sheet.net}
        assert net["Dave Chen"] == -3000
        assert all(c.passed for c in sheet.checks)

    def test_legacy_rows_left_under_a_claimed_guest_are_shown_as_the_guest(
        self, db_session, group
    ):
        """Older claims did not move the rows. The ledger must not rename them."""
        alice = _user(db_session, "alice@example.com", "Alice")
        dave_user = _user(db_session, "dave@example.com", "Dave Chen")
        _member(db_session, group, alice)
        _member(db_session, group, dave_user)
        guest = _guest(db_session, group, "Dave", claimed_by_id=dave_user.id)

        expense = _expense(db_session, group, payer_id=alice.id, amount=6000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, guest.id, 3000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        split_rows = [r for r in sheet.ledger if r.row_type == "SPLIT"]
        guest_row = next(r for r in split_rows if r.person_type == "group_guest")
        # What the row recorded, not who owns it now.
        assert guest_row.person_name == "Dave"

        assert sheet.identity[0].rows_still_under_guest == 1
        assert "still record the guest" in sheet.identity[0].note

        # Whatever the sheet says about names, the totals match the app.
        assert _check(sheet, "matches_balances_endpoint").passed


class TestManagedGuests:
    def test_a_managed_guest_is_folded_and_the_fold_is_shown(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)
        kid = _guest(
            db_session, group, "Kid", managed_by_id=bob.id, managed_by_type="user",
        )

        expense = _expense(db_session, group, payer_id=alice.id, amount=9000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, bob.id, 3000)
        _split(db_session, expense, kid.id, 3000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        assert len(sheet.management) == 1
        fold = sheet.management[0]
        assert (fold.source_name, fold.manager_name) == ("Kid", "Bob")
        assert fold.amount_cents == -3000
        assert fold.folded is True

        net = {r.display_name: r.net_cents for r in sheet.net}
        assert "Kid" not in net
        assert net["Bob"] == -6000
        assert _check(sheet, "matches_balances_endpoint").passed

    def test_a_guest_that_is_both_claimed_and_managed_is_not_folded(
        self, db_session, group
    ):
        """A data-integrity violation the fold deliberately skips.

        The sheet must skip it the same way, or it would report a different
        total than the Balances screen for the same group.
        """
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)
        guest = _guest(
            db_session, group, "Dave",
            claimed_by_id=bob.id, managed_by_id=bob.id, managed_by_type="user",
        )

        expense = _expense(db_session, group, payer_id=alice.id, amount=6000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, guest.id, 3000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        check = _check(sheet, "no_claimed_and_managed_guests")
        assert not check.passed
        assert "Dave" in check.detail

        fold = next(m for m in sheet.management if m.source_name == "Dave")
        assert fold.folded is False
        assert "claimed and managed" in fold.note

        # The one thing that must hold regardless: agreement with the app.
        assert _check(sheet, "matches_balances_endpoint").passed
        endpoint = calculate_net_balances(db_session, group.id, "USD")
        sheet_net = {r.key: r.net_cents for r in sheet.net}
        for key, amount in endpoint.items():
            assert abs(sheet_net[key] - amount) < 1

    def test_a_management_cycle_is_reported_and_left_standalone(
        self, db_session, group
    ):
        alice = _user(db_session, "alice@example.com", "Alice")
        bob = _user(db_session, "bob@example.com", "Bob")
        _member(db_session, group, alice)
        _member(db_session, group, bob)
        member = db_session.query(GroupMember).filter(
            GroupMember.user_id == bob.id
        ).first()
        guest = _guest(db_session, group, "Loop")

        # bob -> guest -> bob
        member.managed_by_id = guest.id
        member.managed_by_type = "guest"
        guest.managed_by_id = bob.id
        guest.managed_by_type = "user"
        db_session.commit()

        expense = _expense(db_session, group, payer_id=alice.id, amount=6000)
        _split(db_session, expense, alice.id, 3000)
        _split(db_session, expense, bob.id, 2000)
        _split(db_session, expense, guest.id, 1000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)

        assert not _check(sheet, "no_managed_cycles").passed
        assert all(not m.folded for m in sheet.management)
        assert all("cycle" in m.note for m in sheet.management)

        # Both stay visible as their own rows rather than vanishing into a fold.
        net = {r.display_name: r.net_cents for r in sheet.net}
        assert net["Bob"] == -2000
        assert net["Loop"] == -1000
        assert _check(sheet, "matches_balances_endpoint").passed

        cycle_people = [p for p in sheet.people if p.status == "cycle_skipped"]
        assert {p.display_name for p in cycle_people} == {"Bob", "Loop"}


class TestRoster:
    def test_every_participant_appears_once_with_their_type(self, db_session, group):
        alice = _user(db_session, "alice@example.com", "Alice")
        _member(db_session, group, alice)
        dave = _guest(db_session, group, "Dave")

        expense = _expense(db_session, group, payer_id=alice.id, amount=4000)
        _split(db_session, expense, alice.id, 2000)
        _split(db_session, expense, dave.id, 2000, is_guest=True)

        sheet = build_balance_sheet(db_session, group.id)
        people = _people(sheet)
        assert (alice.id, "user") in people
        assert (dave.id, "group_guest") in people
        assert len(sheet.people) == 2
