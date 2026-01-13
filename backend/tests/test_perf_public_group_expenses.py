
import pytest
from sqlalchemy import event
from models import Group, GuestMember, Expense, ExpenseSplit, User, GroupMember
from auth import get_password_hash
import uuid

def test_get_public_group_expenses_n_plus_one(client, db_session, test_user):
    # 1. Setup: Create a group and make it public
    group = Group(
        name="Performance List Public Group",
        created_by_id=test_user.id,
        is_public=True,
        share_link_id=str(uuid.uuid4())
    )
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    # Create another user who claims a guest
    claimer_user = User(
        email="claimer@example.com",
        hashed_password="hash",
        full_name="Claimer User",
        is_active=True
    )
    db_session.add(claimer_user)
    db_session.commit()
    db_session.refresh(claimer_user)

    # Create 10 guests, all claimed by claimer_user
    guests = []
    for i in range(10):
        g = GuestMember(
            group_id=group.id,
            name=f"Guest {i}",
            created_by_id=test_user.id,
            claimed_by_id=claimer_user.id
        )
        db_session.add(g)
        guests.append(g)

    db_session.commit()
    for g in guests:
        db_session.refresh(g)

    # Create 10 expenses, one for each guest
    expenses = []
    for i in range(10):
        expense = Expense(
            description=f"Expense {i}",
            amount=1000,
            currency="USD",
            date="2024-01-01",
            payer_id=test_user.id,
            group_id=group.id,
            created_by_id=test_user.id
        )
        db_session.add(expense)
        expenses.append(expense)

    db_session.commit()
    for i, expense in enumerate(expenses):
        db_session.refresh(expense)
        # Split between payer and the guest
        s1 = ExpenseSplit(expense_id=expense.id, user_id=test_user.id, is_guest=False, amount_owed=500)
        s2 = ExpenseSplit(expense_id=expense.id, user_id=guests[i].id, is_guest=True, amount_owed=500)
        db_session.add_all([s1, s2])

    db_session.commit()

    # 3. Measure queries
    query_count = 0
    queries = []

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1
        queries.append(statement)

    event.listen(db_session.bind, "before_cursor_execute", count_queries)

    # Call the public endpoint
    response = client.get(f"/groups/public/{group.share_link_id}/expenses")

    event.remove(db_session.bind, "before_cursor_execute", count_queries)

    assert response.status_code == 200, response.text

    print(f"\nTotal queries for expenses list: {query_count}")

    # Expected Analysis (Unoptimized):
    # 1. Get Group
    # 2. Get Expenses
    # 3. Get Splits (batch)
    # 4. Get Users (batch for test_user)
    # 5. Get Guests (batch for 10 guests)
    # 6. Loop over 10 expenses:
    #    - Loop over splits. Guest split calls get_guest_display_name(guest, db)
    #    - Guest is claimed -> query User table.
    #    - 10 extra queries.

    # Total = ~5 base + 10 N+1 = ~15 queries.

    # If Optimized:
    # 1. Get Group
    # 2. Get Expenses
    # 3. Get Splits
    # 4. Get Users
    # 5. Get Guests
    # 6. Get Claimed Users (batch) -> New step!

    # Total = ~6 queries.

    # Asserting < 10 ensures we killed the N+1
    assert query_count < 10, f"Too many queries: {query_count}. Target < 10."
