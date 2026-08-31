---
title: CSV balance sheet export for a group
type: feat
status: implemented
date: 2026-08-30
origin: conversation (design request)
---

# CSV balance sheet export for a group

## Overview

Add a per-group **balance sheet export**: a single `text/csv` download that shows the
whole settlement calculation as an auditable chain, from individual expense lines
through to the simplified "who pays whom" transactions. Itemized expenses appear as
child item rows grouped under their parent expense, so a member can see the receipt
line that produced their share.

Endpoint: `GET /groups/{group_id}/balance_sheet.csv` (authenticated, members only).
Entry point: a "Export balance sheet (CSV)" action in the group's Balances section.

## Problem Frame

Members can see *what* they owe (`/groups/{id}/balances`, `/simplify_debts/{id}`) but
not *why*. Four transformations happen between an expense and the number on screen, and
none of them is visible in the UI:

1. **Itemized allocation** — `utils/splits.py` splits each receipt line across its
   assignees, then spreads tax/tip proportionally to each person's subtotal, with
   remainder cents landing on the last sorted key. Only the *totals* are persisted
   (`ExpenseSplit.amount_owed`); the per-item per-person amounts are recomputed on
   demand and shown nowhere.
2. **Currency conversion** — a two-leg hybrid: expense currency → USD at
   `Expense.exchange_rate` (the historical rate captured at creation), then USD →
   target at current static/Frankfurter rates (`utils/balances.py`,
   `calculate_net_balances`). Two expenses in the same currency on different dates
   convert differently, which looks like a bug to users.
3. **Management folding** — managed guests/members are folded into their manager, and
   claimed guests are re-attributed to the claiming user
   (`_managed_key_for_guest`, `_fold_managed_relationships`). A person's row can
   therefore include amounts they never personally consumed.
4. **Debt simplification** — the greedy debtor/creditor match in
   `routers/balances.py::simplify_debts` produces transactions between people who
   never shared an expense. This is the single biggest source of "the math is wrong"
   reports.

The export makes all four steps legible in the order they happen.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| File shape | **Sectioned audit report**, one CSV | The complaint is "I don't understand the calculation", which is a narrative, not a pivot table. Sections read top-to-bottom as the four transformations above. |
| Item allocation source | **Recompute, and reconcile against stored splits** | Per-item shares aren't persisted, so they must be recomputed; but `ExpenseSplit` stays authoritative for balances. Where the two disagree, print a `RECONCILIATION` line rather than silently picking one. |
| Money columns | Integer `amount_cents` **and** decimal `amount` (always 2dp) | `format_currency` emits symbols and drops decimals for JPY — fine for UI, hostile to a spreadsheet. Currency goes in its own column. |
| Scope | One group per file | Matches the endpoint's authorization boundary (`verify_group_membership`). A cross-group export is a separate feature. |
| Settlements | Included, in their own section | `calculate_net_balances` does **not** filter `is_settlement` (unlike `utils/summary.py`, which does). The sheet must match balances, so settlements count — and are called out so the difference from the Summary section is explicable. |

## CSV Structure

Eleven sections, each preceded by a blank line and a `# SECTION: <name>` comment line,
then its own header row. A leading `section` column on every data row keeps the file
machine-filterable despite being sectioned.

### 0. `META`

```
# SECTION: META
section,key,value
META,generated_at,2026-08-30T18:04:11Z
META,group_id,42
META,group_name,Tahoe Trip
META,display_currency,USD
META,generated_for,vince@example.com
META,rate_note,Some expenses had no stored historical rate; current rates were used.
META,schema_version,1
```

`rate_note` is emitted only when at least one non-USD expense had a null
`exchange_rate` — the same condition `utils/summary.py` reports as
`has_synthesized_historical_rate`.

### 1. `EXPENSE` / `ITEM` / `ITEM_SHARE` / `SPLIT` / `RECONCILIATION`

