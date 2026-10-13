"""Unit tests for utils.validation — participant authorization and split-detail checks.

These exercise the validation helpers directly against the in-memory database
rather than through the HTTP layer, so each authorization branch can be
asserted on its own.
"""

import pytest
from fastapi import HTTPException

import models
import schemas
from auth import get_password_hash
from utils.validation import (
    get_group_or_404,
    get_user_by_email,
    is_friend,
    is_group_member,
    validate_expense_participants,
    validate_item_split_details,
    verify_group_membership,
    verify_group_ownership,
)

# --- fixtures --------------------------------------------------------------

def make_user(db, email, name="User"):
    user = models.User(
        email=email,
        hashed_password=get_password_hash("password123"),
        full_name=name,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_group(db, owner, name="Group"):
    group = models.Group(name=name, created_by_id=owner.id, default_currency="USD")
    db.add(group)
    db.commit()
    db.refresh(group)
    db.add(models.GroupMember(group_id=group.id, user_id=owner.id))
    db.commit()
    return group


def add_member(db, group, user):
    member = models.GroupMember(group_id=group.id, user_id=user.id)
    db.add(member)
    db.commit()
    return member


def make_guest(db, group, creator, name="Guest"):
    guest = models.GuestMember(group_id=group.id, name=name, created_by_id=creator.id)
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


def make_friendship(db, user_a, user_b):
    friendship = models.Friendship(user_id1=user_a.id, user_id2=user_b.id)
    db.add(friendship)
    db.commit()
    return friendship


@pytest.fixture
def owner(db_session):
    return make_user(db_session, "owner@example.com", "Owner")


@pytest.fixture
def group(db_session, owner):
    return make_group(db_session, owner)


# --- lookup helpers --------------------------------------------------------

class TestLookupHelpers:
    def test_get_user_by_email_found(self, db_session, owner):
        assert get_user_by_email(db_session, "owner@example.com").id == owner.id

    def test_get_user_by_email_missing_returns_none(self, db_session):
        assert get_user_by_email(db_session, "nobody@example.com") is None

    def test_get_user_by_email_is_case_sensitive(self, db_session, owner):
        assert get_user_by_email(db_session, "OWNER@example.com") is None

    def test_get_group_or_404_found(self, db_session, group):
        assert get_group_or_404(db_session, group.id).id == group.id

    def test_get_group_or_404_raises(self, db_session):
        with pytest.raises(HTTPException) as exc:
            get_group_or_404(db_session, 99999)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Group not found"


# --- membership / ownership ------------------------------------------------

class TestMembershipChecks:
    def test_verify_group_membership_passes_for_member(self, db_session, group, owner):
        assert verify_group_membership(db_session, group.id, owner.id) is not None

    def test_verify_group_membership_raises_403_for_outsider(self, db_session, group):
        outsider = make_user(db_session, "outsider@example.com")
        with pytest.raises(HTTPException) as exc:
            verify_group_membership(db_session, group.id, outsider.id)
        assert exc.value.status_code == 403

    def test_verify_group_ownership_passes_for_owner(self, db_session, group, owner):
        assert verify_group_ownership(db_session, group.id, owner.id).id == group.id

    def test_verify_group_ownership_raises_403_for_plain_member(self, db_session, group):
        member = make_user(db_session, "member@example.com")
        add_member(db_session, group, member)
        with pytest.raises(HTTPException) as exc:
            verify_group_ownership(db_session, group.id, member.id)
        assert exc.value.status_code == 403

    def test_verify_group_ownership_raises_404_for_missing_group(self, db_session, owner):
        with pytest.raises(HTTPException) as exc:
            verify_group_ownership(db_session, 99999, owner.id)
        assert exc.value.status_code == 404

    def test_is_group_member(self, db_session, group, owner):
        outsider = make_user(db_session, "out@example.com")
        assert is_group_member(db_session, group.id, owner.id) is True
        assert is_group_member(db_session, group.id, outsider.id) is False


class TestFriendship:
    def test_is_friend_symmetric(self, db_session, owner):
        friend = make_user(db_session, "friend@example.com")
        make_friendship(db_session, owner, friend)
        assert is_friend(db_session, owner.id, friend.id) is True
        assert is_friend(db_session, friend.id, owner.id) is True

    def test_is_friend_false_for_strangers(self, db_session, owner):
        stranger = make_user(db_session, "stranger@example.com")
        assert is_friend(db_session, owner.id, stranger.id) is False


# --- validate_expense_participants: payer ----------------------------------

class TestValidatePayer:
    def test_group_member_payer_is_accepted(self, db_session, group, owner):
        validate_expense_participants(
            db_session, payer_id=owner.id, payer_is_guest=False, splits=[], group_id=group.id
        )

    def test_missing_user_payer_rejected(self, db_session, group):
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session, payer_id=99999, payer_is_guest=False, splits=[], group_id=group.id
            )
        assert exc.value.status_code == 400
        assert "payer with ID 99999 not found" in exc.value.detail

    def test_non_member_payer_rejected(self, db_session, group):
        outsider = make_user(db_session, "outsider@example.com")
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session, payer_id=outsider.id, payer_is_guest=False, splits=[], group_id=group.id
            )
        assert exc.value.status_code == 400
        assert "not a member of the group" in exc.value.detail

    def test_missing_guest_payer_rejected(self, db_session, group):
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session, payer_id=99999, payer_is_guest=True, splits=[], group_id=group.id
            )
        assert exc.value.status_code == 400
        assert "Guest payer" in exc.value.detail

    def test_guest_payer_from_another_group_rejected(self, db_session, group, owner):
        other_group = make_group(db_session, owner, name="Other")
        foreign_guest = make_guest(db_session, other_group, owner)
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=foreign_guest.id,
                payer_is_guest=True,
                splits=[],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "does not belong to group" in exc.value.detail

    def test_non_group_expense_requires_friendship(self, db_session, owner):
        stranger = make_user(db_session, "stranger@example.com")
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=stranger.id,
                payer_is_guest=False,
                splits=[],
                group_id=None,
                current_user_id=owner.id,
            )
        assert exc.value.status_code == 400
        assert "is not a friend" in exc.value.detail

    def test_non_group_expense_accepts_a_friend(self, db_session, owner):
        friend = make_user(db_session, "friend@example.com")
        make_friendship(db_session, owner, friend)
        validate_expense_participants(
            db_session,
            payer_id=friend.id,
            payer_is_guest=False,
            splits=[],
            group_id=None,
            current_user_id=owner.id,
        )

    def test_non_group_expense_accepts_self_as_payer(self, db_session, owner):
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[],
            group_id=None,
            current_user_id=owner.id,
        )


