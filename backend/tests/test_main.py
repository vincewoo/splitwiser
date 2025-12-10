import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.main import app, get_db
from backend.database import Base

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def run_around_tests():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

def test_create_user():
    response = client.post(
        "/register",
        json={"email": "test@example.com", "password": "password123", "full_name": "Test User"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@example.com"
    assert "id" in data

def test_login_user():
    client.post(
        "/register",
        json={"email": "test@example.com", "password": "password123", "full_name": "Test User"},
    )
    response = client.post(
        "/token",
        data={"username": "test@example.com", "password": "password123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

def test_create_expense_and_check_balance():
    # Register two users
    client.post("/register", json={"email": "user1@example.com", "password": "password123", "full_name": "User 1"})
    client.post("/register", json={"email": "user2@example.com", "password": "password123", "full_name": "User 2"})

    # Login User 1
    login_res = client.post("/token", data={"username": "user1@example.com", "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # User 1 adds expense of 100 USD, split equally with User 2
    # User 1 pays 100. User 1 split: 50. User 2 split: 50.
    # User 2 owes User 1 50.

    # We need user ids. Assuming 1 and 2.
    expense_data = {
        "description": "Lunch",
        "amount": 10000, # 100.00 USD
        "currency": "USD",
        "date": "2023-10-27T12:00:00",
        "payer_id": 1,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": 1, "amount_owed": 5000},
            {"user_id": 2, "amount_owed": 5000}
        ]
    }

    res = client.post("/expenses", json=expense_data, headers=headers)
    assert res.status_code == 200

    # Check Balance for User 1
    # User 1 should be OWED 50.00 USD by User 2
    res_balance = client.get("/balances", headers=headers)
    assert res_balance.status_code == 200
    balances = res_balance.json()["balances"]

    assert len(balances) == 1
    assert balances[0]["user_id"] == 2
    assert balances[0]["amount"] == 5000
    assert balances[0]["currency"] == "USD"
