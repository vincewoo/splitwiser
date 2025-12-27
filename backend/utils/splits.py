"""Split calculation utilities for itemized expenses."""

import schemas


def calculate_itemized_splits(items: list[schemas.ExpenseItemCreate]) -> list[schemas.ExpenseSplitBase]:
    """
    Calculate each person's share based on assigned items.

    Algorithm:
    1. Sum each person's assigned items (shared items split equally)
    2. Calculate subtotal for all non-tax/tip items
    3. Distribute tax/tip proportionally to each person's subtotal
    4. Return final splits
    """
    # Track each person's subtotal (key: "user_<id>" or "guest_<id>")
    person_subtotals = {}

    # Separate regular items from tax/tip
    regular_items = [i for i in items if not i.is_tax_tip]
    tax_tip_items = [i for i in items if i.is_tax_tip]

    # Process regular items
    for item in regular_items:
        if not item.assignments:
            continue

        # Equal split among assignees
        num_assignees = len(item.assignments)
        share_per_person = item.price // num_assignees
        remainder = item.price % num_assignees

        for idx, assignment in enumerate(item.assignments):
            key = f"{'guest' if assignment.is_guest else 'user'}_{assignment.user_id}"
            # First assignee gets the remainder cents
            amount = share_per_person + (1 if idx < remainder else 0)
            person_subtotals[key] = person_subtotals.get(key, 0) + amount

    # Calculate total of regular items for proportional distribution
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
                # Last person gets remainder to avoid rounding errors
                tax_tip_share = remaining_tax_tip
            else:
                tax_tip_share = int((subtotal / regular_total) * tax_tip_total)
                remaining_tax_tip -= tax_tip_share

            person_totals[key] += tax_tip_share

    # Convert to ExpenseSplitBase list
    splits = []
    for key, amount in person_totals.items():
        is_guest = key.startswith("guest_")
        user_id = int(key.split("_")[1])
        splits.append(schemas.ExpenseSplitBase(
            user_id=user_id,
            is_guest=is_guest,
            amount_owed=amount
        ))

    return splits
