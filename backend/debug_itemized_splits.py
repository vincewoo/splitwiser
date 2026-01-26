#!/usr/bin/env python3
"""
Debug script to compare stored ExpenseSplit amounts vs recalculated amounts from items.

Usage:
  fly ssh console -a <app-name>
  cd /app
  python debug_itemized_splits.py [--group-id N] [--expense-id N] [--user-id N]

This will help identify discrepancies between stored splits and what the items calculate to.
"""

import argparse
import sys
from sqlalchemy.orm import Session

# Add backend to path if needed
sys.path.insert(0, '/app')

from database import SessionLocal
import models


def calculate_splits_from_items(db: Session, expense_id: int) -> dict:
    """Recalculate what splits should be based on stored items."""
    items = db.query(models.ExpenseItem).filter(
        models.ExpenseItem.expense_id == expense_id
    ).all()

    if not items:
        return {}

    # Track each person's subtotal
    person_subtotals = {}  # key: "user_<id>" or "guest_<id>"

    regular_items = [i for i in items if not i.is_tax_tip]
    tax_tip_items = [i for i in items if i.is_tax_tip]

    item_breakdown = []  # For debugging

    for item in regular_items:
        assignments = db.query(models.ExpenseItemAssignment).filter(
            models.ExpenseItemAssignment.expense_item_id == item.id
        ).all()

        if not assignments:
            item_breakdown.append({
                'item': item.description,
                'price': item.price,
                'assignments': 'NONE (unassigned)'
            })
            continue

        num_assignees = len(assignments)
        share_per_person = item.price // num_assignees
        remainder = item.price % num_assignees

        assignment_details = []
        for idx, assignment in enumerate(assignments):
            key = f"{'guest' if assignment.is_guest else 'user'}_{assignment.user_id}"
            amount = share_per_person + (1 if idx < remainder else 0)
            person_subtotals[key] = person_subtotals.get(key, 0) + amount
            assignment_details.append(f"{key}: {amount}")

        item_breakdown.append({
            'item': item.description,
            'price': item.price,
            'assignments': assignment_details
        })

    # Calculate totals
    regular_total = sum(person_subtotals.values())
    tax_tip_total = sum(i.price for i in tax_tip_items)

    # Distribute tax/tip proportionally
    person_totals = {}
    remaining_tax_tip = tax_tip_total

    sorted_keys = sorted(person_subtotals.keys())
    for idx, key in enumerate(sorted_keys):
        subtotal = person_subtotals[key]
        person_totals[key] = subtotal

        if regular_total > 0 and tax_tip_total > 0:
            if idx == len(sorted_keys) - 1:
                tax_tip_share = remaining_tax_tip
            else:
                tax_tip_share = int((subtotal / regular_total) * tax_tip_total)
                remaining_tax_tip -= tax_tip_share

            person_totals[key] += tax_tip_share

    return {
        'person_totals': person_totals,
        'person_subtotals': person_subtotals,
        'regular_total': regular_total,
        'tax_tip_total': tax_tip_total,
        'item_breakdown': item_breakdown
    }


def debug_expense(db: Session, expense: models.Expense):
    """Debug a single expense."""
    print(f"\n{'='*60}")
    print(f"Expense ID: {expense.id}")
    print(f"Description: {expense.description}")
    print(f"Amount: {expense.amount} {expense.currency}")
    print(f"Split Type: {expense.split_type}")
    print(f"Payer: {'guest' if expense.payer_is_guest else 'user'}_{expense.payer_id}")

    # Get stored splits
    stored_splits = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.expense_id == expense.id
    ).all()

    print(f"\n--- Stored Splits ---")
    stored_totals = {}
    for split in stored_splits:
        key = f"{'guest' if split.is_guest else 'user'}_{split.user_id}"
        stored_totals[key] = split.amount_owed
        print(f"  {key}: {split.amount_owed}")

    stored_sum = sum(stored_totals.values())
    print(f"  TOTAL: {stored_sum}")

    if expense.split_type != "ITEMIZED":
        print("  (Not an itemized expense, skipping item comparison)")
        return False

    # Recalculate from items
    calc = calculate_splits_from_items(db, expense.id)

    print(f"\n--- Item Breakdown ---")
    for item in calc['item_breakdown']:
        print(f"  {item['item']} ({item['price']}): {item['assignments']}")

    print(f"\n--- Recalculated from Items ---")
    print(f"  Regular subtotal: {calc['regular_total']}")
    print(f"  Tax/tip total: {calc['tax_tip_total']}")
    print(f"  Person subtotals (before tax/tip): {calc['person_subtotals']}")
    print(f"  Person totals (after tax/tip): {calc['person_totals']}")

    calc_sum = sum(calc['person_totals'].values())
    print(f"  TOTAL: {calc_sum}")

    # Compare
    print(f"\n--- Comparison ---")
    has_discrepancy = False

    all_keys = set(stored_totals.keys()) | set(calc['person_totals'].keys())
    for key in sorted(all_keys):
        stored = stored_totals.get(key, 0)
        calculated = calc['person_totals'].get(key, 0)
        diff = stored - calculated

        if diff != 0:
            has_discrepancy = True
            print(f"  ❌ {key}: stored={stored}, calculated={calculated}, DIFF={diff}")
        else:
            print(f"  ✓ {key}: {stored}")

    if stored_sum != calc_sum:
        print(f"\n  ❌ TOTAL MISMATCH: stored={stored_sum}, calculated={calc_sum}, DIFF={stored_sum - calc_sum}")
        has_discrepancy = True

    if stored_sum != expense.amount:
        print(f"\n  ⚠️  Stored splits ({stored_sum}) != expense amount ({expense.amount})")
        print(f"      This may indicate unassigned items absorbed by payer")

    return has_discrepancy


def main():
    parser = argparse.ArgumentParser(description='Debug itemized expense splits')
    parser.add_argument('--group-id', type=int, help='Filter by group ID')
    parser.add_argument('--expense-id', type=int, help='Debug specific expense ID')
    parser.add_argument('--user-id', type=int, help='Filter expenses involving this user ID')
    parser.add_argument('--only-discrepancies', action='store_true', help='Only show expenses with discrepancies')
    args = parser.parse_args()

    db = SessionLocal()

    try:
        query = db.query(models.Expense)

        if args.expense_id:
            query = query.filter(models.Expense.id == args.expense_id)
        elif args.group_id:
            query = query.filter(models.Expense.group_id == args.group_id)

        # Only look at itemized expenses unless specific expense requested
        if not args.expense_id:
            query = query.filter(models.Expense.split_type == "ITEMIZED")

        expenses = query.all()

        if args.user_id:
            # Filter to expenses where user is involved
            filtered = []
            for exp in expenses:
                splits = db.query(models.ExpenseSplit).filter(
                    models.ExpenseSplit.expense_id == exp.id,
                    models.ExpenseSplit.user_id == args.user_id,
                    models.ExpenseSplit.is_guest == False
                ).first()
                if splits or (exp.payer_id == args.user_id and not exp.payer_is_guest):
                    filtered.append(exp)
            expenses = filtered

        print(f"Found {len(expenses)} expense(s) to analyze")

        discrepancy_count = 0
        for expense in expenses:
            has_discrepancy = debug_expense(db, expense)
            if has_discrepancy:
                discrepancy_count += 1
            elif args.only_discrepancies:
                continue

        print(f"\n{'='*60}")
        print(f"Summary: {discrepancy_count} expense(s) with discrepancies out of {len(expenses)}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
