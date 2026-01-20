
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
def query_counter(db_session):
    class QueryCounter:
        def __init__(self):
            self.count = 0
        def __call__(self, conn, cursor, statement, parameters, context, executemany):
            self.count += 1

    counter = QueryCounter()
    event.listen(Engine, "before_cursor_execute", counter)
    yield counter
    event.remove(Engine, "before_cursor_execute", counter)

def test_get_balances_optimization(client: TestClient, db_session: Session, query_counter):
    # Create a user
    password = "password123"
    hashed_password = get_password_hash(password)
    user = User(email="user@example.com", hashed_password=hashed_password, full_name="Main User")
    db_session.add(user)
    db_session.commit()

    # Login to get token
    response = client.post("/token", data={"username": "user@example.com", "password": "password123"})
    assert response.status_code == 200
    token = response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create N groups
    N = 5
    for i in range(N):
        group = Group(name=f"Group {i}", created_by_id=user.id)
        db_session.add(group)
        db_session.commit()

        # Add user as member
        member = GroupMember(group_id=group.id, user_id=user.id)
        db_session.add(member)
        db_session.commit()

        # Create 2 expenses per group
        for j in range(2):
            expense = Expense(
                description=f"Expense {j} in Group {i}",
                amount=1000,
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
                amount_owed=1000,
                percentage=100,
                shares=1
            )
            db_session.add(split)
            db_session.commit()

    # Reset query count
    query_counter.count = 0

    # Call the API
    response = client.get("/balances", headers=headers)
    assert response.status_code == 200

    final_count = query_counter.count
    print(f"Query count for {N} groups: {final_count}")

    # Expected queries after optimization:
    # 1. user_memberships
    # 2. groups batch
    # 3. expenses batch
    # 4. splits batch
    # 5. managed_guests batch
    # 6. managed_members batch
    # 7. paid_expenses (1-to-1)
    # 8. my_splits (1-to-1)
    # 9. splits_for_paid_expenses
    # 10. expenses_for_my_splits
    # 11. users batch (for names)
    # Total ~ 11 queries regardless of N

    assert final_count <= 12, f"Expected <= 12 queries, got {final_count}. Optimization might be failing."
