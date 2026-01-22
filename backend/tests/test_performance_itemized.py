
import pytest
from sqlalchemy import event
from models import Group, GuestMember, Expense, ExpenseSplit, User, GroupMember, ExpenseItem, ExpenseItemAssignment
from auth import get_password_hash

def test_get_expense_itemized_n_plus_one(client, db_session, auth_headers, test_user):
    # 1. Setup: Create a group
    group = Group(name="Itemized Test Group", created_by_id=test_user.id)
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    # Add test_user as member
    member = GroupMember(group_id=group.id, user_id=test_user.id)
    db_session.add(member)
    db_session.commit()

    # Create another user
    other_user = User(
        email="other@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Other User",
        is_active=True
    )
    db_session.add(other_user)
    db_session.commit()
    db_session.refresh(other_user)

    # Create a guest
    guest = GuestMember(
        group_id=group.id,
        name="Guest 1",
        created_by_id=test_user.id
    )
    db_session.add(guest)
    db_session.commit()
    db_session.refresh(guest)

    # 2. Create an itemized expense
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

    # Add a split (needed for access validation)
    split = ExpenseSplit(
        expense_id=expense.id,
        user_id=test_user.id,
        is_guest=False,
        amount_owed=1000
    )
    db_session.add(split)
    db_session.commit()

    # 3. Add multiple items with assignments
    num_items = 10
    for i in range(num_items):
        item = ExpenseItem(
            expense_id=expense.id,
            description=f"Item {i}",
            price=100,
            is_tax_tip=False,
            split_type="EQUAL"
        )
        db_session.add(item)
        db_session.commit()
        db_session.refresh(item)

        # Assign to user and guest
        assignment1 = ExpenseItemAssignment(
            expense_item_id=item.id,
            user_id=other_user.id,
            is_guest=False
        )
        assignment2 = ExpenseItemAssignment(
            expense_item_id=item.id,
            user_id=guest.id,
            is_guest=True
        )
        db_session.add_all([assignment1, assignment2])
        db_session.commit()

    # 4. Measure queries
    query_count = 0

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        # print(f"Query: {statement}") # Uncomment to debug
        query_count += 1

    event.listen(db_session.bind, "before_cursor_execute", count_queries)

    # Call the endpoint
    response = client.get(f"/expenses/{expense.id}", headers=auth_headers)
    assert response.status_code == 200

    event.remove(db_session.bind, "before_cursor_execute", count_queries)

    print(f"\nTotal queries with {num_items} items: {query_count}")

    # Expected queries without optimization:
    # 1. Get Expense
    # 2. Get Splits (for access check)
    # 3. Get User/Guest for access check
    # 4. Get GroupMember (access check)
    # 5. Get Splits (again? or part of response)
    # 6. Get Users/Guests for splits
    # 7. Get ExpenseItems
    # 8+. Get Assignments for EACH item (num_items queries)
    # 9+. Get Users/Guests for EACH assignment (num_items * 2 queries)

    # With 10 items, each with 2 assignments.
    # Unoptimized: ~ 7 + 10 + 20 = 37+ queries.

    # Optimized goal: Constant queries (around 10-12 total).

    assert query_count < 20, f"Query count too high: {query_count}. Expected optimized queries."
