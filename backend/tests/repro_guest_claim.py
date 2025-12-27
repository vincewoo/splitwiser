
import pytest
from conftest import client, db_session
import models

def test_repro_guest_claim_bug(client, db_session):
    # 1. Register and Login User 1 (Creator)
    client.post("/register", json={"email": "creator@example.com", "password": "password", "full_name": "Creator"})
    login_res = client.post("/token", data={"username": "creator@example.com", "password": "password"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Create Group
    group_res = client.post("/groups", json={"name": "Test Group"}, headers=headers)
    assert group_res.status_code == 200
    group_id = group_res.json()["id"]

    # 3. Create Guest "Paul"
    paul_res = client.post(f"/groups/{group_id}/guests", json={"name": "Paul"}, headers=headers)
    assert paul_res.status_code == 200
    paul_id = paul_res.json()["id"]

    # 4. Create Guest "Sara"
    sara_res = client.post(f"/groups/{group_id}/guests", json={"name": "Sara"}, headers=headers)
    assert sara_res.status_code == 200
    sara_id = sara_res.json()["id"]

    # 5. Make Paul manage Sara
    manage_res = client.post(f"/groups/{group_id}/guests/{sara_id}/manage", json={
        "user_id": paul_id,
        "is_guest": True
    }, headers=headers)
    assert manage_res.status_code == 200
    
    # Verify Sara is managed by Paul
    sara_check = db_session.query(models.GuestMember).filter(models.GuestMember.id == sara_id).first()
    assert sara_check.managed_by_id == paul_id
    assert sara_check.managed_by_type == 'guest'

    # 6. Enable Sharing
    share_res = client.post(f"/groups/{group_id}/share", headers=headers)
    assert share_res.status_code == 200
    share_link_id = share_res.json()["share_link_id"]

    # 7. Register User 2 (Paul) claiming Guest Paul
    res = client.post(
        "/register",
        json={
            "email": "paul@example.com", 
            "password": "password", 
            "full_name": "Paul User",
            "claim_guest_id": paul_id,
            "share_link_id": share_link_id
        },
    )
    assert res.status_code == 200
    data = res.json()
    new_user_token = data["access_token"]
    
    # Verify claimed_group_id is returned
    assert data["claimed_group_id"] == group_id

    # Find the new user id first (needed for verification below)
    new_user = db_session.query(models.User).filter(models.User.email == "paul@example.com").first()
    assert new_user is not None

    # 8. Verify Paul Guest is claimed (not deleted)
    paul_guest = db_session.query(models.GuestMember).filter(models.GuestMember.id == paul_id).first()
    assert paul_guest is not None, "Paul guest record should still exist"
    assert paul_guest.claimed_by_id == new_user.id, "Paul guest should be claimed by the new user"

    # 9. Verify Sara is now managed by the new User (Paul User)
    sara_after = db_session.query(models.GuestMember).filter(models.GuestMember.id == sara_id).first()
    
    # Assert Sara still exists
    assert sara_after is not None, "Sara should still exist"
    
    # Assert Sara is managed by the new user
    assert sara_after.managed_by_id == new_user.id
    assert sara_after.managed_by_type == 'user'

