from auth import get_password_hash
from models import User

def test_add_registered_member(client, auth_headers, db_session):
    # Create another user to add
    other_user = User(
        email="other@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Other User",
        is_active=True
    )
    db_session.add(other_user)
    db_session.commit()

    # Create a group
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Member Group", "default_currency": "USD"}
    )
    group_id = group_resp.json()["id"]

    # Add member
    response = client.post(
        f"/groups/{group_id}/members",
        headers=auth_headers,
        json={"email": "other@example.com"}
    )
    assert response.status_code == 200
    
    # Verify member is in group
    details_resp = client.get(f"/groups/{group_id}", headers=auth_headers)
    members = details_resp.json()["members"]
    assert len(members) == 2
    assert any(m["email"] == "other@example.com" for m in members)

def test_add_guest_member(client, auth_headers):
    # Create a group
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Guest Group", "default_currency": "USD"}
    )
    group_id = group_resp.json()["id"]

    # Add guest
    response = client.post(
        f"/groups/{group_id}/guests",
        headers=auth_headers,
        json={"name": "Guest User"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Guest User"
    
    # Verify guest in group details
    details_resp = client.get(f"/groups/{group_id}", headers=auth_headers)
    guests = details_resp.json()["guests"]
    assert len(guests) == 1
    assert guests[0]["name"] == "Guest User"

def test_manage_guest(client, auth_headers, db_session, test_user):
    # Create a group
    group_resp = client.post(
        "/groups/",
        headers=auth_headers,
        json={"name": "Managed Guest Group", "default_currency": "USD"}
    )
    group_id = group_resp.json()["id"]

    # Add guest
    guest_resp = client.post(
        f"/groups/{group_id}/guests",
        headers=auth_headers,
        json={"name": "Managed Guest"}
    )
    guest_id = guest_resp.json()["id"]

    # Link guest to user (Manage Guest)
    # The endpoint is POST /groups/{group_id}/guests/{guest_id}/manage
    response = client.post(
        f"/groups/{group_id}/guests/{guest_id}/manage",
        headers=auth_headers,
        json={"user_id": test_user.id, "is_guest": False}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["guest"]["managed_by_id"] == test_user.id
    
    # Verify in group details
    details_resp = client.get(f"/groups/{group_id}", headers=auth_headers)
    guests = details_resp.json()["guests"]
    assert guests[0]["managed_by_id"] == test_user.id
