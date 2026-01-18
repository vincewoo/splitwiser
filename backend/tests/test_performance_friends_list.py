
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
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
            # Do NOT close session here if it's reused, but here we just yield it.
            # The session fixture closes it.
            pass

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
    main_user = create_user(session, "main@example.com", "Main User")

    # Authenticate as main user
    app.dependency_overrides[get_current_user] = lambda: main_user

    # Create 20 friends
    friend_count = 20
    for i in range(friend_count):
        friend = create_user(session, f"friend{i}@example.com", f"Friend {i}")
        # Create friendship
        friendship = Friendship(user_id1=main_user.id, user_id2=friend.id)
        session.add(friendship)

    session.commit()

    # Reset query counter before making the request
    query_counter.count = 0
    query_counter.queries = []

    # Call the endpoint
    response = client.get("/friends")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == friend_count

    print(f"Query count for {friend_count} friends: {query_counter.count}")

    # With N+1, we expect 1 query for friendships + 20 queries for users = 21 queries.
    # The authenticated user dependency might add 1 query (get_current_user).

    # We assert strictly < 5 to confirm the N+1 is fixed.
    assert query_counter.count < 5, f"Expected < 5 queries (Optimized), got {query_counter.count}"
