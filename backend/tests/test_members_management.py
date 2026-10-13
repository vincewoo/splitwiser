"""Integration tests for the members router.

Covers adding and removing members and guests, claiming a guest profile, and
the manager links used to aggregate balances onto another person.
"""

import pytest

import models
from auth import create_access_token, get_password_hash

# --- helpers ---------------------------------------------------------------

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


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': user.email})}"}


@pytest.fixture
def group_id(client, auth_headers):
    response = client.post("/groups/", headers=auth_headers,
                           json={"name": "Trip", "default_currency": "USD"})
    assert response.status_code == 200
    return response.json()["id"]


@pytest.fixture
def other_user(db_session):
    return make_user(db_session, "other@example.com", "Other Person")


@pytest.fixture
def member(client, auth_headers, group_id, other_user):
    """A second registered user who is a member of the group."""
    response = client.post(f"/groups/{group_id}/members", headers=auth_headers,
                           json={"email": other_user.email})
    assert response.status_code == 200
    return other_user


def add_guest(client, auth_headers, group_id, name="Bob"):
    response = client.post(f"/groups/{group_id}/guests", headers=auth_headers,
                           json={"name": name})
    assert response.status_code == 200
    return response.json()


# --- POST /groups/{id}/members ---------------------------------------------

class TestAddMember:
    def test_adds_a_registered_user_by_email(
        self, client, auth_headers, group_id, other_user
    ):
        response = client.post(f"/groups/{group_id}/members", headers=auth_headers,
                               json={"email": other_user.email})
        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == other_user.id
        assert data["email"] == other_user.email
        assert data["full_name"] == "Other Person"

    def test_unknown_email_returns_404(self, client, auth_headers, group_id):
        response = client.post(f"/groups/{group_id}/members", headers=auth_headers,
                               json={"email": "nobody@example.com"})
        assert response.status_code == 404

    def test_adding_the_same_user_twice_is_rejected(
        self, client, auth_headers, group_id, member
    ):
        response = client.post(f"/groups/{group_id}/members", headers=auth_headers,
                               json={"email": member.email})
        assert response.status_code == 400
        assert "already a member" in response.json()["detail"]

    def test_non_member_cannot_add_members(
        self, client, auth_headers, db_session, group_id, other_user
    ):
        outsider = make_user(db_session, "outsider@example.com")
        response = client.post(f"/groups/{group_id}/members", headers=headers_for(outsider),
                               json={"email": other_user.email})
        assert response.status_code == 403

    def test_missing_group_returns_404(self, client, auth_headers, other_user):
        response = client.post("/groups/99999/members", headers=auth_headers,
                               json={"email": other_user.email})
        assert response.status_code == 404

    def test_requires_authentication(self, client, group_id, other_user):
        response = client.post(f"/groups/{group_id}/members",
                               json={"email": other_user.email})
        assert response.status_code == 401


# --- DELETE /groups/{id}/members/{user_id} ---------------------------------