# --- validate_expense_participants: splits ---------------------------------

class TestValidateSplitParticipants:
    def test_valid_member_split_accepted(self, db_session, group, owner):
        member = make_user(db_session, "member@example.com")
        add_member(db_session, group, member)
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[
                schemas.ExpenseSplitBase(user_id=owner.id, amount_owed=500),
                schemas.ExpenseSplitBase(user_id=member.id, amount_owed=500),
            ],
            group_id=group.id,
        )

    def test_missing_user_in_splits_rejected(self, db_session, group, owner):
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[schemas.ExpenseSplitBase(user_id=99999, amount_owed=500)],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "not found in splits" in exc.value.detail

    def test_non_member_in_splits_rejected(self, db_session, group, owner):
        outsider = make_user(db_session, "outsider@example.com")
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[schemas.ExpenseSplitBase(user_id=outsider.id, amount_owed=500)],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "is not a member of the group" in exc.value.detail

    def test_guest_split_from_another_group_rejected(self, db_session, group, owner):
        other_group = make_group(db_session, owner, name="Other")
        foreign_guest = make_guest(db_session, other_group, owner)
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[
                    schemas.ExpenseSplitBase(
                        user_id=foreign_guest.id, is_guest=True, amount_owed=500
                    )
                ],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "does not belong to group" in exc.value.detail

    def test_missing_guest_in_splits_rejected(self, db_session, group, owner):
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[
                    schemas.ExpenseSplitBase(user_id=99999, is_guest=True, amount_owed=500)
                ],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "not found in splits" in exc.value.detail

    def test_guest_in_non_group_expense_requires_shared_group(self, db_session, owner):
        other_owner = make_user(db_session, "other@example.com")
        other_group = make_group(db_session, other_owner, name="Theirs")
        their_guest = make_guest(db_session, other_group, other_owner)
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[
                    schemas.ExpenseSplitBase(
                        user_id=their_guest.id, is_guest=True, amount_owed=500
                    )
                ],
                group_id=None,
                current_user_id=owner.id,
            )
        assert exc.value.status_code == 400
        assert "do not have access to guest" in exc.value.detail


# --- validate_expense_participants: item assignments -----------------------