The core section, ordered by expense date then id. Each expense emits:

- one `EXPENSE` row (description, date, payer, currency, total, split type, rate);
- for `ITEMIZED` expenses, one `ITEM` row per `ExpenseItem` (including tax/tip lines),
  and under each, one `ITEM_SHARE` row per assignee with the recomputed allocation;
- one `SPLIT` row per `ExpenseSplit` — the stored, authoritative amount;
- a `RECONCILIATION` row **only** when `Σ ITEM_SHARE` for a person ≠ that person's
  stored `SPLIT`.

Columns are elided below for width; the real header carries the full identity
triple (`person`, `person_id`, `person_type`) described under
[Guests and identity](#guests-and-identity), plus `payer_type` alongside `payer`.

```
# SECTION: EXPENSES
section,expense_id,expense_description,date,payer,payer_type,item_id,item_description,is_tax_tip,person,person_id,person_type,split_type,currency,amount_cents,amount,exchange_rate,converted_cents,converted_amount,note
EXPENSE,118,Dinner at Nopa,2026-07-04,Vince,user,,,,,,,ITEMIZED,USD,14200,142.00,1.0,14200,142.00,
ITEM,118,Dinner at Nopa,2026-07-04,Vince,user,501,Roast chicken,false,,,,EQUAL,USD,3800,38.00,,,,shared by 2
ITEM_SHARE,118,Dinner at Nopa,2026-07-04,Vince,user,501,Roast chicken,false,Vince,7,user,,USD,1900,19.00,,,,
ITEM_SHARE,118,Dinner at Nopa,2026-07-04,Vince,user,501,Roast chicken,false,Dave,7,group_guest,,USD,1900,19.00,,,,
ITEM,118,Dinner at Nopa,2026-07-04,Vince,user,507,Tax + tip,true,,,,,USD,2200,22.00,,,,spread proportionally
ITEM_SHARE,118,Dinner at Nopa,2026-07-04,Vince,user,507,Tax + tip,true,Dave,7,group_guest,,USD,1046,10.46,,,,47.5% of subtotal
SPLIT,118,Dinner at Nopa,2026-07-04,Vince,user,,,,Dave,7,group_guest,,USD,7146,71.46,1.0,7146,71.46,stored
RECONCILIATION,118,Dinner at Nopa,2026-07-04,Vince,user,,,,Dave,7,group_guest,,USD,1,0.01,,,,stored split exceeds item shares by 0.01
```

The `Vince,7,user` / `Dave,7,group_guest` pair in that example is not contrived —
`ExpenseSplit.user_id` means "user id" or "guest id" depending on `is_guest`, so the
two namespaces overlap freely.

Non-itemized expenses skip `ITEM`/`ITEM_SHARE` entirely and carry their split-type
inputs (`percentage`, `shares`) in the `note` column of the `SPLIT` row — e.g.
`note=30% of 142.00` or `note=2 of 5 shares`.

Rounding is where trust is won or lost, so the `note` column is doing real work here.
`calculate_itemized_splits` gives remainder cents to the *first* assignee on equal
splits and the *last sorted key* on percent/shares and on tax/tip. Both get an explicit
note (`+0.01 rounding`), because an unexplained one-cent asymmetry is exactly the kind
of thing that generates a support message.

### 2. `CONSUMPTION`

Per person, Σ of their stored splits, per currency and converted. This is the
"what you consumed" total, before anyone's payments are considered.

### 3. `PAID`

Per person, Σ of the splits on expenses they paid for — the credit side. Keeping
consumption and paid in separate sections (rather than one net column) is what makes
the next section's arithmetic checkable by eye.

### 4. `CONVERSION`

One row per (expense currency, target currency) pair actually used, with the historical
leg, the current leg, and how many expenses used each. Emitted only for multi-currency
groups. This is where a user can see that two USD-denominated EUR trips converted at
different rates and why.

### 5. `MANAGEMENT`

One row per folded relationship: source person, manager, amount moved, currency, reason
(`claimed guest`, `managed guest`, `managed member`). Cycles that
`_detect_managed_cycles` refuses to fold get a row with `note=cycle detected, not
folded` — surfacing in the export what today only reaches a log line.

### 6. `NET_BALANCE`

Per person after folding: `consumption`, `paid`, `net`. Positive = owed to them.
`Σ net` must be 0; the section footer asserts it and prints the residual if not.

### 7. `SIMPLIFIED`

The output of the greedy match in `simplify_debts`, one row per transaction, plus a
footer row stating the invariant: each person's Σ simplified transactions equals their
net balance. This is the section that answers "why am I paying someone I never ate
with".

### 8. `CHECKS`

A short block of named invariants and their pass/fail, computed at export time:

| check | meaning |
| --- | --- |
| `net_balances_sum_to_zero` | `Σ NET_BALANCE.net == 0` |
| `splits_match_expense_totals` | per expense, `Σ split.amount_owed == expense.amount` |
| `item_shares_match_splits` | no `RECONCILIATION` rows emitted |
| `no_claimed_and_managed_guests` | no guest has both `claimed_by_id` and `managed_by_id` (the fold skips these) |
| `no_managed_cycles` | `_detect_managed_cycles` returned empty |
| `expense_guests_found_on_group_expense` | count of `ExpenseGuest` / per-item guest rows attached to a group expense; expected 0 |
| `simplified_matches_net` | per person, `Σ SIMPLIFIED == net` |

A failing check is not an error response — the file still downloads, with the failure
stated. An export that refuses to render bad data is useless precisely when it's most
needed.

## Guests and identity

"Guest" means four different things in this codebase, and they do not behave alike in
the sheet. Getting this wrong is how the export ends up attributing money to the wrong
person, which would be worse than the confusion it is meant to fix.

### Identity columns

Every person-bearing row carries three columns, not one:

| column | values |
| --- | --- |
| `person` | display name, resolved via `get_participant_display_name` |
| `person_id` | the raw id from the split row |
| `person_type` | `user` \| `group_guest` |

Two reasons a name column alone is insufficient, both live in production data:

- **Ids overlap.** `ExpenseSplit.user_id` holds a `User.id` when `is_guest` is false and
  a `GuestMember.id` when it's true. User 7 and guest 7 are different people who can sit
  on the same expense.
- **Guest names are not unique.** `routers/members.py::add_guest` does no collision
  check (unlike tab participants, which `TabParticipant.display_name` constrains
  case-insensitively per tab). A group can hold two guests both named "Dave", and today
  nothing distinguishes them anywhere in the UI either.

`person_type` also drives a `PEOPLE` roster section listing every participant once with
their type, claim state and manager — so a reader can resolve any row without scanning
the whole file.

### 1. Group guest (`GuestMember`) — a full participant

Unclaimed, unmanaged group guests are first-class throughout the sheet. They hold
`ExpenseSplit` rows (`is_guest=True`), they appear in `ITEM_SHARE` allocations via
`ExpenseItemAssignment.is_guest`, and they **can be the payer**
(`Expense.payer_is_guest`), so they can carry a positive net balance and appear in
`SIMPLIFIED` as someone who gets paid. They therefore need rows in `CONSUMPTION`,
`PAID`, `NET_BALANCE` and `SIMPLIFIED` exactly like a registered member. Nothing
special is required beyond the identity columns above — the point is that nothing is
*omitted* for them.

### 2. Claimed guest (`claimed_by_id` set) — the account absorbed the history

**Corrected during implementation.** The first draft of this plan assumed a
claimed guest's rows stay keyed to the guest. They do not: `claim_guest` calls
`absorb_guest_into_user`, which physically rewrites every split, item and payer
reference onto the user id and clears `managed_by`. The guest row survives only
as a record of who absorbed it.

So for data created through the current endpoint, the ledger legitimately shows
the account's name — the rows *are* the account's now. What the sheet adds is
the `IDENTITY` section, declaring that guest "Dave" is now "Dave Chen", which is
what explains why an expense somebody remembers splitting with a guest reads as
a member today.

The pre-`absorb` shape still exists in older data: splits keyed to a guest that
also carries `claimed_by_id`. `_managed_key_for_guest` still handles it, and so
does the sheet — those ledger rows keep the **original guest name**, because
that is what the row recorded, while `IDENTITY` reports how many such rows
remain (`ledger_rows_still_under_the_guest`) and the totals land on the account.
Both shapes are covered in `tests/test_balance_sheet_guests.py`.

### 3. Managed guest (`managed_by_id` set) — folded, and shown folding

Covered by the `MANAGEMENT` section: source person, manager, amount moved, reason.
Managed *members* (registered users with `GroupMember.managed_by_id`) fold identically
and share the section, as do guest-managed-by-guest chains. A chain that
`_detect_managed_cycles` refuses to fold gets its row with `note=cycle detected, not
folded`, which currently only surfaces in a `logger.warning`.

Note the defensive case already handled in `utils/balances.py`: a guest with **both**
`claimed_by_id` and `managed_by_id` set is a data-integrity violation that the fold
skips to avoid double-counting. The sheet must apply the same skip and say so in
`CHECKS`, rather than quietly producing a different total than the Balances screen.

### 4. Merged guest (`absorb_guest_into_user`) — invisible by design, with one caveat

Merging physically rewrites rows: splits, items and payer references move to the user
id, and colliding splits are **summed into one row**. So a merged guest leaves nothing
for the export to show at expense level, which is correct — the data genuinely is the
user's now.

The caveat worth writing down: where `splits_merged` fired, a single stored `SPLIT` row
now represents what were two people's original shares, and its `ITEM_SHARE` rows will
sum to the same total by a different route. The sheet cannot decompose that, and should
not pretend to. It's a known, accepted limitation rather than a reconciliation failure,
and it will not trip `CHECKS`.

### 5. Expense guest (`ExpenseGuest`) — out of scope, but checked

Ad-hoc expense guests live in their own table with their own `amount_owed` and never
appear in `ExpenseSplit`. `routers/expenses.py:78` rejects them on group expenses with
a 400, so for a *group* balance sheet they should not exist. The export does not
traverse them (matching `utils/summary.py`'s existing scope-out), but if legacy data
has any attached to a group expense, `CHECKS` reports
`expense_guests_found_on_group_expense` with the count — visible rather than silently
dropped. Same for `ExpenseItemAssignment.expense_guest_id`.

### 6. Tab participants — not in this sheet at all

Tab seats are neither users nor group guests. A tab closes into a **direct** expense
with `group_id` NULL, so it never enters a group balance sheet; an account-less seat
resolves to a plain record with no expense. Nothing to handle here, but worth stating
so the omission doesn't read as a bug.

## Backend Design

### New files

- **`backend/utils/balance_sheet.py`** — the primitive. Read-only, no HTTP, returns a
  `BalanceSheet` dataclass of typed section rows. Mirrors the structure of
  `utils/summary.py`: dataclasses in, dataclasses out, all money in integer cents.
- **`backend/utils/csv_export.py`** — dataclass → CSV bytes. Owns the section
  framing, the number formatting, and the injection guard (below).
- **`backend/routers/exports.py`** — one route, following `routers/summary.py`'s
  authorization pattern exactly: `get_current_user` → `get_group_or_404` →
  `verify_group_membership`, then delegate. Registered in `main.py`.

### Refactor: one item-allocation algorithm, two callers

`calculate_itemized_splits_with_expense_guests` currently consumes Pydantic
`ExpenseItemCreate` objects at write time; the export reads ORM `ExpenseItem` /
`ExpenseItemAssignment` rows. Reimplementing the allocation in the export would
guarantee drift — and drift here means the CSV disagrees with the app, which is worse
than shipping nothing.

Extract the pure core from `utils/splits.py`:

```python
@dataclass(frozen=True)
class AllocationInput:
    item_id: int | None
    price: int
    is_tax_tip: bool
    split_type: str
    split_details: dict
    keys: list[str]            # "user_7", "guest_3", "expense_guest_tmp1"

@dataclass(frozen=True)
class Allocation:
    item_id: int | None
    key: str
    subtotal_cents: int        # pre-tax/tip
    tax_tip_cents: int
    total_cents: int
    rounding_cents: int        # remainder cents this key absorbed
    note: str                  # e.g. "47.5% of subtotal"

def allocate_items(items: list[AllocationInput]) -> list[Allocation]: ...
```

`calculate_itemized_splits` and `..._with_expense_guests` become thin adapters that
build `AllocationInput`s and collapse the result — behavior-identical, and pinned by
the existing tests in `backend/tests/`. The export builds `AllocationInput`s from ORM
rows instead. `rounding_cents` and `note` are new information that the write path
discards today; producing them is the point of the refactor.

This is the one non-trivial piece of the feature. Everything else is assembly.

### Reuse, not reimplementation

- Net balances and folding: `calculate_net_balances(db, group_id, target_currency)`.
  The export needs the *pre-fold* balances too, for the `MANAGEMENT` section — the
  same recomputation `routers/balances.py` already does inline for its breakdown. Lift
  that into `utils/balances.py` as `calculate_raw_balances(db, group_id)` and have both
  callers use it, so the export can't diverge from the Balances screen.
- Simplification: the greedy loop in `simplify_debts` is currently inline in the
  router. Extract it to `utils/balances.py::simplify(net_balances)` and call it from
  both. Without this, the CSV's `SIMPLIFIED` section is a second implementation of the
  algorithm users are already confused by.
- Display names: `get_participant_display_name`, batch-fetched.

### Queries

One pass, all batched, mirroring the existing N+1 avoidance: expenses → splits
(`IN` on expense ids) → items (`IN`) → assignments (`IN`) → users/guests (`IN` on the
collected ids). Roughly 8 queries regardless of group size. Add a
`backend/tests/test_perf_balance_sheet.py` query-count guard, matching the
`test_performance_*` convention.

### Response

```python
StreamingResponse(
    iter_csv_chunks(...),
    media_type="text/csv; charset=utf-8",
    headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
)
```

Filename: `balance-sheet-{slugified_group_name}-{YYYY-MM-DD}.csv`, slug restricted to
`[a-z0-9-]` and truncated — the group name is user-controlled and lands in a header.

Preceded by a UTF-8 BOM (`﻿`) so Excel doesn't mangle non-ASCII names and emoji
group icons.

### CSV injection guard

Group names, expense descriptions, item descriptions, member names and notes are all
user-controlled and all land in cells. Any value beginning with `=`, `+`, `-`, `@`,
tab or CR gets prefixed with a single quote before writing. This belongs in
`csv_export.py` and gets its own unit test; a spreadsheet formula in an expense
description is a real, easy attack on whoever opens the file.

## Frontend Design

- `frontend/src/types/balanceSheet.ts` — nothing to model beyond the request, since the
  payload is a file; the type file holds the request options only.
- `frontend/src/services/api.ts` — `groupsApi.downloadBalanceSheet(groupId)` returning a
  `Blob`. It must go through `apiFetch` (the export is authenticated; putting a token in
  a query string so a bare `<a href>` works would leak it into logs and history).
  Then `URL.createObjectURL` → synthetic anchor click → `revokeObjectURL`, the same
  lifecycle `ReceiptScanner.tsx` already uses for preview blobs.
- Placement: a small "Export CSV" button in the Balances section header of
  `frontend/src/routes/GroupPage.tsx`, next to Simplify Debts — the surface where the
  confusion actually occurs.
- Offline: the action is disabled with an explanatory tooltip when
  `navigator.onLine` is false. The export is server-computed and there is no offline
  equivalent; a queued sync would produce a stale sheet, which is worse than no sheet.
- The filename comes from `Content-Disposition`; parse it, and fall back to a
  client-built name if the header is absent.

## Testing

Backend:
- `tests/test_utils_balance_sheet.py` — pure-logic: itemized allocation with tax/tip
  and remainder cents; multi-currency conversion; folding; a deliberately mismatched
  `ExpenseSplit` producing exactly one `RECONCILIATION` row; a managed cycle producing
  the not-folded note.
- `tests/test_balance_sheet_guests.py` — the identity cases, which are the ones most
  likely to silently misattribute money: a user and a group guest sharing the same
  numeric id on one expense; two same-named guests in one group; a guest as expense
  payer carrying a positive net balance into `SIMPLIFIED`; a claimed guest whose
  historical rows keep the guest name while totals land on the user; a guest with both
  `claimed_by_id` and `managed_by_id` set, asserting the sheet skips the fold and fails
  the matching check rather than diverging from `/groups/{id}/balances`.
- `tests/test_utils_csv_export.py` — section framing, BOM, 2dp formatting for JPY,
  injection guard on each dangerous prefix.
- `tests/test_exports.py` — integration through `TestClient`: 401 unauthenticated,
  404 missing group, 403 non-member, 200 with `text/csv` and a well-formed
  `Content-Disposition`; a round-trip that parses the response with `csv.reader` and
  asserts the `CHECKS` section is all-pass for a fixture group.
- `tests/test_perf_balance_sheet.py` — query-count guard.
- Existing `utils/splits.py` tests must pass **unchanged** through the refactor. That is
  the acceptance criterion for the extraction.

Frontend:
- `services/__tests__/api.balanceSheet.test.ts` — blob request, header parsing,
  `revokeObjectURL` called on both success and failure paths.
- A component test for the disabled-offline state.

## Scope Boundaries

In scope: one group, all its expenses, CSV only, authenticated members only.

### Non-goals

- **No date-range or person filter in v1.** The whole point is reconciliation; a
  filtered balance sheet doesn't reconcile, and a sheet whose `CHECKS` section can
  fail by construction teaches users to ignore it.
- **No public share-link export.** The sheet contains every member's name and full
  financial position. The public summary endpoint is deliberately narrower and this
  should not widen it.
- **No XLSX / PDF.** CSV first; formatting is a separate feature with a library cost.
- **No tab exports.** Tabs already have `TabBreakdown` and resolve into ordinary
  expenses on close, so a closed tab's expense appears in this sheet like any other.
- **ExpenseGuest rows are not traversed**, matching `utils/summary.py`'s existing
  scope-out — `routers/expenses.py` rejects ad-hoc expense guests on group expenses.
  If one is found in legacy data, it gets a `CHECKS` warning rather than silent
  omission.

## Open Questions

1. **Should `CHECKS` failures be reported anywhere but the file?** A `logger.warning`
   on a failed invariant would surface real data corruption in production logs. Cheap;
   recommend yes.
2. **Display currency.** The plan uses the group default (matching `simplify_debts`).
   A `?convert_to=` parameter would match `/groups/{id}/balances`. Recommend deferring
   until someone asks — every added currency axis is another column to explain.
3. **Should the export be rate-limited?** It's authenticated and member-scoped, but it
   is by far the heaviest read in the app. A generous per-user limit via the existing
   `utils/rate_limiter.py` is nearly free to add.

## Rollout

The refactor lands first and separately (`allocate_items` extraction,
`calculate_raw_balances` and `simplify` lifted out of the router), verified by the
existing test suite with no behavior change. The export builds on top of it. That
ordering keeps the risky part — touching money math that already works — in a diff
small enough to review on its own.
