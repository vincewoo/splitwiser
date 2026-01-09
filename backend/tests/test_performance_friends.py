
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from main import app
from database import Base, get_db
from models import User, Expense, ExpenseSplit, Friendship
from dependencies import get_current_user

# Setup in-memory DB for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(name="session")
def session_fixture():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(name="client")
def client_fixture(session):
    def override_get_db():
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]

class QueryCounter:
    def __init__(self):
        self.count = 0
        self.queries = []

    def __call__(self, conn, cursor, statement, parameters, context, executemany):
        self.count += 1
        self.queries.append(statement)

@pytest.fixture(name="query_counter")
def query_counter_fixture():
    counter = QueryCounter()
    event.listen(engine, "before_cursor_execute", counter)
    yield counter
    event.remove(engine, "before_cursor_execute", counter)

def create_user(session, email, name):
    user = User(email=email, full_name=name, hashed_password="hashed_password")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

def create_expense(session, payer_id, amount, description, splits):
    expense = Expense(
        description=description,
        amount=amount,
        currency="USD",
        date="2023-01-01",
        payer_id=payer_id,
        split_type="EQUAL"
    )
    session.add(expense)
    session.commit()
    session.refresh(expense)

    for split in splits:
        db_split = ExpenseSplit(
            expense_id=expense.id,
            user_id=split["user_id"],
            amount_owed=split["amount"],
            is_guest=False
        )
        session.add(db_split)
    session.commit()
    return expense

def test_get_friend_expenses_performance(client, session, query_counter):
    # Create two users
    user1 = create_user(session, "user1@example.com", "User One")
    user2 = create_user(session, "user2@example.com", "User Two")

    # Create friendship
    friendship = Friendship(user_id1=user1.id, user_id2=user2.id)
    session.add(friendship)
    session.commit()

    # Authenticate as user1
    app.dependency_overrides[get_current_user] = lambda: user1

    # Create 10 shared expenses
    # 5 paid by user1, 5 paid by user2
    for i in range(5):
        create_expense(session, user1.id, 2000, f"Expense A{i}", [
            {"user_id": user1.id, "amount": 1000},
            {"user_id": user2.id, "amount": 1000}
        ])
        create_expense(session, user2.id, 2000, f"Expense B{i}", [
            {"user_id": user1.id, "amount": 1000},
            {"user_id": user2.id, "amount": 1000}
        ])

    # Reset query counter before making the request
    query_counter.count = 0
    query_counter.queries = []

    # Call the endpoint
    response = client.get(f"/friends/{user2.id}/expenses")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 10

    print(f"Query count for 10 expenses: {query_counter.count}")

    # Analyze queries
    # Optimized expectation:
    # 1. Verify friendship
    # 2. Get friend user
    # 3. Get expenses IDs (subqueries)
    # 4. Get expenses list
    # 5. Batch fetch splits
    # 6. Batch fetch users
    # 7. Batch fetch groups (none here)
    # 8. Batch fetch items (none here)

    # Should be around 6-8 queries regardless of expense count
    assert query_counter.count < 10, f"Expected < 10 queries, got {query_counter.count}"

def test_get_friend_balance_performance(client, session, query_counter):
    # Create two users
    user1 = create_user(session, "user1@example.com", "User One")
    user2 = create_user(session, "user2@example.com", "User Two")

    # Create friendship
    friendship = Friendship(user_id1=user1.id, user_id2=user2.id)
    session.add(friendship)
    session.commit()

    # Authenticate as user1
    app.dependency_overrides[get_current_user] = lambda: user1

    # Create 10 shared expenses
    for i in range(10):
        create_expense(session, user1.id, 2000, f"Expense {i}", [
            {"user_id": user1.id, "amount": 1000},
            {"user_id": user2.id, "amount": 1000}
        ])

    # Reset query counter
    query_counter.count = 0
    query_counter.queries = []

    # Call the endpoint
    response = client.get(f"/friends/{user2.id}/balance")
    assert response.status_code == 200

    print(f"Query count for balance (10 expenses): {query_counter.count}")

    # Optimized expectation:
    # Base queries + 1 batch fetch splits
    # Should be around 5-7 queries
    assert query_counter.count < 10, f"Expected < 10 queries, got {query_counter.count}"
