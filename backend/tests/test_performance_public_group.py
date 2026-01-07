
import pytest
from sqlalchemy import event
from models import Group, GuestMember, Expense, ExpenseSplit, ExpenseItem, ExpenseItemAssignment, User, GroupMember
from auth import get_password_hash
import uuid

def test_get_public_expense_detail_n_plus_one(client, db_session, auth_headers, test_user):
    # 1. Setup: Create a group and make it public
    group = Group(
        name="Performance Test Public Group",
        created_by_id=test_user.id,
        is_public=True,
        share_link_id=str(uuid.uuid4())
    )
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    # Add test_user as member
    member = GroupMember(group_id=group.id, user_id=test_user.id)
    db_session.add(member)

    # Create 5 guests
    guests = []
    for i in range(5):
        g = GuestMember(group_id=group.id, name=f"Guest {i}", created_by_id=test_user.id)
        db_session.add(g)
        guests.append(g)

    db_session.commit()
    for g in guests:
        db_session.refresh(g)

    # 2. Create an ITEMIZED expense
    expense = Expense(
        description="Big Dinner",
        amount=5000, # $50.00
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

    # Create 5 items, each assigned to a different guest and the user
    items = []
    for i in range(5):
        item = ExpenseItem(
            expense_id=expense.id,
            description=f"Item {i}",
            price=1000,
            is_tax_tip=False
        )
        db_session.add(item)
        items.append(item)

    db_session.commit()
    for item in items:
        db_session.refresh(item)

        # Assign to user
        a1 = ExpenseItemAssignment(expense_item_id=item.id, user_id=test_user.id, is_guest=False)
        # Assign to guest i
        a2 = ExpenseItemAssignment(expense_item_id=item.id, user_id=guests[i].id, is_guest=True)
        db_session.add_all([a1, a2])

    # Also add splits (required for validity, though public view might recalculate or use stored)
    # Just adding dummy splits to satisfy constraints if any
    for i in range(5):
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
        # print(f"Query: {statement}")

    event.listen(db_session.bind, "before_cursor_execute", count_queries)

    # Call the public endpoint
    response = client.get(f"/groups/public/{group.share_link_id}/expenses/{expense.id}")

    event.remove(db_session.bind, "before_cursor_execute", count_queries)

    assert response.status_code == 200

    print(f"\nTotal queries for expense detail: {query_count}")
    # for q in queries:
    #     print(q)

    # Expected Analysis (Unoptimized):
    # 1. Get Group by share_link_id
    # 2. Get Expense
    # 3. Get Splits
    # 4. For each split (10 splits total: 5 items * 2 people? No, logic above added 10 splits):
    #    - 10 queries to fetch User/Guest name.
    # 5. Get Items (1 query)
    # 6. Loop 5 items:
    #    - Get Assignments (1 query per item = 5 queries)
    #    - Loop assignments (2 per item = 10 total):
    #      - Get User/Guest (1 query per assignment = 10 queries)

    # Total estimated: ~3 + 10 + 1 + 5 + 10 = ~29 queries.

    # If Optimized:
    # 1. Get Group
    # 2. Get Expense
    # 3. Get Splits
    # 4. Get Items
    # 5. Get Assignments (batch)
    # 6. Get Users (batch)
    # 7. Get Guests (batch)

    # Total estimated: ~7 queries.

    assert query_count <= 10, f"Too many queries: {query_count}. Target <= 10."
