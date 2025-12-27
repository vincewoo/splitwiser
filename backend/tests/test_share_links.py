
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, get_db
from main import app
from models import User, Group, GroupMember, GuestMember
from auth import create_access_token

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="module")
def client():
    # Create tables
    Base.metadata.create_all(bind=engine)
    yield TestClient(app)
    # Drop tables
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="module")
def auth_headers(client):
    # Register user
    res = client.post("/register", json={"email": "test@example.com", "password": "password", "full_name": "Test User"})
    assert res.status_code == 200, f"Registration failed: {res.text}"
    
    response = client.post("/token", data={"username": "test@example.com", "password": "password"})
    assert response.status_code == 200, f"Login failed: {response.text}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_share_group_flow(client, auth_headers):
    # 1. Create Group
    res = client.post("/groups/", json={"name": "Shared Group", "default_currency": "USD"}, headers=auth_headers)
    assert res.status_code == 200
    group_id = res.json()["id"]

    # 2. Enable Sharing
    res = client.post(f"/groups/{group_id}/share", headers=auth_headers)
    assert res.status_code == 200
    share_data = res.json()
    assert share_data["is_public"] == True
    assert share_data["share_link_id"] is not None
    share_link_id = share_data["share_link_id"]

    # 3. Access Public Group Details (No Auth)
    res = client.get(f"/groups/public/{share_link_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Shared Group"
    assert data["is_public"] == True

    # 4. Access Public Expenses
    # Add expense first
    client.post(f"/expenses/", json={
        "description": "Lunch",
        "amount": 1000,
        "currency": "USD",
        "date": "2023-01-01",
        "payer_id": 1, # User 1
        "payer_is_guest": False,
        "group_id": group_id,
        "splits": [{"user_id": 1, "is_guest": False, "amount_owed": 1000}],
        "split_type": "EQUAL"
    }, headers=auth_headers)

    res = client.get(f"/groups/public/{share_link_id}/expenses")
    assert res.status_code == 200
    expenses = res.json()
    assert len(expenses) == 1
    assert expenses[0]["description"] == "Lunch"

    # 5. Access Public Balances
    res = client.get(f"/groups/public/{share_link_id}/balances")
    assert res.status_code == 200
    # No debts yet, so empty list? Or just returns balances.
    # Actually balances logic ensures we return something if there are expenses?
    # If I paid 1000 and split 1000 to myself, balance is 0.
    
    # 6. Disable Sharing
    res = client.delete(f"/groups/{group_id}/share", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["is_public"] == False

    # 7. Access Public Link should fail
    res = client.get(f"/groups/public/{share_link_id}")
    assert res.status_code == 404

def test_guest_claiming(client, auth_headers):
    # 1. Create Group
    res = client.post("/groups/", json={"name": "Guest Group", "default_currency": "USD"}, headers=auth_headers)
    group_id = res.json()["id"]

    # 2. Add Guest
    res = client.post(f"/groups/{group_id}/guests", json={"name": "Guest Bob"}, headers=auth_headers)
    guest_id = res.json()["id"]

    # 3. Share Group
    res = client.post(f"/groups/{group_id}/share", headers=auth_headers)
    share_link_id = res.json()["share_link_id"]

    # 4. Register new user with claim
    claim_payload = {
        "email": "bob@example.com",
        "password": "password",
        "full_name": "Bob Real",
        "claim_guest_id": guest_id,
        "share_link_id": share_link_id
    }
    res = client.post("/register", json=claim_payload)
    if res.status_code != 200:
        print(res.json())
    assert res.status_code == 200
    new_user_id = res.json()["id"]

    # 5. Log in as new user and check membership
    res = client.post("/token", data={"username": "bob@example.com", "password": "password"})
    new_token = res.json()["access_token"]
    new_headers = {"Authorization": f"Bearer {new_token}"}

    res = client.get(f"/groups/{group_id}", headers=new_headers)
    assert res.status_code == 200
    group_data = res.json()
    
    # Check that new user is a member
    members = group_data["members"]
    assert any(m["user_id"] == new_user_id for m in members)
    
    # Check that guest is gone? Or claimed?
    # My implementation deletes the guest record after claiming.
    guests = group_data["guests"]
    assert not any(g["id"] == guest_id for g in guests)
