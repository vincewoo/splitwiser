
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from main import app
from database import Base, get_db
from models import User, Friendship
from dependencies import get_current_user

# Setup in-memory DB for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
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

def test_read_friends_n_plus_one(client, session, query_counter):
    # Create main user
    user_main = create_user(session, "main@example.com", "Main User")

    # Authenticate as main user
    app.dependency_overrides[get_current_user] = lambda: user_main

    # Create 5 friends
    for i in range(5):
        friend = create_user(session, f"friend{i}@example.com", f"Friend {i}")
        friendship = Friendship(user_id1=user_main.id, user_id2=friend.id)
        session.add(friendship)
    session.commit()

    # Reset query counter
    query_counter.count = 0
    query_counter.queries = []

    # Call the endpoint
    response = client.get("/friends")
    assert response.status_code == 200
    friends = response.json()
    assert len(friends) == 5

    print(f"Query count for 5 friends: {query_counter.count}")

    # Current implementation: 1 query for friendships + 5 queries for users = 6 queries.
    # We want it to be constant (e.g. 1 or 2 queries).

    # If N+1 exists, count will be >= 1 + 5 = 6.
    # If optimized, count should be ~2 (1 for friendships, 1 for users batch).

    # Asserting success (1 auth + 1 friendships + 1 batch friends)
    assert query_counter.count <= 3, f"N+1 detected! Expected <= 3 queries, got {query_counter.count}"
