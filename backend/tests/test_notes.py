import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from main import app, get_db
from database import Base
import models

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_notes.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

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
    # Ensure notes column exists for tests (since we use create_all, it uses models.py which we updated)
    yield
    Base.metadata.drop_all(bind=engine)

def test_create_expense_with_notes():
    # Register user
    client.post("/register", json={"email": "user1@example.com", "password": "password123", "full_name": "User 1"})
    
    # Login
    login_res = client.post("/token", data={"username": "user1@example.com", "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Add expense with notes
    expense_data = {
        "description": "Dinner with notes",
        "amount": 5000,
        "currency": "USD",
        "date": "2023-10-27T19:00:00",
        "payer_id": 1,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": 1, "amount_owed": 5000}
        ],
        "notes": "This was a great dinner!"
    }

    res = client.post("/expenses", json=expense_data, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["notes"] == "This was a great dinner!"

    # Get expense details
    res_get = client.get(f"/expenses/{data['id']}", headers=headers)
    assert res_get.status_code == 200
    data_get = res_get.json()
    assert data_get["notes"] == "This was a great dinner!"

def test_update_expense_notes():
    # Register user
    client.post("/register", json={"email": "user1@example.com", "password": "password123", "full_name": "User 1"})
    
    # Login
    login_res = client.post("/token", data={"username": "user1@example.com", "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Add expense without notes
    expense_data = {
        "description": "Lunch",
        "amount": 2000,
        "currency": "USD",
        "date": "2023-10-28T12:00:00",
        "payer_id": 1,
        "split_type": "EQUAL",
        "splits": [
            {"user_id": 1, "amount_owed": 2000}
        ]
    }

    res = client.post("/expenses", json=expense_data, headers=headers)
    assert res.status_code == 200
    expense_id = res.json()["id"]

    # Update expense to add notes
    update_data = expense_data.copy()
    update_data["notes"] = "Added some notes later."

    res_update = client.put(f"/expenses/{expense_id}", json=update_data, headers=headers)
    assert res_update.status_code == 200
    data_update = res_update.json()
    assert data_update["notes"] == "Added some notes later."
