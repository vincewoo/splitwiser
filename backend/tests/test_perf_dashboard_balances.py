
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from main import app
from models import User, Group, GroupMember, GuestMember, Expense, ExpenseSplit
from database import get_db
from auth import get_password_hash
from utils.rate_limiter import auth_rate_limiter

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

def test_dashboard_balances_n_plus_one(client: TestClient, db_session: Session, query_counter):
    # Disable rate limits for this test
    app.dependency_overrides[auth_rate_limiter] = lambda: True

    try:
        # Create a user and login
        password = "password123"
        hashed_password = get_password_hash(password)
        user = User(email="test_dashboard_perf@example.com", hashed_password=hashed_password, full_name="Test User")
        db_session.add(user)
        db_session.commit()

        # Login to get token
        response = client.post("/token", data={"username": "test_dashboard_perf@example.com", "password": "password123"})
        token = response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create N groups with 1 expense each
        N_GROUPS = 5
        for i in range(N_GROUPS):
            group = Group(name=f"Group {i}", created_by_id=user.id, default_currency="USD")
            db_session.add(group)
            db_session.commit()

            # Add user to group
            member = GroupMember(group_id=group.id, user_id=user.id)
            db_session.add(member)
            db_session.commit()

            # Add 1 expense
            expense = Expense(
                description=f"Expense in Group {i}",
                amount=1000, # 10.00
                currency="USD",
                payer_id=user.id,
                payer_is_guest=False,
                group_id=group.id,
                created_by_id=user.id,
                split_type="EQUAL",
                date="2024-01-01"
            )
            db_session.add(expense)
            db_session.commit()

            # Add split
            split = ExpenseSplit(
                expense_id=expense.id,
                user_id=user.id,
                is_guest=False,
                amount_owed=1000,
                percentage=100,
                shares=1
            )
            db_session.add(split)
            db_session.commit()

        # Reset query count
        query_counter.count = 0

        # Call the Dashboard Balances API
        response = client.get("/balances", headers=headers)
        assert response.status_code == 200

        print(f"Query count for {N_GROUPS} groups: {query_counter.count}")

        # After optimization, expected queries should be low (e.g., 10)
        # 1. Auth user
        # 2. User groups
        # 3. Batch fetch Groups
        # 4. Batch fetch Expenses
        # 5. Batch fetch Splits
        # 6. Batch fetch Managed Guests
        # 7. Batch fetch Managed Members
        # 8. Paid expenses (non-group)
        # 9. My splits (non-group)
        # 10. Batch fetch Users
        assert query_counter.count <= 15, f"Expected optimized queries (<= 15), but got {query_counter.count}"

    finally:
        app.dependency_overrides.pop(auth_rate_limiter, None)