class TestRemoveMember:
    def test_owner_can_remove_another_member(
        self, client, auth_headers, db_session, group_id, member
    ):
        response = client.delete(f"/groups/{group_id}/members/{member.id}",
                                 headers=auth_headers)
        assert response.status_code == 200
        remaining = db_session.query(models.GroupMember).filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.user_id == member.id,
        ).count()
        assert remaining == 0

    def test_member_can_remove_themselves(
        self, client, auth_headers, group_id, member
    ):
        response = client.delete(f"/groups/{group_id}/members/{member.id}",
                                 headers=headers_for(member))
        assert response.status_code == 200

    def test_member_cannot_remove_someone_else(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        third = make_user(db_session, "third@example.com")
        client.post(f"/groups/{group_id}/members", headers=auth_headers,
                    json={"email": third.email})

        response = client.delete(f"/groups/{group_id}/members/{third.id}",
                                 headers=headers_for(member))
        assert response.status_code == 403

    def test_owner_cannot_be_removed(self, client, auth_headers, group_id, test_user):
        response = client.delete(f"/groups/{group_id}/members/{test_user.id}",
                                 headers=auth_headers)
        assert response.status_code == 400
        assert "owner cannot be removed" in response.json()["detail"]

    def test_removing_a_non_member_returns_404(
        self, client, auth_headers, db_session, group_id
    ):
        stranger = make_user(db_session, "stranger@example.com")
        response = client.delete(f"/groups/{group_id}/members/{stranger.id}",
                                 headers=auth_headers)
        assert response.status_code == 404

    def test_removal_unlinks_guests_that_member_managed(
        self, client, auth_headers, db_session, group_id, member
    ):
        guest = add_guest(client, auth_headers, group_id)
        client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                    headers=auth_headers, json={"user_id": member.id, "is_guest": False})

        client.delete(f"/groups/{group_id}/members/{member.id}", headers=auth_headers)

        db_session.expire_all()
        stored = db_session.query(models.GuestMember).get(guest["id"])
        assert stored.managed_by_id is None
        assert stored.managed_by_type is None

    def test_removal_unlinks_members_that_member_managed(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        third = make_user(db_session, "third@example.com")
        client.post(f"/groups/{group_id}/members", headers=auth_headers,
                    json={"email": third.email})
        client.post(f"/groups/{group_id}/members/{third.id}/manage",
                    headers=auth_headers, json={"user_id": member.id, "is_guest": False})

        client.delete(f"/groups/{group_id}/members/{member.id}", headers=auth_headers)

        db_session.expire_all()
        stored = db_session.query(models.GroupMember).filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.user_id == third.id,
        ).first()
        assert stored.managed_by_id is None


# --- guests ----------------------------------------------------------------

class TestGuests:
    def test_add_guest(self, client, auth_headers, group_id, test_user):
        response = client.post(f"/groups/{group_id}/guests", headers=auth_headers,
                               json={"name": "Bob"})
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Bob"
        assert data["group_id"] == group_id
        assert data["created_by_id"] == test_user.id
        assert data["claimed_by_id"] is None

    def test_guest_names_need_not_be_unique(self, client, auth_headers, group_id):
        first = add_guest(client, auth_headers, group_id, "Bob")
        second = add_guest(client, auth_headers, group_id, "Bob")
        assert first["id"] != second["id"]

    def test_overlong_guest_name_rejected(self, client, auth_headers, group_id):
        response = client.post(f"/groups/{group_id}/guests", headers=auth_headers,
                               json={"name": "x" * 101})
        assert response.status_code == 422

    def test_non_member_cannot_add_a_guest(
        self, client, db_session, group_id
    ):
        outsider = make_user(db_session, "outsider@example.com")
        response = client.post(f"/groups/{group_id}/guests",
                               headers=headers_for(outsider), json={"name": "Bob"})
        assert response.status_code == 403

    def test_remove_guest(self, client, auth_headers, db_session, group_id):
        guest = add_guest(client, auth_headers, group_id)
        response = client.delete(f"/groups/{group_id}/guests/{guest['id']}",
                                 headers=auth_headers)
        assert response.status_code == 200
        assert db_session.query(models.GuestMember).get(guest["id"]) is None

    def test_removing_a_guest_from_another_group_returns_404(
        self, client, auth_headers, group_id
    ):
        other = client.post("/groups/", headers=auth_headers,
                            json={"name": "Other", "default_currency": "USD"}).json()
        guest = add_guest(client, auth_headers, other["id"])
        response = client.delete(f"/groups/{group_id}/guests/{guest['id']}",
                                 headers=auth_headers)
        assert response.status_code == 404

    def test_removing_an_unknown_guest_returns_404(self, client, auth_headers, group_id):
        assert client.delete(f"/groups/{group_id}/guests/99999",
                             headers=auth_headers).status_code == 404


# --- claiming --------------------------------------------------------------

