
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from main import app
from models import User, Group, GroupMember, GuestMember
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

def test_get_group_performance(client: TestClient, db_session: Session, query_counter):
    # Create a user
    password = "password123"
    hashed_password = get_password_hash(password)
    user = User(email="test@example.com", hashed_password=hashed_password, full_name="Test User")
    db_session.add(user)
    db_session.commit()

    # Authenticate
    response = client.post("/token", data={"username": "test@example.com", "password": password})
    assert response.status_code == 200
    token = response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create a group
    group = Group(name="Test Group", created_by_id=user.id)
    db_session.add(group)
    db_session.commit()

    # Add the creator as a member
    member = GroupMember(group_id=group.id, user_id=user.id)
    db_session.add(member)
    db_session.commit()

    # Create N managed members (simulating N+1 problem)
    N = 10
    managers = []
    for i in range(N):
        manager = User(email=f"manager{i}@example.com", hashed_password=hashed_password, full_name=f"Manager {i}")
        db_session.add(manager)
        managers.append(manager)
    db_session.commit()

    # Add members managed by these users
    for i, manager in enumerate(managers):
        managed_user = User(email=f"managed{i}@example.com", hashed_password=hashed_password, full_name=f"Managed {i}")
        db_session.add(managed_user)
        db_session.commit()

        gm = GroupMember(
            group_id=group.id,
            user_id=managed_user.id,
            managed_by_id=manager.id,
            managed_by_type='user'
        )
        db_session.add(gm)

    db_session.commit()

    # Reset query count
    query_counter.count = 0

    # Call the API
    response = client.get(f"/groups/{group.id}", headers=headers)
    assert response.status_code == 200

    print(f"Query count for {N} managed members: {query_counter.count}")

    # Expected queries:
    # 1. Get current user (Auth)
    # 2. Get group (get_group_or_404)
    # 3. Verify membership
    # 4. Get members join user
    # 5. Get guests
    # 6. Batch fetch manager users
    # 7. Batch fetch manager guests (even if empty, likely executed if logic is simple)
    # Total ~7-8 queries max, independent of N.

    # Before optimization, this would be > N + 5.

    assert query_counter.count < 10, f"Query count too high: {query_counter.count}. Should be constant and < 10."