class TestValidateItemAssignments:
    def test_valid_assignment_accepted(self, db_session, group, owner):
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[],
            items=[
                schemas.ExpenseItemCreate(
                    description="Pizza",
                    price=1000,
                    assignments=[schemas.ItemAssignment(user_id=owner.id)],
                )
            ],
            group_id=group.id,
        )

    def test_non_member_assignee_rejected(self, db_session, group, owner):
        outsider = make_user(db_session, "outsider@example.com")
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[],
                items=[
                    schemas.ExpenseItemCreate(
                        description="Pizza",
                        price=1000,
                        assignments=[schemas.ItemAssignment(user_id=outsider.id)],
                    )
                ],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "is not a member of the group" in exc.value.detail

    def test_temp_guest_assignment_skipped_when_flag_set(self, db_session, group, owner):
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[],
            items=[
                schemas.ExpenseItemCreate(
                    description="Pizza",
                    price=1000,
                    assignments=[schemas.ItemAssignment(temp_guest_id="tmp-1")],
                )
            ],
            skip_expense_guest_validation=True,
            group_id=group.id,
        )

    def test_assignment_without_user_id_is_skipped(self, db_session, group, owner):
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[],
            items=[
                schemas.ExpenseItemCreate(
                    description="Pizza",
                    price=1000,
                    assignments=[schemas.ItemAssignment(expense_guest_id=5)],
                )
            ],
            group_id=group.id,
        )

    def test_group_guest_assignee_accepted(self, db_session, group, owner):
        group_guest = make_guest(db_session, group, owner)
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[],
            items=[
                schemas.ExpenseItemCreate(
                    description="Pizza",
                    price=1000,
                    assignments=[
                        schemas.ItemAssignment(user_id=group_guest.id, is_guest=True)
                    ],
                )
            ],
            group_id=group.id,
        )

    def test_missing_guest_assignee_rejected(self, db_session, group, owner):
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[],
                items=[
                    schemas.ExpenseItemCreate(
                        description="Pizza",
                        price=1000,
                        assignments=[schemas.ItemAssignment(user_id=99999, is_guest=True)],
                    )
                ],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "not found in item assignments" in exc.value.detail

    def test_guest_assignee_from_another_group_rejected(self, db_session, group, owner):
        other_group = make_group(db_session, owner, name="Other")
        foreign_guest = make_guest(db_session, other_group, owner)
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[],
                items=[
                    schemas.ExpenseItemCreate(
                        description="Pizza",
                        price=1000,
                        assignments=[
                            schemas.ItemAssignment(user_id=foreign_guest.id, is_guest=True)
                        ],
                    )
                ],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "does not belong to group" in exc.value.detail

    def test_missing_user_assignee_rejected(self, db_session, group, owner):
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[],
                items=[
                    schemas.ExpenseItemCreate(
                        description="Pizza",
                        price=1000,
                        assignments=[schemas.ItemAssignment(user_id=99999)],
                    )
                ],
                group_id=group.id,
            )
        assert exc.value.status_code == 400
        assert "not found in item assignments" in exc.value.detail

    def test_non_friend_assignee_rejected_for_non_group_expense(self, db_session, owner):
        stranger = make_user(db_session, "stranger@example.com")
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[],
                items=[
                    schemas.ExpenseItemCreate(
                        description="Pizza",
                        price=1000,
                        assignments=[schemas.ItemAssignment(user_id=stranger.id)],
                    )
                ],
                group_id=None,
                current_user_id=owner.id,
            )
        assert exc.value.status_code == 400
        assert "is not a friend" in exc.value.detail

    def test_guest_assignee_in_non_group_expense_requires_shared_group(
        self, db_session, owner
    ):
        other_owner = make_user(db_session, "other@example.com")
        other_group = make_group(db_session, other_owner, name="Theirs")
        their_guest = make_guest(db_session, other_group, other_owner)
        with pytest.raises(HTTPException) as exc:
            validate_expense_participants(
                db_session,
                payer_id=owner.id,
                payer_is_guest=False,
                splits=[],
                items=[
                    schemas.ExpenseItemCreate(
                        description="Pizza",
                        price=1000,
                        assignments=[
                            schemas.ItemAssignment(user_id=their_guest.id, is_guest=True)
                        ],
                    )
                ],
                group_id=None,
                current_user_id=owner.id,
            )
        assert exc.value.status_code == 400
        assert "do not have access to guest" in exc.value.detail

    def test_item_without_assignments_is_skipped(self, db_session, group, owner):
        validate_expense_participants(
            db_session,
            payer_id=owner.id,
            payer_is_guest=False,
            splits=[],
            items=[
                schemas.ExpenseItemCreate(description="Unclaimed", price=1000, assignments=[])
            ],
            group_id=group.id,
        )


# --- validate_item_split_details -------------------------------------------

def build_item(price, assignments, split_type, split_details=None):
    return schemas.ExpenseItemCreate(
        description="Item",
        price=price,
        assignments=assignments,
        split_type=split_type,
        split_details=split_details,
    )


