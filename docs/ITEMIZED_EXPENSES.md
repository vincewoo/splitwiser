# Itemized Expense Splitting

Split expenses by individual items with proportional tax/tip distribution (e.g., restaurant bills).

## Database Schema

**ExpenseItem Model:**
- `id` - Primary key
- `expense_id` - Parent expense
- `description` - Item name (e.g., "Burger")
- `price` - Item price in cents
- `is_tax_tip` - Boolean flag for tax/tip items

**ExpenseItemAssignment Model:**
- `id` - Primary key
- `expense_item_id` - Item being assigned
- `user_id` - Person assigned to item
- `is_guest` - Boolean flag for guest users

## Split Calculation Algorithm

**Steps:**
1. Sum each person's assigned items (shared items split equally among assignees)
2. Calculate subtotal for all non-tax/tip items
3. Distribute tax/tip proportionally based on each person's subtotal share
4. Return final splits with total amounts owed

**Tax/Tip Distribution:**
```
Person's tax/tip share = (Person's subtotal / Total subtotal) × Total tax/tip
```

**Rounding Handling:**
- Item splits: First assignee gets remainder cents
- Tax/tip: Last person gets remainder to ensure exact total

## Example

```
Restaurant bill:
├─ Burger ($12.99) → Alice, Bob
├─ Pizza ($15.99) → Bob, Charlie
├─ Salad ($8.99) → Alice
└─ Tax/Tip ($7.50) → Marked as tax/tip

Calculation:
1. Burger: Alice $6.50, Bob $6.49
2. Pizza: Bob $8.00, Charlie $7.99
3. Salad: Alice $8.99
4. Subtotals: Alice $15.49, Bob $14.49, Charlie $7.99 (Total: $37.97)
5. Tax/tip distribution:
   - Alice: ($15.49 / $37.97) × $7.50 = $3.06
   - Bob: ($14.49 / $37.97) × $7.50 = $2.86
   - Charlie: ($7.99 / $37.97) × $7.50 = $1.58
6. Final: Alice $18.55, Bob $17.35, Charlie $9.57
   Total: $45.47 ✓
```

## Frontend Implementation

**Components:**
- `ExpenseItemList.tsx` - Item list with assignment UI
  - Inline buttons for small groups (≤5 participants)
  - Modal selector for large groups
  - Visual validation (red border for unassigned items)
  - Assignment display: "You + 2 others" or specific names

**Custom Hook:**
- `useItemizedExpense.ts` - State management for items and assignments
  - `addManualItem()` - Add item from OCR or manual entry
  - `removeItem()` - Delete item
  - `toggleItemAssignment()` - Assign/unassign person to item
  - `taxTipAmount` - Separate field for tax/tip

## Validation Rules
1. All non-tax/tip items must have at least one assignee
2. Sum of splits must equal expense total (±1 cent tolerance)
3. Expense total auto-calculated from sum of items
4. All participants must exist in database

## API Usage

**Create Itemized Expense:**
```json
POST /expenses
{
  "description": "Restaurant",
  "amount": 4547,
  "currency": "USD",
  "date": "2025-12-26",
  "group_id": 1,
  "payer_id": 1,
  "split_type": "ITEMIZED",
  "items": [
    {
      "description": "Burger",
      "price": 1299,
      "is_tax_tip": false,
      "assignments": [
        {"user_id": 1, "is_guest": false},
        {"user_id": 2, "is_guest": false}
      ]
    },
    {
      "description": "Tax/Tip",
      "price": 750,
      "is_tax_tip": true,
      "assignments": []
    }
  ]
}
```
