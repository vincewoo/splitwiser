
import pytest
from sqlalchemy import event
from models import Group, GuestMember, Expense, ExpenseSplit, User, GroupMember, ExpenseItem, ExpenseItemAssignment
from auth import get_password_hash

def test_get_expense_itemized_n_plus_one(client, db_session, auth_headers, test_user):
    """
    Test N+1 query issue when fetching an itemized expense with many items and assignments.
    """
    # 1. Setup: Create a group
    group = Group(name="Performance Test Group", created_by_id=test_user.id)
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    # Add test_user as member
    member = GroupMember(group_id=group.id, user_id=test_user.id)
    db_session.add(member)
    db_session.commit()

    # 2. Create another user and a guest
    other_user = User(
        email="other@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Other User",
        is_active=True
    )
    db_session.add(other_user)

    guest = GuestMember(
        group_id=group.id,
        name="Guest 1",
        created_by_id=test_user.id
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(other_user)
    db_session.refresh(guest)

    # Add other_user to group
    member2 = GroupMember(group_id=group.id, user_id=other_user.id)
    db_session.add(member2)
    db_session.commit()

    # 3. Create one itemized expense
    expense = Expense(
        description="Big Itemized Expense",
        amount=20000,
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

    # 4. Add many items (e.g., 20)
    num_items = 20
    items = []
    for i in range(num_items):
        item = ExpenseItem(
            expense_id=expense.id,
            description=f"Item {i}",
            price=1000,
            is_tax_tip=False,
            split_type="EQUAL"
        )
        db_session.add(item)
        items.append(item)
    db_session.commit()

    # Refresh items to get IDs
    for item in items:
        db_session.refresh(item)

    # 5. Add assignments for each item (1 user + 1 guest)
    for item in items:
        assign1 = ExpenseItemAssignment(
            expense_item_id=item.id,
            user_id=other_user.id,
            is_guest=False
        )
        assign2 = ExpenseItemAssignment(
            expense_item_id=item.id,
            user_id=guest.id,
            is_guest=True
        )
        db_session.add_all([assign1, assign2])
    db_session.commit()

    # Create splits (required for expense validity)
    split1 = ExpenseSplit(expense_id=expense.id, user_id=test_user.id, is_guest=False, amount_owed=0) # payer
    split2 = ExpenseSplit(expense_id=expense.id, user_id=other_user.id, is_guest=False, amount_owed=10000)
    split3 = ExpenseSplit(expense_id=expense.id, user_id=guest.id, is_guest=True, amount_owed=10000)
    db_session.add_all([split1, split2, split3])
    db_session.commit()

    # 6. Measure queries
    query_count = 0

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1
        # print(f"Query: {statement}")

    event.listen(db_session.bind, "before_cursor_execute", count_queries)

    # Call the endpoint
    response = client.get(f"/expenses/{expense.id}", headers=auth_headers)

    event.remove(db_session.bind, "before_cursor_execute", count_queries)

    print(f"\nResponse status: {response.status_code}")
    if response.status_code != 200:
        print(f"Response: {response.json()}")

    assert response.status_code == 200

    print(f"\nTotal queries with {num_items} items: {query_count}")

    # Expected unoptimized:
    # ~ 4 base queries (Expense, Splits, Auth, GroupMember)
    # + 1 query for Items
    # + num_items * (1 query for assignments + 2 queries for users/guests)
    # 5 + 20 * 3 = 65 queries approx.

    # Expected optimized:
    # ~ 4 base queries
    # + 1 for Items
    # + 1 for Assignments (batch)
    # + 1 for Users (batch)
    # + 1 for Guests (batch)
    # ~ 8 queries total.

    # Allow some buffer, but it should be much less than 65.
    assert query_count <= 15, f"Query count too high: {query_count}. Expected constant number of queries."