TWO_USERS = [
    schemas.ItemAssignment(user_id=1),
    schemas.ItemAssignment(user_id=2),
]


class TestValidateItemSplitDetails:
    def test_equal_split_needs_no_details(self):
        validate_item_split_details([build_item(1000, TWO_USERS, "EQUAL")])

    def test_single_assignee_skips_validation(self):
        validate_item_split_details(
            [build_item(1000, [schemas.ItemAssignment(user_id=1)], "EXACT")]
        )

    def test_missing_details_for_non_equal_split_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_item_split_details([build_item(1000, TWO_USERS, "EXACT")])
        assert exc.value.status_code == 400
        assert "Split details required" in exc.value.detail

    def test_exact_amounts_matching_price_accepted(self):
        validate_item_split_details([
            build_item(1000, TWO_USERS, "EXACT", {
                "user_1": schemas.ItemSplitDetail(amount=600),
                "user_2": schemas.ItemSplitDetail(amount=400),
            })
        ])

    def test_exact_amounts_off_by_more_than_tolerance_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_item_split_details([
                build_item(1000, TWO_USERS, "EXACT", {
                    "user_1": schemas.ItemSplitDetail(amount=600),
                    "user_2": schemas.ItemSplitDetail(amount=300),
                })
            ])
        assert exc.value.status_code == 400
        assert "don't match item price" in exc.value.detail

    def test_exact_amounts_within_rounding_tolerance_accepted(self):
        # Tolerance is one cent per assignee.
        validate_item_split_details([
            build_item(1000, TWO_USERS, "EXACT", {
                "user_1": schemas.ItemSplitDetail(amount=600),
                "user_2": schemas.ItemSplitDetail(amount=398),
            })
        ])

    def test_percentages_summing_to_100_accepted(self):
        validate_item_split_details([
            build_item(1000, TWO_USERS, "PERCENT", {
                "user_1": schemas.ItemSplitDetail(percentage=60),
                "user_2": schemas.ItemSplitDetail(percentage=40),
            })
        ])

    def test_percentages_not_summing_to_100_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_item_split_details([
                build_item(1000, TWO_USERS, "PERCENT", {
                    "user_1": schemas.ItemSplitDetail(percentage=60),
                    "user_2": schemas.ItemSplitDetail(percentage=30),
                })
            ])
        assert exc.value.status_code == 400
        assert "must add up to 100%" in exc.value.detail

    def test_valid_shares_accepted(self):
        validate_item_split_details([
            build_item(1000, TWO_USERS, "SHARES", {
                "user_1": schemas.ItemSplitDetail(shares=3),
                "user_2": schemas.ItemSplitDetail(shares=1),
            })
        ])

    def test_shares_below_one_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_item_split_details([
                build_item(1000, TWO_USERS, "SHARES", {
                    "user_1": schemas.ItemSplitDetail(shares=0),
                    "user_2": schemas.ItemSplitDetail(shares=1),
                })
            ])
        assert exc.value.status_code == 400
        assert "Shares must be at least 1" in exc.value.detail

    def test_error_message_reports_one_based_item_index(self):
        with pytest.raises(HTTPException) as exc:
            validate_item_split_details([
                build_item(1000, TWO_USERS, "EQUAL"),
                build_item(1000, TWO_USERS, "PERCENT", {
                    "user_1": schemas.ItemSplitDetail(percentage=10),
                    "user_2": schemas.ItemSplitDetail(percentage=10),
                }),
            ])
        assert exc.value.detail.startswith("Item 2:")


    def test_shares_missing_for_an_assignee_count_as_one(self):
        validate_item_split_details([
            build_item(1000, TWO_USERS, "SHARES", {
                "user_1": schemas.ItemSplitDetail(shares=3),
            })
        ])

    def test_exact_amount_missing_for_an_assignee_counts_as_zero(self):
        validate_item_split_details([
            build_item(1000, TWO_USERS, "EXACT", {
                "user_1": schemas.ItemSplitDetail(amount=1000),
            })
        ])

    def test_split_details_given_as_plain_dicts_are_read(self):
        item = build_item(1000, TWO_USERS, "EXACT")
        item.split_details = {"user_1": {"amount": 600}, "user_2": {"amount": 400}}
        assert isinstance(item.split_details["user_1"], dict)
        validate_item_split_details([item])

        rejected = build_item(1000, TWO_USERS, "EXACT")
        rejected.split_details = {"user_1": {"amount": 600}, "user_2": {"amount": 300}}
        with pytest.raises(HTTPException) as exc:
            validate_item_split_details([rejected])
        assert exc.value.status_code == 400
        assert "don't match item price" in exc.value.detail
