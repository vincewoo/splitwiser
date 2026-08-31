"""Query-count guard for the balance-sheet export.

The export touches every expense, split, item and assignment in a group, which
makes it the heaviest read in the app and the easiest place to reintroduce an
N+1. The count must stay flat as the group grows: if these two assertions
diverge, something in the build is querying per row.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash
from models import (
    Expense,
    ExpenseItem,
    ExpenseItemAssignment,
    ExpenseSplit,
    Group,
    GroupMember,
    GuestMember,
    User,
)


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


def _build_group(db_session: Session, expense_count: int) -> tuple:
    user = User(
        email="perf@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Perf User",
    )
    db_session.add(user)
    db_session.commit()

    group = Group(name="Perf Group", created_by_id=user.id, default_currency="USD")
    db_session.add(group)
    db_session.commit()
    db_session.add(GroupMember(group_id=group.id, user_id=user.id))

    guest = GuestMember(group_id=group.id, name="Dave", created_by_id=user.id)
    db_session.add(guest)
    db_session.commit()

    for i in range(expense_count):
        expense = Expense(
            description=f"Expense {i}",
            amount=10000,
            currency="USD",
            date="2026-07-04",
            payer_id=user.id,
            group_id=group.id,
            created_by_id=user.id,
            split_type="ITEMIZED",
        )
        db_session.add(expense)
        db_session.commit()

        db_session.add_all([
            ExpenseSplit(expense_id=expense.id, user_id=user.id, amount_owed=5000),
            ExpenseSplit(
                expense_id=expense.id, user_id=guest.id, is_guest=True, amount_owed=5000
            ),
        ])

        item = ExpenseItem(
            expense_id=expense.id, description="Line", price=10000, split_type="EQUAL"
        )
        db_session.add(item)
        db_session.commit()
        db_session.add_all([
            ExpenseItemAssignment(expense_item_id=item.id, user_id=user.id),
            ExpenseItemAssignment(
                expense_item_id=item.id, user_id=guest.id, is_guest=True
            ),
        ])
        db_session.commit()

    return user, group


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': user.email})}"}


def test_query_count_does_not_grow_with_the_group(
    client: TestClient, db_session: Session, query_counter
):
    user, group = _build_group(db_session, expense_count=3)

    query_counter.count = 0
    small = client.get(f"/groups/{group.id}/balance_sheet.csv", headers=_headers(user))
    assert small.status_code == 200
    small_count = query_counter.count

    # Ten times the data, through the same code path.
    for i in range(27):
        expense = Expense(
            description=f"Extra {i}",
            amount=10000,
            currency="USD",
            date="2026-07-04",
            payer_id=user.id,
            group_id=group.id,
            created_by_id=user.id,
            split_type="EQUAL",
        )
        db_session.add(expense)
        db_session.commit()
        db_session.add(
            ExpenseSplit(expense_id=expense.id, user_id=user.id, amount_owed=10000)
        )
        db_session.commit()

    query_counter.count = 0
    large = client.get(f"/groups/{group.id}/balance_sheet.csv", headers=_headers(user))
    assert large.status_code == 200
    large_count = query_counter.count

    assert large_count == small_count, (
        f"query count grew with the data ({small_count} -> {large_count}); "
        "something is querying per expense"
    )
    assert small_count < 25, f"expected a handful of batched queries, got {small_count}"
