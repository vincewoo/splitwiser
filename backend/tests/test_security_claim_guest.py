
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from models import Group, GuestMember, User, GroupMember
from auth import create_access_token

def test_claim_guest_requires_membership(client: TestClient, db_session: Session):
    """
    Regression test for Critical Vulnerability: Unauthorized Guest Claiming.
    Ensures that a user cannot claim a guest in a group they are not a member of.
    """
    # 1. Setup: Create Owner and a Group with a Guest
    owner = User(email="owner@example.com", full_name="Owner", hashed_password="hash")
    db_session.add(owner)
    db_session.commit()
    db_session.refresh(owner)

    group = Group(name="Private Group", created_by_id=owner.id)
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    db_session.add(GroupMember(group_id=group.id, user_id=owner.id))

    guest = GuestMember(group_id=group.id, name="Guest Bob", created_by_id=owner.id)
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    # 2. Setup: Create Attacker (not in group)
    attacker = User(email="attacker@example.com", full_name="Attacker", hashed_password="hash")
    db_session.add(attacker)
    db_session.commit()
    db_session.refresh(attacker)

    attacker_token = create_access_token(data={"sub": attacker.email})
    attacker_headers = {"Authorization": f"Bearer {attacker_token}"}

    # 3. Attack: Attacker tries to claim the guest
    response = client.post(
        f"/groups/{group.id}/guests/{guest.id}/claim",
        headers=attacker_headers
    )

    # 4. Verify: Should be Forbidden (403)
    assert response.status_code == 403
    assert response.json()["detail"] == "You are not a member of this group"

    # Verify attacker is NOT added to group
    membership = db_session.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.user_id == attacker.id
    ).first()
    assert membership is None
