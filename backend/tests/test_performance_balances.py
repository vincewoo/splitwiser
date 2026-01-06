
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

def test_public_group_balances_performance(client: TestClient, db_session: Session, query_counter):
    # Create a user
    password = "password123"
    hashed_password = get_password_hash(password)
    user = User(email="test@example.com", hashed_password=hashed_password, full_name="Test User")
    db_session.add(user)
    db_session.commit()

    # Create a group with share link
    import uuid
    share_link_id = str(uuid.uuid4())
    group = Group(name="Public Group", created_by_id=user.id, share_link_id=share_link_id, is_public=True)
    db_session.add(group)
    db_session.commit()

    # Add the creator as a member
    member = GroupMember(group_id=group.id, user_id=user.id)
    db_session.add(member)
    db_session.commit()

    # Create N expenses
    N = 10
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
    response = client.get(f"/groups/public/{share_link_id}/balances")
    assert response.status_code == 200

    print(f"Query count for {N} expenses: {query_counter.count}")

    # Analyze expected queries with N+1 issue:
    # 1. Get group by share_link
    # 2. Get all expenses in group
    # 3. For each expense, get splits (N queries)
    # 4. Get managed guests
    # 5. Get managed members
    # 6. For each user in result, get user details (potentially N queries if multiple users)

    # Total roughly N + 5 + K (where K is number of participants)

    # With N=10, we expect roughly 15+ queries.

    # After optimization:
    # 1. Get group
    # 2. Get all expenses
    # 3. Batch fetch all splits
    # 4. Get managed guests
    # 5. Get managed members
    # 6. Batch fetch users/guests
    # Total ~6-7 queries.
