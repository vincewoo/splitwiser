
import pytest
from sqlalchemy import event
from models import Group, GuestMember, Expense, ExpenseSplit, User, GroupMember, ExpenseItem, ExpenseItemAssignment
from auth import get_password_hash

def test_get_group_expenses_n_plus_one(client, db_session, auth_headers, test_user):
    # 1. Setup: Create a group
    group = Group(name="Performance Test Group", created_by_id=test_user.id)
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    # Add test_user as member of the group
    member = GroupMember(group_id=group.id, user_id=test_user.id)
    db_session.add(member)
    db_session.commit()

    # 2. Create another user who will claim the guest
    claimer = User(
        email="claimer@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Claimer User",
        is_active=True
    )
    db_session.add(claimer)
    db_session.commit()
    db_session.refresh(claimer)

    # 3. Create a guest and claim them
    guest = GuestMember(
        group_id=group.id,
        name="Guest 1",
        created_by_id=test_user.id,
        claimed_by_id=claimer.id
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    # 4. Create multiple expenses involving this claimed guest
    # If we have N+1 issue, we expect 1 query for users per expense (or split)
    num_expenses = 10
    for i in range(num_expenses):
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
        db_session.commit()
        db_session.refresh(expense)

        # Split between user and guest
        split1 = ExpenseSplit(
            expense_id=expense.id,
            user_id=test_user.id,
            is_guest=False,
            amount_owed=500
        )
        split2 = ExpenseSplit(
            expense_id=expense.id,
            user_id=guest.id,
            is_guest=True,
            amount_owed=500
        )
        db_session.add_all([split1, split2])
        db_session.commit()

    # 5. Measure queries
    query_count = 0

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1
        # print(f"Query: {statement}")

    event.listen(db_session.bind, "before_cursor_execute", count_queries)

    # Call the endpoint
    response = client.get(f"/groups/{group.id}/expenses", headers=auth_headers)
    assert response.status_code == 200

    event.remove(db_session.bind, "before_cursor_execute", count_queries)

    print(f"\nTotal queries with {num_expenses} expenses: {query_count}")

    # Expected queries without optimization:
    # 1. Get Group
    # 2. Verify Membership
    # 3. Get Expenses (batch)
    # 4. Get Splits (batch)
    # 5. Get Users (batch)
    # 6. Get Guests (batch)
    # 7+. Get User for Claimed Guest (N times, where N is number of guest splits)

    # We expect at least num_expenses extra queries if N+1 exists.
    # Base queries approx 6.
    # With 10 expenses, we expect ~16 queries if unoptimized.
    # If optimized, we expect constant queries (around 9).

    # After optimization, we expect queries to be significantly less than (num_expenses + base).
    # Ideally it should be <= 10.

    print(f"Query count: {query_count}")
    assert query_count <= 10, f"Query count too high: {query_count}. Expected constant number of queries."

def test_get_expense_itemized_n_plus_one(client, db_session, auth_headers, test_user):
    # 1. Setup: Create a group
    group = Group(name="Performance Test Group", created_by_id=test_user.id)
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    # Add test_user as member
    member = GroupMember(group_id=group.id, user_id=test_user.id)
    db_session.add(member)

    # Add another user
    other_user = User(
        email="other@example.com",
        hashed_password=get_password_hash("password"),
        full_name="Other User",
        is_active=True
    )
    db_session.add(other_user)
    db_session.commit()
    db_session.refresh(other_user)

    other_member = GroupMember(group_id=group.id, user_id=other_user.id)
    db_session.add(other_member)
    db_session.commit()

    # Create Itemized Expense
    expense = Expense(
        description="Itemized Expense",
        amount=1000,
        currency="USD",
        date="2024-01-01",
        payer_id=test_user.id,
        group_id=group.id,
        created_by_id=test_user.id,
        split_type="ITEMIZED"
    )
    db_session.add(expense)
    db_session.commit()
    db_session.refresh(expense)

    # Create split records (required for verification in get_expense)
    split1 = ExpenseSplit(
        expense_id=expense.id,
        user_id=test_user.id,
        is_guest=False,
        amount_owed=500
    )
    split2 = ExpenseSplit(
        expense_id=expense.id,
        user_id=other_user.id,
        is_guest=False,
        amount_owed=500
    )
    db_session.add_all([split1, split2])
    db_session.commit()

    # Create M Items
    num_items = 10
    for i in range(num_items):
        item = ExpenseItem(
            expense_id=expense.id,
            description=f"Item {i}",
            price=100,
            split_type="EQUAL"
        )
        db_session.add(item)
        db_session.commit()
        db_session.refresh(item)

        # Create assignments (User + Other User)
        assign1 = ExpenseItemAssignment(
            expense_item_id=item.id,
            user_id=test_user.id,
            is_guest=False
        )
        assign2 = ExpenseItemAssignment(
            expense_item_id=item.id,
            user_id=other_user.id,
            is_guest=False
        )
        db_session.add_all([assign1, assign2])

    db_session.commit()

    # 5. Measure queries
    query_count = 0

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1
        # print(f"Query: {statement}")

    event.listen(db_session.bind, "before_cursor_execute", count_queries)

    # Call the endpoint
    response = client.get(f"/expenses/{expense.id}", headers=auth_headers)
    assert response.status_code == 200

    event.remove(db_session.bind, "before_cursor_execute", count_queries)

    print(f"\nTotal queries with {num_items} items: {query_count}")

    # Expected unoptimized:
    # 1. Get Expense
    # 2. Get Splits (to check access)
    # 3. Check group member access
    # 4. Get Splits (again? or reused?)
    # 5. For each split (2): Get User
    # 6. Get Items
    # 7. For each item (10): Get Assignments
    # 8. For each assignment (20): Get User/Guest

    # Optimized:
    # 1. Get Expense
    # 2. Get Splits (to check access)
    # 3. Check group member access
    # 4. Get Splits (again? or reused?)
    # 5. For each split (2): Get User
    # 6. Get Items
    # 7. Get All Assignments (1 query)
    # 8. Get All Users (1 query)
    # 9. Get All Guests (1 query)

    # Total should be around 8-10.

    assert query_count <= 12, f"Query count too high: {query_count}. Expected <= 12 queries."