class TestClaimGuest:
    def test_claim_marks_the_guest_as_claimed(
        self, client, auth_headers, db_session, group_id, member
    ):
        guest = add_guest(client, auth_headers, group_id)
        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                               headers=headers_for(member))
        assert response.status_code == 200

        db_session.expire_all()
        stored = db_session.query(models.GuestMember).get(guest["id"])
        assert stored.claimed_by_id == member.id

    def test_claim_transfers_splits_to_the_claimer(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        guest = add_guest(client, auth_headers, group_id)
        expense = client.post("/expenses/", headers=auth_headers, json={
            "description": "Dinner",
            "amount": 2000,
            "currency": "USD",
            "date": "2025-01-15",
            "payer_id": test_user.id,
            "payer_is_guest": False,
            "group_id": group_id,
            "split_type": "EQUAL",
            "splits": [
                {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
                {"user_id": guest["id"], "amount_owed": 1000, "is_guest": True},
            ],
        })
        assert expense.status_code == 200

        result = client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                             headers=headers_for(member))
        assert result.status_code == 200
        assert result.json()["transferred_splits"] == 1

        db_session.expire_all()
        moved = db_session.query(models.ExpenseSplit).filter(
            models.ExpenseSplit.expense_id == expense.json()["id"],
            models.ExpenseSplit.user_id == member.id,
            models.ExpenseSplit.is_guest == False,
        ).first()
        assert moved is not None
        assert moved.amount_owed == 1000

    def test_claim_transfers_expenses_the_guest_paid_for(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        guest = add_guest(client, auth_headers, group_id)
        expense = client.post("/expenses/", headers=auth_headers, json={
            "description": "Guest paid",
            "amount": 2000,
            "currency": "USD",
            "date": "2025-01-15",
            "payer_id": guest["id"],
            "payer_is_guest": True,
            "group_id": group_id,
            "split_type": "EQUAL",
            "splits": [
                {"user_id": test_user.id, "amount_owed": 1000, "is_guest": False},
                {"user_id": guest["id"], "amount_owed": 1000, "is_guest": True},
            ],
        })
        assert expense.status_code == 200

        result = client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                             headers=headers_for(member))
        assert result.json()["transferred_expenses"] == 1

        db_session.expire_all()
        stored = db_session.query(models.Expense).get(expense.json()["id"])
        assert stored.payer_id == member.id
        assert stored.payer_is_guest is False

    def test_claiming_twice_is_rejected(
        self, client, auth_headers, group_id, member
    ):
        guest = add_guest(client, auth_headers, group_id)
        client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                    headers=headers_for(member))
        second = client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                             headers=auth_headers)
        assert second.status_code == 400
        assert "already claimed" in second.json()["detail"]

    def test_claim_clears_the_guests_own_manager_link(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        # Otherwise the claimed balance would be double-counted onto the manager.
        guest = add_guest(client, auth_headers, group_id)
        client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                    headers=auth_headers, json={"user_id": test_user.id, "is_guest": False})

        client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                    headers=headers_for(member))

        db_session.expire_all()
        stored = db_session.query(models.GuestMember).get(guest["id"])
        assert stored.managed_by_id is None
        assert stored.managed_by_type is None

    def test_claim_reassigns_people_the_guest_managed(
        self, client, auth_headers, db_session, group_id, member
    ):
        manager_guest = add_guest(client, auth_headers, group_id, "Manager")
        managed_guest = add_guest(client, auth_headers, group_id, "Managed")
        client.post(f"/groups/{group_id}/guests/{managed_guest['id']}/manage",
                    headers=auth_headers,
                    json={"user_id": manager_guest["id"], "is_guest": True})

        result = client.post(f"/groups/{group_id}/guests/{manager_guest['id']}/claim",
                             headers=headers_for(member))
        assert result.json()["managed_guests_updated"] == 1

        db_session.expire_all()
        stored = db_session.query(models.GuestMember).get(managed_guest["id"])
        assert stored.managed_by_id == member.id
        assert stored.managed_by_type == "user"

    def test_non_member_cannot_claim(self, client, auth_headers, db_session, group_id):
        guest = add_guest(client, auth_headers, group_id)
        outsider = make_user(db_session, "outsider@example.com")
        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                               headers=headers_for(outsider))
        assert response.status_code == 403

    def test_claiming_an_unknown_guest_returns_404(self, client, auth_headers, group_id):
        assert client.post(f"/groups/{group_id}/guests/99999/claim",
                           headers=auth_headers).status_code == 404


# --- guest manager links ---------------------------------------------------

