from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash
from models import Group, GroupMember, User


def create_user(db: Session, email: str, name: str) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash("password123"),
        full_name=name,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def create_auth_headers(user: User):
    access_token = create_access_token(data={"sub": user.email})
    return {"Authorization": f"Bearer {access_token}"}

def test_create_expense_with_non_friend_user(client: TestClient, db_session: Session):
    """
    Vulnerability: Attacker can add a random user (not a friend) to an expense.
    """
    attacker = create_user(db_session, "attacker@example.com", "Attacker")
    victim = create_user(db_session, "victim@example.com", "Victim")

    headers = create_auth_headers(attacker)

    # Attacker tries to create an expense involving Victim (who is NOT a friend)
    response = client.post(
        "/expenses",
        json={
            "description": "Spam Expense",
            "amount": 1000,
            "currency": "USD",
            "date": "2023-01-01",
            "payer_id": attacker.id,
            "split_type": "EQUAL",
            "splits": [
                {
                    "user_id": attacker.id,
                    "amount_owed": 500
                },
                {
                    "user_id": victim.id,
                    "amount_owed": 500
                }
            ]
        },
        headers=headers
    )

    # If vulnerability exists, this will return 200.
    # We want it to be 403 or 400.
    assert response.status_code == 400, "Should not allow adding non-friend to expense"
    assert "not a friend" in response.json()["detail"]

def test_create_group_expense_with_non_member(client: TestClient, db_session: Session):
    """
    Vulnerability: Attacker can add a user who is NOT in the group to a group expense.
    """
    attacker = create_user(db_session, "attacker2@example.com", "Attacker 2")
    victim = create_user(db_session, "victim2@example.com", "Victim 2")

    # Create group and add Attacker
    group = Group(name="Attacker's Group", created_by_id=attacker.id, default_currency="USD")
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    db_session.add(GroupMember(group_id=group.id, user_id=attacker.id))
    db_session.commit()

    headers = create_auth_headers(attacker)

    # Attacker tries to create a group expense involving Victim (who is NOT in the group)
    response = client.post(
        "/expenses",
        json={
            "description": "Group Spam Expense",
            "amount": 1000,
            "currency": "USD",
            "date": "2023-01-01",
            "payer_id": attacker.id,
            "group_id": group.id,
            "split_type": "EQUAL",
            "splits": [
                {
                    "user_id": attacker.id,
                    "amount_owed": 500
                },
                {
                    "user_id": victim.id,
                    "amount_owed": 500
                }
            ]
        },
        headers=headers
    )

    # If vulnerability exists, this will return 200.
    assert response.status_code == 400, "Should not allow adding non-member to group expense"
    assert "not a member of the group" in response.json()["detail"]


def test_create_expense_in_group_you_are_not_in(client: TestClient, db_session: Session):
    """A settlement between two members is a valid expense in every other
    respect — the payer and the split both belong to the group — so the only
    thing standing between an outsider and the group's ledger is a check on
    who is asking."""
    owner = create_user(db_session, "owner@example.com", "Owner")
    member = create_user(db_session, "member@example.com", "Member")
    outsider = create_user(db_session, "outsider@example.com", "Outsider")

    group_id = client.post(
        "/groups", headers=create_auth_headers(owner), json={"name": "Private", "default_currency": "USD"}
    ).json()["id"]
    client.post(
        f"/groups/{group_id}/members",
        headers=create_auth_headers(owner),
        json={"email": member.email},
    )

    payload = {
        "description": "Payment (Member → Owner)",
        "amount": 5000,
        "currency": "USD",
        "date": "2023-01-01",
        "group_id": group_id,
        "payer_id": member.id,
        "payer_is_guest": False,
        "split_type": "EQUAL",
        "is_settlement": True,
        "splits": [{"user_id": owner.id, "amount_owed": 5000, "is_guest": False}],
    }

    refused = client.post("/expenses", json=payload, headers=create_auth_headers(outsider))
    assert refused.status_code == 403
    assert "not a member" in refused.json()["detail"]

    # The same request from a member is fine — including one who is neither
    # the payer nor the payee, since the group's plan lets a member record a
    # payment between two other people.
    allowed = client.post("/expenses", json=payload, headers=create_auth_headers(owner))
    assert allowed.status_code == 200
