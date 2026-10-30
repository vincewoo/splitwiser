# Closed tabs list + editable tab expenses

## Problems

1. Only open tabs are listed (`useOpenTabs` → `GET /tabs?status_filter=open`). A
   closed tab whose expense was deleted, or that closed to an off-app payer, has
   no way back. (Clinton's Golfzon case.)
2. `close_tab` writes an `ITEMIZED` expense with splits but **no
   `expense_items`**. Editing it in `ExpenseDetailModal` starts from zero items,
   so the total is $0 and the save is rejected ("Items required") or wipes the
   shares. Non-owners never see the item breakdown either.

## Plan

### Backend
- `close_tab` also writes the tab's lines as `ExpenseItem`s with
  `ExpenseItemAssignment`s: claimers by `user_id`, anonymous claimers by their
  new `expense_guest_id`; an unclaimed line goes to everyone (same as the
  share computation). Tax and tip become `is_tax_tip` lines. Splits keep the
  tab's own share computation (`compute_tab_shares`), so a close is unchanged
  for everyone; a later edit re-allocates with `allocate_items` (cent-level
  rounding may differ).
- `TabOut` gains `closed_at`.
- Migration `backfill_tab_expense_items.py` (idempotent, `--dry-run`), added to
  `start.sh`: for closed tabs whose expense still exists and has no items, write
  the same items from the tab. Anonymous seats map to the expense's guest of the
  same name; a tab that cannot be mapped fully is skipped and reported.

### Frontend
- `useOpenTabs` → `useTabs`: one `GET /tabs`, returns `openTabs` and
  `closedTabs`.
- `OpenTabsList` → `TabList`, rows for closed tabs show when it closed and what
  became of it.
- New `/tabs` page (`TabsPage`): open then closed tabs. Linked from Activity
  ("Past tabs").
- Closed tab board footer: say where it went — balances, settled off-app, or
  the expense was deleted.

### Tests
- Backend: close writes items/assignments (users, anonymous, orphan, tax/tip);
  an edit round-trip of a closed tab's expense keeps amounts; migration
  backfill + idempotency + skip.
- Frontend: `useTabs`, `TabList` closed rows, `TabsPage`, Activity link.

### Docs
- CLAUDE.md, `docs/TABS.md`, migrations README.