class TestManageGuest:
    def test_link_guest_to_a_user_manager(
        self, client, auth_headers, db_session, group_id, test_user
    ):
        guest = add_guest(client, auth_headers, group_id)
        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": test_user.id, "is_guest": False})
        assert response.status_code == 200
        body = response.json()["guest"]
        assert body["managed_by_id"] == test_user.id
        assert body["managed_by_type"] == "user"
        assert body["managed_by_name"] == "Test User"

    def test_link_guest_to_another_guest(self, client, auth_headers, group_id):
        manager = add_guest(client, auth_headers, group_id, "Manager")
        managed = add_guest(client, auth_headers, group_id, "Managed")
        response = client.post(f"/groups/{group_id}/guests/{managed['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": manager["id"], "is_guest": True})
        assert response.status_code == 200
        body = response.json()["guest"]
        assert body["managed_by_type"] == "guest"
        assert body["managed_by_name"] == "Manager"

    def test_guest_cannot_manage_itself(self, client, auth_headers, group_id):
        guest = add_guest(client, auth_headers, group_id)
        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": guest["id"], "is_guest": True})
        assert response.status_code == 400
        assert "cannot manage itself" in response.json()["detail"]

    def test_a_claimed_guest_cannot_be_managed(
        self, client, auth_headers, group_id, member, test_user
    ):
        guest = add_guest(client, auth_headers, group_id)
        client.post(f"/groups/{group_id}/guests/{guest['id']}/claim",
                    headers=headers_for(member))
        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": test_user.id, "is_guest": False})
        assert response.status_code == 400
        assert "Cannot manage a claimed guest" in response.json()["detail"]

    def test_a_claimed_guest_cannot_be_the_manager(
        self, client, auth_headers, group_id, member
    ):
        manager = add_guest(client, auth_headers, group_id, "Manager")
        managed = add_guest(client, auth_headers, group_id, "Managed")
        client.post(f"/groups/{group_id}/guests/{manager['id']}/claim",
                    headers=headers_for(member))

        response = client.post(f"/groups/{group_id}/guests/{managed['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": manager["id"], "is_guest": True})
        assert response.status_code == 400
        assert "already claimed" in response.json()["detail"]

    def test_manager_must_be_a_group_member(
        self, client, auth_headers, db_session, group_id
    ):
        guest = add_guest(client, auth_headers, group_id)
        outsider = make_user(db_session, "outsider@example.com")
        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": outsider.id, "is_guest": False})
        assert response.status_code == 400
        assert "must be a group member" in response.json()["detail"]

    def test_manager_guest_must_be_in_the_same_group(
        self, client, auth_headers, group_id
    ):
        other = client.post("/groups/", headers=auth_headers,
                            json={"name": "Other", "default_currency": "USD"}).json()
        foreign_manager = add_guest(client, auth_headers, other["id"], "Foreign")
        guest = add_guest(client, auth_headers, group_id)

        response = client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                               headers=auth_headers,
                               json={"user_id": foreign_manager["id"], "is_guest": True})
        assert response.status_code == 400

    def test_relinking_replaces_the_previous_manager(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        guest = add_guest(client, auth_headers, group_id)
        client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                    headers=auth_headers, json={"user_id": test_user.id, "is_guest": False})
        client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                    headers=auth_headers, json={"user_id": member.id, "is_guest": False})

        db_session.expire_all()
        assert db_session.query(models.GuestMember).get(guest["id"]).managed_by_id == member.id

    def test_unmanage_clears_the_link(
        self, client, auth_headers, db_session, group_id, test_user
    ):
        guest = add_guest(client, auth_headers, group_id)
        client.post(f"/groups/{group_id}/guests/{guest['id']}/manage",
                    headers=auth_headers, json={"user_id": test_user.id, "is_guest": False})

        response = client.delete(f"/groups/{group_id}/guests/{guest['id']}/manage",
                                 headers=auth_headers)
        assert response.status_code == 200

        db_session.expire_all()
        stored = db_session.query(models.GuestMember).get(guest["id"])
        assert stored.managed_by_id is None
        assert stored.managed_by_type is None

    def test_unmanage_is_idempotent(self, client, auth_headers, group_id):
        guest = add_guest(client, auth_headers, group_id)
        assert client.delete(f"/groups/{group_id}/guests/{guest['id']}/manage",
                             headers=auth_headers).status_code == 200
        assert client.delete(f"/groups/{group_id}/guests/{guest['id']}/manage",
                             headers=auth_headers).status_code == 200

    def test_unmanage_unknown_guest_returns_404(self, client, auth_headers, group_id):
        assert client.delete(f"/groups/{group_id}/guests/99999/manage",
                             headers=auth_headers).status_code == 404


