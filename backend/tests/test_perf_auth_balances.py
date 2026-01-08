
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from main import app
from models import User, Group, GroupMember, GuestMember, Expense, ExpenseSplit
from database import get_db
from auth import get_password_hash

@pytest.fixture
def query_counter():
    class QueryCounter:
        def __init__(self):
            self.count = 0
        def __call__(self, conn, cursor, statement, parameters, context, executemany):
            self.count += 1

    counter = QueryCounter()
    event.listen(Engine, "before_cursor_execute", counter)
    yield counter
    event.remove(Engine, "before_cursor_execute", counter)

def test_auth_group_balances_n_plus_one(client: TestClient, db_session: Session, query_counter):
    # Create a user and login
    password = "password123"
    hashed_password = get_password_hash(password)
    user = User(email="test_perf@example.com", hashed_password=hashed_password, full_name="Test User")
    db_session.add(user)
    db_session.commit()

    # Login to get token
    response = client.post("/token", data={"username": "test_perf@example.com", "password": "password123"})
    token = response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create a group
    group = Group(name="Auth Group", created_by_id=user.id)
    db_session.add(group)
    db_session.commit()

    # Add the creator as a member
    member = GroupMember(group_id=group.id, user_id=user.id)
    db_session.add(member)
    db_session.commit()

    # Create N expenses
    N = 20
    for i in range(N):
        expense = Expense(
            description=f"Expense {i}",
            amount=100.0,
            currency="USD",
            payer_id=user.id,
            payer_is_guest=False,
            group_id=group.id,
            created_by_id=user.id,
            split_type="EQUAL"
        )
        db_session.add(expense)
        db_session.commit()

        # Add split
        split = ExpenseSplit(
            expense_id=expense.id,
            user_id=user.id,
            is_guest=False,
            amount_owed=100.0,
            percentage=100.0,
            shares=1.0
        )
        db_session.add(split)
        db_session.commit()

    # Reset query count
    query_counter.count = 0

    # Call the API
    response = client.get(f"/groups/{group.id}/balances", headers=headers)
    assert response.status_code == 200

    print(f"Query count for {N} expenses: {query_counter.count}")

    # After optimization, the query count should be significantly lower than N=20.
    # It was 51 before optimization, now it is 13.
    # Expected queries:
    # 1. User/Auth checks
    # 2. Get Group
    # 3. Get Members
    # 4. Get Expenses
    # 5. Get Splits (Batched!)
    # 6. Get Managed Guests
    # 7. Get Managed Members
    # 8. Batch fetch Users
    # 9. Batch fetch Guests
    # ... and maybe a few others for validation etc.
    # It should definitely be less than 20.
    assert query_counter.count < 20, f"Expected optimized queries (< 20), but got {query_counter.count}"