# --- member manager links --------------------------------------------------

class TestManageMember:
    def test_link_member_to_a_user_manager(
        self, client, auth_headers, group_id, member, test_user
    ):
        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=auth_headers,
                               json={"user_id": test_user.id, "is_guest": False})
        assert response.status_code == 200
        body = response.json()["member"]
        assert body["managed_by_id"] == test_user.id
        assert body["managed_by_type"] == "user"
        assert body["managed_by_name"] == "Test User"
        assert body["email"] == member.email

    def test_link_member_to_a_guest_manager(
        self, client, auth_headers, group_id, member
    ):
        manager = add_guest(client, auth_headers, group_id, "Manager")
        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=auth_headers,
                               json={"user_id": manager["id"], "is_guest": True})
        assert response.status_code == 200
        assert response.json()["member"]["managed_by_type"] == "guest"

    def test_member_cannot_manage_themselves(
        self, client, auth_headers, group_id, member
    ):
        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=auth_headers,
                               json={"user_id": member.id, "is_guest": False})
        assert response.status_code == 400
        assert "cannot manage themselves" in response.json()["detail"]

    def test_manager_must_be_a_group_member(
        self, client, auth_headers, db_session, group_id, member
    ):
        outsider = make_user(db_session, "outsider@example.com")
        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=auth_headers,
                               json={"user_id": outsider.id, "is_guest": False})
        assert response.status_code == 400

    def test_managing_a_non_member_returns_404(
        self, client, auth_headers, db_session, group_id, test_user
    ):
        stranger = make_user(db_session, "stranger@example.com")
        response = client.post(f"/groups/{group_id}/members/{stranger.id}/manage",
                               headers=auth_headers,
                               json={"user_id": test_user.id, "is_guest": False})
        assert response.status_code == 404

    def test_unmanage_clears_the_link(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        client.post(f"/groups/{group_id}/members/{member.id}/manage",
                    headers=auth_headers, json={"user_id": test_user.id, "is_guest": False})

        response = client.delete(f"/groups/{group_id}/members/{member.id}/manage",
                                 headers=auth_headers)
        assert response.status_code == 200

        db_session.expire_all()
        stored = db_session.query(models.GroupMember).filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.user_id == member.id,
        ).first()
        assert stored.managed_by_id is None

    def test_unmanage_unknown_member_returns_404(self, client, auth_headers, group_id):
        assert client.delete(f"/groups/{group_id}/members/99999/manage",
                             headers=auth_headers).status_code == 404

    def test_non_member_cannot_manage(
        self, client, auth_headers, db_session, group_id, member, test_user
    ):
        outsider = make_user(db_session, "outsider@example.com")
        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=headers_for(outsider),
                               json={"user_id": test_user.id, "is_guest": False})
        assert response.status_code == 403

    def test_a_claimed_guest_cannot_be_the_manager(
        self, client, auth_headers, group_id, member
    ):
        manager = add_guest(client, auth_headers, group_id, "Manager")
        client.post(f"/groups/{group_id}/guests/{manager['id']}/claim",
                    headers=headers_for(member))

        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=auth_headers,
                               json={"user_id": manager["id"], "is_guest": True})
        assert response.status_code == 400
        assert "already claimed" in response.json()["detail"]

    def test_manager_guest_must_be_in_the_same_group(
        self, client, auth_headers, group_id, member
    ):
        other = client.post("/groups/", headers=auth_headers,
                            json={"name": "Other", "default_currency": "USD"}).json()
        foreign_manager = add_guest(client, auth_headers, other["id"], "Foreign")

        response = client.post(f"/groups/{group_id}/members/{member.id}/manage",
                               headers=auth_headers,
                               json={"user_id": foreign_manager["id"], "is_guest": True})
        assert response.status_code == 400
