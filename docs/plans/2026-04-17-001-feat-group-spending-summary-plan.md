---
title: Add Group Spending Summary to group detail page
type: feat
status: active
date: 2026-04-17
origin: docs/brainstorms/2026-04-17-group-spending-summary-requirements.md
---

# Add Group Spending Summary to group detail page

## Overview

Add a read-only **Summary** collapsible section to the group detail page that shows (a) per-member total consumption in the group's default currency, (b) a group-level total, and (c) a time-trend bar chart (stacked-per-member for members, single-series for public viewers). Public share-link viewers get a strictly narrower response (group total + single-series chart only — no per-member data or names). First charting library in the codebase: adopt **visx** low-level primitives.

## Problem Frame

Members can already see who owes whom (`/balances`) and every individual expense, but there is no view that answers "how expensive was this group, and how was the cost distributed across members and over time?" Today the user has to eyeball the expense list. See origin: `docs/brainstorms/2026-04-17-group-spending-summary-requirements.md`.

## Requirements Trace

Carried from the origin document (all R-numbers below reference it):

- R1, R2, R3 — Collapsible section placement, public-link access, `verify_group_membership` on the authenticated endpoint.
- R4–R7 — Per-member consumption totals, settlement exclusion, managed-member folding with expandable breakdown, deterministic sort order.
- R8 — Group-level total.
- R9–R14 — Stacked bar chart (member view), bucketing by `Expense.date`, three-tier auto granularity (week/month/quarter), reconciliation with per-member totals, empty-period bars, minimum tap/tooltip interaction.
- R15, R16 — Public share-link narrowed to group total + single-series chart; per-IP rate limit on the new public endpoint.
- R17–R19 — Hybrid currency conversion (match existing `/balances`), legacy `exchange_rate` fallback, inline "estimated rates" note.
- R20, R21 — Empty state, single-period handling, loading/error states.

## Scope Boundaries

- Read-only — no writes, no edits, no categorization.
- No date-range filter; no week/month user toggle (auto-bucketing).
- No IA migration to tabs — adds a collapsible section alongside existing Balances/Expenses.
- No changes to `/balances` or other existing `/public/*` endpoints; the rate-limit precedent applies only to the new public summary route.
- No `total paid` column (dropped in brainstorm).

### Non-goals (explicit v1 exclusions)

- **ExpenseItemAssignment.expense_guest_id consumption is not counted.** The aggregation iterates only `ExpenseSplit` rows; per-item guest assignments (`ExpenseItemAssignment.expense_guest_id`, `models.py:111`) are not traversed. In practice `backend/routers/expenses.py:48-52` already rejects ad-hoc `ExpenseGuest` rows on group expenses — so this scope-out is primarily **defensive**: if that invariant is ever relaxed (or legacy data violates it), Summary will silently ignore those rows rather than crash. Document the limitation in release notes and revisit in v1.1 if real groups hit the gap.

### Deferred to Separate Tasks

- Backfill of expenses missing `Expense.exchange_rate`: separate task after measuring production null rate.
- Extending rate limiting to existing `/public/*` endpoints: follow-up issue.
- Fixing the `X-Forwarded-For` trust bypass in `backend/utils/rate_limiter.py`: out-of-scope here; this feature inherits existing behavior. Assumes the app deploys behind a trusted reverse proxy that strips/overwrites the header.
- Full ExpenseGuest / itemized-guest consumption support: v1.1.

## Context & Research

### Relevant Code and Patterns

- `backend/routers/balances.py` — authenticated endpoint pattern: `Depends(get_current_user)`, `get_group_or_404`, `verify_group_membership`, delegates to `backend/utils/balances.py`. Mirror this for the new `routers/summary.py`.
- `backend/utils/validation.py` (`verify_group_membership`) — raises 403 if the user is not a group member. Reuse directly.
- `backend/utils/balances.py:104-171` — existing managed-guest and managed-member folding loops. These will be **extracted** into a shared `_fold_managed_relationships` helper so `calculate_net_balances` and the new `calculate_consumption_summary` share folding logic.
- `backend/utils/balances.py:52-102` — net-balance inner loop. The consumption variant is simpler: it only needs the debtor side (`split.amount_owed`) and must skip `expense.is_settlement == True` (which today's net-balance code does not).
- `backend/utils/currency.py` — `convert_to_usd` (historical first leg via `Expense.exchange_rate`) and `convert_currency` (static table for USD→group). The two-leg hybrid path is the same one `/balances` uses; reuse directly.
- `backend/utils/rate_limiter.py` — canonical limiter class. Used via `dependencies=[Depends(limiter_singleton)]` on route decorators (see `backend/routers/auth.py:21`). Conftest overrides listed at `backend/tests/conftest.py:15-21, 85-91`.
- `backend/routers/groups.py` — public endpoint pattern (`GET /public/{share_link_id}/...`). Register the new public summary route here. Note: existing `get_public_group_balances` re-implements balance math inline; the new public summary instead calls the shared primitive to avoid repeating that mistake.
- `backend/main.py` — where to register the new `summary` router.
- `backend/tests/conftest.py` — `db_session`, `client`, `test_user`, `auth_headers`, autouse `disable_rate_limits`. Tests build groups inline via client POSTs (see `backend/tests/test_balances.py`). Add the new `summary_rate_limiter` to the rate-limit override list.
- `frontend/src/GroupDetailPage.tsx:846-929` — collapsible section pattern (`isBalancesExpanded` state, outer card classes with dark-mode variants, `aria-expanded` / `aria-controls`, `+/−` indicator). Mirror this for the Summary section.
- `frontend/src/services/api.ts` — newer namespaced API client (`authApi`, `groupsApi`, etc.) with `apiFetch` for authenticated calls and raw `fetch` for public calls. Add `groupsApi.getSummary(groupId)` and `groupsApi.getPublicSummary(shareLinkId)`.
- `frontend/src/types/balance.ts` — small shape file; model `frontend/src/types/summary.ts` on it.
- `frontend/src/utils/formatters.ts` — `formatMoney`, date helpers; reuse for row amounts and axis labels.
- `frontend/src/ThemeContext.tsx` + Tailwind 4 — dark mode via CSS classes. visx SVG elements get colors via `fill="var(--chart-N)"` using CSS variables defined in the app's theme.
- `frontend/src/utils/__tests__/expenseCalculations.test.ts` — vitest pattern for pure-logic unit tests. Mirror for a new `frontend/src/utils/__tests__/summaryBuckets.test.ts` if client-side bucketing helpers are needed (currently the server is authoritative for bucketing).

### Institutional Learnings

No `docs/solutions/` entries yet. Topical references:

- `docs/FEATURES.md` — multi-currency model and Frankfurter caching.
- `docs/USER_MANAGEMENT.md` — managed member/guest folding rules.
- `docs/DATABASE.md` — balance query shape and indexes.
- `docs/PWA.md` — service-worker precache budget considerations.

### External References

- Airbnb visx docs (`@visx/shape`, `@visx/scale`, `@visx/axis`, `@visx/group`) — React 19 safe, SVG-based, ~25–30 KB gzipped for the pieces we use. Chosen over Recharts (known React 19.2.x blank-chart bug, issue #6857) and Chart.js (~68 KB, weaker a11y).

## Key Technical Decisions

- **Extract `_fold_managed_relationships` helper before adding new aggregation.** `calculate_net_balances` and the new `calculate_consumption_summary` must fold identically so Summary and Balances reconcile. Extracting first (with no behavior change) keeps the refactor and the new code in separate commits and de-risks both. Note: `calculate_net_balances` has two mode branches (single-currency scalar-valued dict and multi-currency dict-of-dicts); the new consumption primitive only needs the scalar case, so the helper should be scoped to the scalar case and the multi-currency branch in `calculate_net_balances` can stay inline. Characterization tests must exercise both scalar and multi-currency branches of the pre-refactor `calculate_net_balances` so drift is caught.
- **Settlement filter belongs in the new consumption helper, not in `calculate_net_balances`.** Changing settlement handling on the existing balance primitive would silently alter Balances behavior. Keep the filter local to the new helper; add a regression test asserting the flag is excluded from consumption totals.
- **All monetary response fields use integer cents.** Both the tally dicts and the response schemas (`group_total: int`, `members[].total: int`, `series[].total: int`, `per_member[].amount: int`) use integer cents, matching the existing pattern in `backend/routers/balances.py:270` (`schemas.GroupBalance(... amount=int(amount) ...)`) and `frontend/src/utils/formatters.ts:11-21` (`formatMoney = (amount, currency) => formatter.format(amount / 100)`). Truncate to int after the two-leg conversion, matching existing Balances behavior.
- **`group_total` is defined as Σ converted `split.amount_owed` (settlements excluded), not Σ `expense.amount`.** This preserves the invariant `group_total == Σ members[].total == Σ series[].total == Σ series[].per_member[].amount` by construction. Legacy expenses where splits don't sum to the expense amount (payer-not-in-splits, rounding residuals) will show as a silent divergence between Summary and a mental `expense.amount` sum; a regression test pins the chosen definition.
- **`has_synthesized_historical_rate` replaces the misleading `has_estimated_rates` flag proposed in earlier drafts.** Leg 2 (USD → group currency) always uses static rates from `backend/utils/currency.py`'s `EXCHANGE_RATES` table; that's an unavoidable property of the hybrid path. The flag specifically means "leg 1 fell back because `Expense.exchange_rate` was null on one or more expenses **where the expense currency differed from USD**." Same-USD-currency expenses that happen to have null `exchange_rate` must not flip the flag — no synthesis actually occurred. UI copy: "One or more historical exchange rates were synthesized from current data" — precise about what changed.
- **Server-side response cache on the public endpoint.** Add an in-memory TTL cache (~60s) keyed by `share_link_id` on `GET /groups/public/{share_link_id}/summary`. This absorbs viral-link traffic and neutralizes most of the amplification value of IP-spoofed requests. Authenticated endpoint does not cache (per-session relevance matters more than throughput).
- **Unit 1 (refactor of `calculate_net_balances`) deploys ahead of Units 2–9.** The refactor is zero-behavior-change but touches existing production balance code. Ship Unit 1 in its own PR, let it bake for at least one deploy cycle, then build Units 2–9 on top. Reduces rollback blast radius if an edge case regresses Balances.
- **Time bucketing and granularity selection happen server-side.** The server returns pre-bucketed data with an explicit `granularity: "week" | "month" | "quarter"` field; the frontend just renders. This avoids duplicating `Expense.date` parsing and reconciles perfectly by construction.
- **Bucket in UTC via `datetime.date.fromisoformat(normalize_date(expense.date))`.** `normalize_date` (`backend/routers/expenses.py:28-38`) returns a normalized `YYYY-MM-DD` **string** — it strips `T...` suffixes but passes other malformed input through unchanged, so `fromisoformat` can still raise. The summary aggregation must wrap the parse in a try/except and **skip expenses with unparseable dates** (increment a counter so a future log or metric can surface the skip count). Document "bucket boundaries are UTC ISO-week / calendar-month / calendar-quarter" as the convention. Any other choice (viewer-local, group-creator-local) requires data we don't have.
- **Three-tier granularity keyed off non-settlement expense span.** `< 3 months → week`, `3–18 months → month`, `≥ 18 months → quarter`. Using non-settlement span prevents a late settlement-only expense from re-bucketing the whole chart.
- **Public endpoint returns a strictly smaller response.** Separate Pydantic schemas (`PublicGroupSummaryResponse` has `group_total` + `series[]` with only `period` and `total`; `GroupSummaryResponse` adds `members[]` and per-period per-member values). Physically separate types make it structurally hard to leak per-member data on the public route.
- **Public summary rate limit: 30/min/IP.** New precedent on `/public/*`. Auth is 5/min, OCR is 5/min; summary is read-only but expensive per call, so a higher cap is appropriate. Expose as `summary_rate_limiter` in `utils/rate_limiter.py` so the budget is visible and test conftest can override it.
- **Single response shape for the authenticated endpoint.** `{ group_total, currency, members: [...], series: [...], granularity, has_synthesized_historical_rate }`. One round trip powers both the table (from `members`) and the chart (from `series`) and guarantees they reconcile.
- **visx low-level primitives (`@visx/shape`, `@visx/scale`, `@visx/axis`, `@visx/group`) over any higher-level chart library.** ~25–30 KB gzipped, React 19 compatible, SVG output integrates cleanly with Tailwind dark mode via CSS variables, and a screen-reader `<table>` fallback is straightforward to render from the same data.
- **Deterministic per-member color assignment from a fixed 8-color palette.** Sort members by join order (`GroupMember.id`), cycle the palette, and collapse the overflow into a single `"Others"` gray segment for groups with more than 8 members. Palette defined as CSS variables in `index.css` with light/dark variants.
- **Accessibility baseline: SVG `role="img"` with an `aria-label` summary, plus a visually-hidden `<table>` fallback rendered from the same series data.** Keyboard nav per bar is deferred to a follow-up — the table fallback is sufficient for v1 a11y.

## Open Questions

### Resolved During Planning

- Endpoint shape: new `GET /groups/{id}/summary` (auth) + `GET /groups/public/{share_link_id}/summary` (public). Not an extension of `/balances` — separate concerns.
- Charting library: visx low-level primitives.
- Timezone for bucket boundaries: UTC (convention; `Expense.date` has no TZ).
- Public rate-limit budget: 30/min/IP.
- Per-member color strategy: fixed 8-color palette, deterministic by join order, `"Others"` gray overflow.
- A11y baseline: SVG `role="img"` + `aria-label` + visually-hidden data table.

### Deferred to Implementation

- Exact visx component composition (stack layout vs. manual positioning) — decide while wiring the bar-chart component.
- Empty-period rendering strategy (zero-height bars vs. skipped tick labels) — decide after eyeballing real data in dev.
- Tooltip positioning strategy on narrow viewports — decide during mobile polish pass.
- Whether to add a client-side `useSummaryData` hook or call `groupsApi.getSummary` directly from `GroupDetailPage.tsx` — depends on whether offline/SWR caching (`frontend/src/services/offlineApi.ts`) is worth extending to this endpoint. Default to direct call for v1.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Backend data flow for the authenticated endpoint:**

```
GET /groups/{group_id}/summary
      │
      ├── Depends(get_current_user)
      ├── get_group_or_404(db, group_id)
      ├── verify_group_membership(db, group_id, current_user.id)
      │
      ▼
  calculate_consumption_summary(db, group_id, target_currency=group.default_currency)
      │
      ├── query Expense rows for group_id where is_settlement == False
      ├── for each ExpenseSplit on those expenses:
      │     convert split.amount_owed to target_currency (hybrid: historical→USD, static→target)
      │     consumption[(user_id, is_guest)] += converted_amount
      │     bucket_totals[period_key][(user_id, is_guest)] += converted_amount
      ├── _fold_managed_relationships(db, group_id, consumption, target_currency)
      ├── _fold_managed_relationships(db, group_id, bucket_totals_per_member, target_currency)
      ├── compute granularity from non-settlement date span
      ├── build empty-period buckets between min and max period
      │
      ▼
  GroupSummaryResponse {
    group_total, currency, granularity,
    has_synthesized_historical_rate,
    members: [{ user_id, is_guest, display_name, total, managed_members: [{display_name, total}] }],
    series: [{ period_label, period_start, total, per_member: [{user_id, is_guest, amount}] }]
  }
```

**Public endpoint takes the same underlying `calculate_consumption_summary` call, then projects to the narrower shape:**

```
PublicGroupSummaryResponse {
  group_total, currency, granularity,
  has_synthesized_historical_rate,
  series: [{ period_label, period_start, total }]   // no per_member
}
```

**Frontend composition:**

```
GroupDetailPage
  └─ <SummarySection>           // new collapsible section
       ├─ header (total, granularity label, estimated-rates note if applicable)
       ├─ <MemberConsumptionTable>  // per-member rows with expand-for-managed
       └─ <SpendingTrendChart>      // visx stacked bars + legend + a11y table
```

## Implementation Units

- [ ] **Unit 1: Extract `_fold_managed_relationships` helper (refactor, no behavior change)**

**Goal:** Factor the managed-guest and managed-member folding loops out of `calculate_net_balances` so the new consumption primitive can reuse them. Zero behavior change on `/balances`.

**Requirements:** (foundational — enables R6)

**Dependencies:** none

**Files:**
- Modify: `backend/utils/balances.py`
- Modify: `backend/tests/test_balances.py` (if needed to lock existing behavior before refactor)

**Approach:**
- Introduce `_fold_managed_relationships(db, group_id, totals: dict, target_currency_mode: bool) -> None` that runs the two existing loops over a `totals` dict keyed by `(user_id, is_guest)`.
- Replace the inline folding in `calculate_net_balances:104-171` with a call to the new helper.
- Preserve the existing defensive-skip behavior for claimed guests that also have `managed_by_id` (lines ~113-120).

**Execution note:** Add characterization coverage before modifying if the existing settlement/folding tests don't already exercise both paths.

**Patterns to follow:**
- Existing loops at `backend/utils/balances.py:104-171`.

**Test scenarios:**
- Integration: the full test_balances suite passes unchanged (no behavior regression).
- Characterization (single-currency / scalar mode): before refactor, lock a fixture with managed guest (`-50`) folding into manager (`+30`) → manager ends at `-20`, guest key removed. Assert byte-for-byte identical output pre- and post-refactor.
- Characterization (multi-currency / dict-of-dicts mode): the helper is scoped to the scalar case; the multi-currency branch of `calculate_net_balances` stays inline and is not refactored. The existing `test_balances.py` suite is the safety net for that branch — re-run before and after to confirm no regression. No new fixture required here.
- Characterization (managed member, not just guest): same as scalar-mode above for `GroupMember.managed_by_id`.
- Edge case: claimed guest that also has `managed_by_id` set is handled identically to before (defensive skip at `balances.py:113-120` still fires).
- Edge case: iteration-order independence — two guests folding into the same manager produce the same final total regardless of order (pin by sorting the query or asserting commutativity).

**Verification:**
- `calculate_net_balances` returns byte-for-byte the same output for all characterization fixtures, both currency modes.
- The helper is callable with an arbitrary scalar-valued dict and produces the same folding behavior.

---

- [ ] **Unit 2: Add `calculate_consumption_summary` primitive + time bucketing**

**Goal:** New aggregation entrypoint that returns per-member consumption totals, per-period bucket totals (and per-member per-period sub-totals), chosen granularity, and a `has_synthesized_historical_rate` flag. Settlements excluded. Managed members folded via Unit 1's helper. **ExpenseGuest consumption is not counted** — only `ExpenseSplit` rows contribute (scoped as a v1 non-goal).

**Requirements:** R4, R5, R6 (data), R8, R9, R10, R11, R12, R13, R17, R18, R19.

**Dependencies:** Unit 1.

**Files:**
- Create or extend: `backend/utils/balances.py` (new function `calculate_consumption_summary`) — or create `backend/utils/summary.py` if `balances.py` is getting large; implementer's call.
- Modify: `backend/tests/test_balances.py` or create `backend/tests/test_summary.py` for the new primitive.

**Approach:**
- Query expenses for `group_id` with `is_settlement == False`. For each `ExpenseSplit` on those expenses, convert `amount_owed` via the existing two-leg hybrid path (historical leg via `Expense.exchange_rate` / fallback to current static rate when null; static leg via `convert_currency`). Track `has_synthesized_historical_rate = True` whenever the null-rate fallback fires on leg 1 (leg 2 is always static; the flag therefore means "leg 1 was synthesized," not "no estimation occurred"). Tallies and returned totals are integer cents, matching the existing Balances path.
- Parse `Expense.date` via `datetime.date.fromisoformat(normalize_date(expense.date))`. `normalize_date` (`backend/routers/expenses.py:28-38`) returns a normalized `YYYY-MM-DD` string (handles `T...` suffixes seen in production data) but does not itself return a `date` and does not guard against genuinely malformed input — wrap the parse in a try/except, **skip** expenses whose date cannot be parsed, and record the skip count so it surfaces in tests/metrics. Do this parsing once, up-front, producing a list of `(expense, parsed_date)` tuples — drive both span computation (granularity selection) and bucket assignment from that list.
- Maintain two tallies during the same scan: `consumption: dict[(user_id, is_guest), float]` and `bucket_totals: dict[period_key, dict[(user_id, is_guest), float]]`.
- `period_key` depends on granularity. Compute granularity **after** the scan by measuring the min/max expense date span:
  - span `< 3 months` → `"week"` (ISO year-week, e.g. `"2026-W16"`)
  - `3 months ≤ span < 18 months` → `"month"` (`"2026-04"`)
  - `≥ 18 months` → `"quarter"` (`"2026-Q2"`)
  During the expense scan, record the raw date; convert to period keys in a second pass once granularity is known (two passes — simpler than re-scanning).
- Apply `_fold_managed_relationships` to both `consumption` and each period's per-member sub-dict.
- Fill empty periods between min and max bucket with zeroed entries so the frontend can render a continuous axis (R13).

**Execution note:** Start with a failing test covering settlement exclusion (there is no existing test of `is_settlement=True` in aggregation — this is new behavior for the codebase).

**Patterns to follow:**
- Net-balance scan loop at `backend/utils/balances.py:52-102` (shape of the expense/split iteration).
- Currency conversion pattern in `calculate_net_balances` (hybrid two-leg).

**Test scenarios:**
- Happy path: group with 2 members and 3 non-settlement expenses returns per-member totals summing to the group total.
- Happy path: returns `granularity: "week"` for a group where all expenses are within 3 months.
- Happy path: returns `granularity: "month"` for a group spanning 4 months.
- Happy path: returns `granularity: "quarter"` for a group spanning 2 years.
- Edge case (settlement exclusion): a group with one normal expense and one `is_settlement=True` expense returns totals that match only the normal expense; no settlement amount appears anywhere in the response.
- Edge case (managed member folding): managed guest's consumption (e.g. $60) shows up on the managing user's row, not on the guest's row; the guest key is absent.
- Edge case (multi-currency): expenses in EUR and GBP in a USD group convert through the hybrid path and produce the same total a manual calculation would using the stored `exchange_rate` + `convert_currency`.
- Edge case (legacy rate): an expense with `exchange_rate = None` in a non-group-currency currency uses the fallback static rate and sets `has_synthesized_historical_rate = True`.
- Edge case (empty group): no non-settlement expenses → returns `group_total = 0`, empty `members` and `series`, granularity defaults to `"month"`.
- Edge case (malformed date): an expense whose `date` field is genuinely unparseable (empty string, garbage, unexpected format that `normalize_date` passes through unchanged) is **skipped**; the returned response still reconciles with the skipped expense absent. Counter is non-zero so the skip is observable.
- Edge case (same-currency fallback does NOT flip the flag): an expense whose currency equals the group's default currency and has `exchange_rate = NULL` is a no-op for conversion. `has_synthesized_historical_rate` stays False for that expense.
- Edge case (single period): one expense on one date → `series` has exactly one bucket; granularity still computed deterministically.
- Edge case (empty periods between filled ones): expenses in Jan and Mar (month granularity) → series includes an explicit zero bucket for Feb.
- Edge case (payer-not-in-splits): an expense where the payer has no `ExpenseSplit` row and splits sum to the full expense amount — the consumption totals still reconcile to `group_total` because both are computed from splits (pins the "`Σ split.amount_owed` is authoritative" decision).
- Edge case (ExpenseGuest scoped-out): a group containing an ExpenseGuest-based itemized expense — the `ExpenseSplit` rows for that expense still count; the `ExpenseGuest.amount_owed` rows do not appear in `group_total` or `members[]`. Test asserts this is the v1 behavior and documents the gap.

**Verification:**
- For a fixture where Balances already reconciles to user expectations, Summary's consumption totals match the debtor side of those Balances computations (settlements excluded).

---

- [ ] **Unit 3: Authenticated endpoint `GET /groups/{group_id}/summary`**

**Goal:** Register the authenticated summary route that wires `calculate_consumption_summary` into a `GroupSummaryResponse`. Enforce group membership.

**Requirements:** R1 (contract surface), R3 (authz), R4, R5, R6, R7, R8, R17–R19.

**Dependencies:** Unit 2.

**Files:**
- Create: `backend/routers/summary.py`
- Modify: `backend/main.py` (register the new router)
- Modify: `backend/schemas.py` (add `GroupSummaryResponse`, `GroupSummaryMember`, `GroupSummaryManagedMember`, `GroupSummarySeriesPoint`, `GroupSummarySeriesPointMember`)
- Create: `backend/tests/test_summary.py`

**Approach:**
- Mirror `backend/routers/balances.py` layout: `get_db` + `get_current_user` dependencies, `get_group_or_404`, `verify_group_membership`.
- Resolve display names using the existing helpers in `backend/utils/display.py` so folded-manager rows show the same name as the Balances tab.
- Response includes `managed_members: [{ display_name, total }]` on each `members[]` row so the frontend can render the expandable breakdown (R6).
- Sort `members` by `total` descending in the response (server authoritative); the frontend handles the "You first" pinning via the current user id.

**Patterns to follow:**
- `backend/routers/balances.py` entire file — copy the skeleton.

**Test scenarios:**
- Happy path: authenticated group member gets a 200 with the expected shape: `group_total`, `currency = group.default_currency`, `granularity`, `members[]`, `series[]`, `has_synthesized_historical_rate`.
- Happy path: `members[]` is sorted by `total` descending.
- Happy path: managed guest's consumption appears on the manager's row with a `managed_members` breakdown entry.
- Error path: non-member authenticated user gets 403 (from `verify_group_membership`).
- Error path: non-existent `group_id` returns 404.
- Error path: unauthenticated request returns 401.
- Integration: the authenticated endpoint's `group_total` equals the sum of `members[].total`, and equals the sum of `series[].total`.

**Verification:**
- Test suite passes; response shape matches the Pydantic schema; three-way reconciliation (group_total ↔ members sum ↔ series sum) holds in all fixtures.

---

- [ ] **Unit 4: Public endpoint `GET /groups/public/{share_link_id}/summary` with rate limiter**

**Goal:** Register the public (unauthenticated) summary route that returns a strictly narrower response — group total + single-series chart only, no per-member data or names. Apply a per-IP rate limit.

**Requirements:** R2, R15, R16.

**Dependencies:** Unit 2.

**Files:**
- Modify: `backend/routers/groups.py` (add `get_public_group_summary` alongside the existing `get_public_group_balances`)
- Modify: `backend/utils/rate_limiter.py` (add `summary_rate_limiter = RateLimiter(requests_limit=30, time_window=60)`)
- Modify: `backend/tests/conftest.py` (include the new limiter in the autouse `disable_rate_limits` override list)
- Modify: `backend/schemas.py` (add `PublicGroupSummaryResponse`, `PublicGroupSummarySeriesPoint`)
- Create: `backend/utils/summary_cache.py` — small bounded in-memory TTL cache (60s TTL, max 1000 entries with FIFO eviction) keyed by `share_link_id`. Plain `OrderedDict[str, tuple[PublicGroupSummaryResponse, float]]` with a timestamp check and a size cap; no dependencies. Only valid (resolved, `is_public=True`) responses are cached — 404 paths do not populate the cache, so unknown share-link-ids can't be used to grow the dict.

**Approach:**
- Resolve the group by `Group.share_link_id` and `is_public == True`, returning 404 on miss (match existing public endpoint behavior).
- **Before computing, check the 60s TTL cache** (`summary_cache.get(share_link_id)`). On hit, return the cached `PublicGroupSummaryResponse` directly. On miss, compute and populate the cache.
- Call `calculate_consumption_summary` to get the full response, then **project to the narrower shape**. Physically distinct Pydantic models (`PublicGroupSummaryResponse` has no `members` field and `PublicGroupSummarySeriesPoint` has no `per_member` field) make accidental leakage a schema-level impossibility.
- Apply the rate limiter via `dependencies=[Depends(summary_rate_limiter)]` on the route decorator.
- Declare `response_model=PublicGroupSummaryResponse` on the route decorator so FastAPI enforces the narrower schema at serialization time, independent of what the handler returns. This makes accidental per-member data leakage a runtime-enforced schema error, not a manual-projection trust exercise.
- When `is_public` is toggled off (see `backend/routers/groups.py:249`) or the share link is rotated, invalidate the corresponding `share_link_id` entry in `summary_cache` so previously-public viewers don't continue seeing cached data for up to 60s after the group is made private. Hook into the existing group-update paths rather than letting TTL expiry handle it.

**Patterns to follow:**
- Existing public endpoints in `backend/routers/groups.py` (the `/public/{share_link_id}/balances` route).
- Rate-limiter attachment pattern at `backend/routers/auth.py:21`.
- Test override pattern at `backend/tests/conftest.py:15-21, 85-91`.

**Test scenarios:**
- Happy path: unauthenticated request to a valid public share link returns 200 with `group_total`, `currency`, `granularity`, `series` (only `period_label`, `period_start`, `total`), `has_synthesized_historical_rate`. No `members`, no names, no per-member series data.
- Happy path: `group_total` on the public response equals `group_total` on the authenticated response for the same group.
- Error path: share link for a non-public group returns 404.
- Error path: non-existent share link returns 404.
- Error path (rate limit): exceeding the limit returns 429. (Rely on a scoped limiter override for this one test; most tests use the autouse disable fixture.)
- Integration (cache): second request within 60s for the same `share_link_id` returns the cached response without re-running `calculate_consumption_summary` (assert by patching the primitive and checking call count).
- Edge case (cache TTL expiry): the primitive is re-invoked after 60s.
- Integration: for a group with managed members, the public response's `series[].total` equals the sum of the authenticated response's `series[].per_member[].amount` for the same period — i.e. managed-member folding does not change the totals, it only redistributes attribution.

**Verification:**
- Response JSON contains no `members` key, no `display_name` anywhere, no per-member series entries.
- Rate limiter fires at the configured threshold.

---

- [ ] **Unit 5: Frontend types + API client methods**

**Goal:** Type the new responses and add `groupsApi.getSummary(groupId)` and `groupsApi.getPublicSummary(shareLinkId)`.

**Requirements:** (frontend plumbing for R1, R15)

**Dependencies:** Units 3 and 4 (API contract finalized).

**Files:**
- Create: `frontend/src/types/summary.ts`
- Modify: `frontend/src/services/api.ts`

**Approach:**
- `summary.ts` exports `GroupSummaryResponse`, `GroupSummaryMember`, `GroupSummaryManagedMember`, `GroupSummarySeriesPoint`, `GroupSummarySeriesPointMember`, `PublicGroupSummaryResponse`, `PublicGroupSummarySeriesPoint`, and a `SummaryGranularity = 'week' | 'month' | 'quarter'` union.
- `groupsApi.getSummary` uses `apiFetch` (authenticated). `groupsApi.getPublicSummary` uses raw `fetch` + `API_BASE_URL` with no Authorization header. Match the existing namespaced-exports style.

**Patterns to follow:**
- `frontend/src/types/balance.ts` (shape and scale).
- `frontend/src/services/api.ts` — `groupsApi.getBalances` for authenticated, `groupsApi.joinPublic` or `expensesApi.getPublicById` for public.

**Test scenarios:**
- Test expectation: none — type definitions and thin API wrappers. Behavior is covered by higher-level component tests in later units and by backend tests.

**Verification:**
- `tsc` compiles cleanly; the types are importable from `GroupDetailPage.tsx` and the two new components.

---

- [ ] **Unit 6: Install visx charting primitives**

**Goal:** Add `@visx/shape`, `@visx/scale`, `@visx/axis`, `@visx/group` to the frontend. Isolated commit for review clarity and bundle-impact attribution.

**Requirements:** R9 (enables the chart).

**Dependencies:** none; can run in parallel with backend work.

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (generated)

**Approach:**
- Install pinned current versions of the four packages.
- Add a single wildcard `overrides` entry in `frontend/package.json` to resolve the React 19 peer-dep warning across all current and transitive visx packages (visx 3.x declares React peers up to 18 only):
  ```json
  "overrides": {
    "@visx/*": { "react": "$react", "react-dom": "$react-dom" }
  }
  ```
  (Grammar: `$react` resolves to the version already listed in `dependencies.react`. The wildcard covers any visx sub-package pulled in transitively, avoiding silent peer-dep misses if a fifth `@visx/*` dependency appears.)
- Confirm the production bundle size impact by running `npm run build` and noting the output size. Budget: < 60 KB gzipped for the charting additions.

**Patterns to follow:**
- None specific; standard npm install.

**Test scenarios:**
- Test expectation: none — dependency addition.

**Verification:**
- `npm run build` succeeds; total gzipped increase is ≤ 60 KB; `npm run lint` and `npm run test` still pass.

---

- [ ] **Unit 7: `MemberConsumptionTable` component with expandable managed-member rows**

**Goal:** Render the per-member table: one row per top-level member with expand-to-reveal managed members, current user pinned first, otherwise sorted by total descending. Includes the group-level total header and the optional "estimated rates" inline note.

**Requirements:** R4, R6, R7, R8, R19, R20 (empty state), R21 (loading/error).

**Dependencies:** Unit 5.

**Files:**
- Create: `frontend/src/components/summary/MemberConsumptionTable.tsx`
- Create: `frontend/src/components/summary/MemberConsumptionTable.test.tsx` (optional; component tests are not yet established in the repo — establish only if useful)

**Approach:**
- Props: `response: GroupSummaryResponse`, `currentUserId: number | null` (null on public path, but this component is member-only in v1).
- Row layout: member display name on the left, total amount (via `formatMoney`) on the right. Managed-member children appear as indented sub-rows on expand; use a small `+/−` indicator consistent with the existing collapsible-section pattern. Because row-level disclosure inside a list is a distinct ARIA pattern from the section-level collapsible, each row's toggle button must carry its own `aria-expanded` and `aria-controls` pointing to the sub-row container id. Keep keyboard focus on the toggle when the row expands/collapses.
- Sort: current user first (by `currentUserId`), then descending by `total`.
- Header: group total + granularity label ("Weekly", "Monthly", "Quarterly") + the "One or more historical exchange rates were synthesized from current data" note (only when `response.has_synthesized_historical_rate`).
- Empty state: when `response.members` is empty, render the R20 copy: "No spending yet — add an expense to see the summary."
- Loading and error states are held by the parent (`SummarySection`); this component renders only when data is present.

**Patterns to follow:**
- `frontend/src/GroupDetailPage.tsx:182-184` — "You first" sort pattern.
- `frontend/src/GroupDetailPage.tsx:212-215` — existing managed-member breakdown subtext.
- `frontend/src/utils/formatters.ts` — `formatMoney` usage.
- Existing Tailwind dark-mode classes from the Balances card (`bg-white dark:bg-gray-800`, `border-t dark:border-gray-700`).

**Test scenarios:**
- Happy path: given a response with 3 members, renders 3 rows in descending order by total.
- Happy path: when a `currentUserId` matches a member, that row is pinned first regardless of total.
- Happy path: when `has_synthesized_historical_rate` is true, the estimated-rates note is visible.
- Edge case: a member with a `managed_members` array renders a collapsed expansion affordance by default.
- Edge case: tapping the expansion affordance reveals the managed-member sub-rows; tapping again collapses.
- Edge case: empty `members` renders the R20 empty-state copy.
- Edge case: `has_synthesized_historical_rate` false → note is not rendered.

**Verification:**
- Manual eyeball on desktop and phone-width viewports, light and dark mode.
- `npm run test` passes if component tests are included.

---

- [ ] **Unit 8: `SpendingTrendChart` component with visx (stacked + single-series modes)**

**Goal:** Render the time-trend bar chart. Two modes via prop: `mode: "stacked"` (authenticated, per-member segments) and `mode: "single"` (public, group total per period). Both share axes, responsive sizing, tooltip, legend (stacked mode only), and a visually-hidden `<table>` fallback for screen readers.

**Requirements:** R9, R12, R13, R14, R15 (single-series mode only).

**Dependencies:** Units 5 and 6.

**Files:**
- Create: `frontend/src/components/summary/SpendingTrendChart.tsx`
- Create: `frontend/src/components/summary/SpendingTrendChart.test.tsx` (optional)
- Create: `frontend/src/components/summary/chartPalette.ts` (8-color palette + overflow gray, deterministic assignment helper)
- Modify: `frontend/src/index.css` (CSS variables for the 8 chart colors with light/dark values)

**Approach:**
- Props: `series: GroupSummarySeriesPoint[]` (stacked) or `PublicGroupSummarySeriesPoint[]` (single), `granularity`, `members?` (stacked only, for palette assignment and legend), `currency`.
- Composition: `<svg role="img" aria-label={summaryText}>` wrapping `<Group/>` → per-period `<Bar/>` segments from `@visx/shape`, axes via `@visx/axis` using scales from `@visx/scale` (`scaleBand` on X, `scaleLinear` on Y).
- Y-axis: start at 0, auto-scale to the global max across all visible periods so bars are comparable. Tick labels formatted via `formatMoney` (abbreviating to k/M above 10,000).
- Empty periods (R13): render zero-height bars so the axis stays continuous; tick labels still render.
- Tooltip: tap/hover on a bar (or segment in stacked mode) shows `{ period_label, ...amounts }`. Minimum 44 px tap target; position tooltip above the bar by default and flip to below at the top of the chart.
- Legend (stacked mode only): list members with their assigned color. On viewports `< 640px`, render below the chart as a 2-column wrapped grid. For groups with more members than the palette supports, collapse overflow into a single `"Others"` segment and legend entry.
- Color assignment: deterministic by `members`' order as returned by the server (server sorts by `total` descending; apply the palette in that order). CSS variables allow instant dark-mode swap.
- A11y fallback: a visually-hidden `<table>` with columns `(period, total)` in single mode and `(period, member, amount)` in stacked mode. Use `sr-only` Tailwind utility.

**Patterns to follow:**
- visx SVG output + CSS-variable `fill` attribute for dark-mode theming.
- `frontend/src/utils/formatters.ts` — `formatMoney`.

**Test scenarios:**
- Happy path: renders one visible bar per period in `series`.
- Happy path (stacked): a 3-member, 4-period response renders 4 bars, each composed of up to 3 stacked segments.
- Happy path (single): a 4-period response renders 4 single-color bars.
- Edge case: a period with `total === 0` still renders a tick label on the X axis (bar has zero height).
- Edge case: `granularity === "quarter"` produces tick labels like "2026-Q2" (not raw date strings).
- Edge case: the hidden `<table>` sibling contains one row per period (single mode) or one row per (period, member) pair (stacked mode).
- Edge case: groups with > 8 members collapse the overflow into a single `"Others"` segment and legend entry.
- Integration (manual): tapping a bar (simulated via user-event in a real browser) triggers the tooltip and announces the amount to an `aria-live` region or via the `<table>` fallback — verify during manual QA since this is an interaction + live-region behavior better covered by hand than by vitest/jsdom.
- Edge case (manual, dark mode): when the theme toggles, SVG fills update via CSS variables without component remount — verify by toggling theme in the running dev server; jsdom does not implement the CSS cascade.

**Verification:**
- Manual eyeball on desktop and phone viewports, light and dark mode.
- Screen-reader spot check: the hidden table is read out correctly.

---

- [ ] **Unit 9: Wire `SummarySection` into `GroupDetailPage` (authenticated and public paths)**

**Goal:** Add the third collapsible section, compose `MemberConsumptionTable` + `SpendingTrendChart`, fetch data on expand, handle loading and error states. Render the narrower public variant when rendered in a public-share context.

**Requirements:** R1, R2, R20, R21, and wires up everything from Units 7 and 8.

**Dependencies:** Units 5, 7, 8.

**Files:**
- Create: `frontend/src/components/summary/SummarySection.tsx`
- Modify: `frontend/src/GroupDetailPage.tsx` (render `<SummarySection>` as the **last** collapsible section on the page. Current order in the file is Expenses → Balances → Members; the new Summary section goes after Members. Pass `shareLinkId` prop when in public mode.)

**Approach:**
- Section shell mirrors the Balances card pattern: same outer classes, toggle button with `aria-expanded`/`aria-controls`, `+/−` indicator, expansion state held locally (`isSummaryExpanded`).
- Data fetch on first expansion (not on mount) to avoid paying the aggregation cost for users who never expand the section. Cache the result in component state for the session.
- Auth path: call `groupsApi.getSummary(groupId)` → render `MemberConsumptionTable` + `SpendingTrendChart mode="stacked"`.
- Public path: call `groupsApi.getPublicSummary(shareLinkId)` → render only the group-total header + `SpendingTrendChart mode="single"`. No `MemberConsumptionTable`.
- Loading state: skeleton rows + a pulsing axis placeholder.
- Error state: inline message with a retry button that re-invokes the fetch.
- Empty state (`response.members` empty on auth, `response.series` empty on both): render the R20 copy.

**Execution note:** Manually test at narrow viewport widths and in dark mode before declaring done (per project convention).

**Patterns to follow:**
- Collapsible-section pattern at `frontend/src/GroupDetailPage.tsx:846-929`.
- Error/loading pattern already used on the Balances section.

**Test scenarios:**
- Happy path (auth): expanding the section triggers `getSummary` once; data renders table + stacked chart.
- Happy path (public): expanding the section triggers `getPublicSummary`; renders group-total + single-series chart. `MemberConsumptionTable` is not rendered.
- Edge case: collapsing and re-expanding does not re-fetch within the session.
- Error path: a 500 from the API shows the error message and a retry button.
- Integration: the collapsible section participates in the page's existing dark-mode theming.

**Verification:**
- Smoke-test the full user path in both authenticated and public-share modes, on desktop and at phone width, in light and dark mode. Confirm that (a) totals match the Balances tab for the same group, (b) public view shows only the group total and a single-series chart with no names or per-member data, (c) expansion and collapse feel consistent with the existing Balances/Expenses sections.

## System-Wide Impact

- **Interaction graph:** new routes `GET /groups/{group_id}/summary` (auth) and `GET /groups/public/{share_link_id}/summary` (public). New shared primitive `calculate_consumption_summary`. Refactor of managed-member folding into `_fold_managed_relationships` touches `calculate_net_balances` as a no-op refactor.
- **Error propagation:** authz failures propagate via `verify_group_membership` (403); group-not-found via `get_group_or_404` (404); public share-link-not-found or not-public via inline check (404); rate-limit exceeded via the limiter dependency (429).
- **State lifecycle risks:** none — the feature is read-only. No cache invalidation, no background jobs.
- **API surface parity:** existing `/groups/{id}/balances` and `/public/{share_link_id}/balances` are unchanged. Frontend `offlineApi` does not need to handle the new endpoints in v1 (direct call only).
- **Integration coverage:** reconciliation tests between the new summary endpoint and the existing `/balances` endpoint prove the managed-member folding is symmetric — this is the single most important integration scenario.
- **Unchanged invariants:** `calculate_net_balances` return shape and semantics. Existing `/public/*` endpoints' auth and rate-limit posture. Every other user-facing path in `GroupDetailPage.tsx`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Refactoring `calculate_net_balances` to use the new fold helper silently changes Balances behavior | Unit 1 is a pure refactor with characterization coverage; run the full test_balances suite before and after. No net-balance tests should change. |
| Settlement-exclusion change in consumption primitive leaks into Balances by accident | The filter lives only in `calculate_consumption_summary`; add an explicit test asserting `calculate_net_balances` still includes settlements (if that matches its current behavior) to pin the divergence intentionally. |
| Large groups with many members + long spans stress the public endpoint under viral-link traffic | 60s in-memory TTL cache keyed by `share_link_id` (Unit 4) plus the per-IP rate limit. Cache absorbs viral traffic and neutralizes most IP-spoof amplification. |
| `X-Forwarded-For` trust bypass — existing rate limiter trusts header unconditionally (`backend/utils/rate_limiter.py:20-22`) | Out-of-scope for this feature. Assumes deployment behind a trusted reverse proxy that strips/rewrites the header. Filed as a separate follow-up; documented in Non-goals. |
| visx bundle creeps above the 60 KB budget over time | Unit 6 verifies the initial size; add a CI check (or a one-off `npm run build` verification) to note the production bundle delta and fail the unit if it exceeds 60 KB gzipped. |
| Three-tier bucketing feels wrong on real data (e.g. monthly collapses a 2-week trip) | The 3-tier heuristic is keyed off the group's active span, not the viewer's current date — reruns reshape only when new expenses land outside the current range. If real usage shows the heuristic picks poorly, the granularity math lives in one function (Unit 2) and is easy to tune. |
| Dark-mode color contrast issues with 8-color palette | Palette is defined as CSS variables with explicit light and dark values; spot-check with a contrast checker on both backgrounds before Unit 8 is declared verified. |

## Phased Delivery

### Phase 1 — Unit 1 alone (refactor)

Ship `_fold_managed_relationships` extraction as its own PR. Zero behavior change; characterization coverage on `calculate_net_balances` both modes (single-currency scalar and multi-currency dict-of-dicts). Let it deploy and observe at least one production cycle for any regressions on the Balances tab.

### Phase 2 — Units 2–4 (backend)

Once Phase 1 is stable, build the aggregation primitive, authenticated endpoint, and public endpoint (with cache and rate limiter). Land as one PR or tight series of PRs with full test coverage before any frontend work.

### Phase 3 — Units 5–9 (frontend)

Types, API client, visx install, components, page wiring. Can be one PR or split by component.

Splitting Unit 1 from the rest limits the blast radius if a managed-member edge case regresses Balances.

## Documentation / Operational Notes

- After Phase 3 ships, consider starting `docs/solutions/` with an entry on the first charting library and the three-tier bucketing heuristic (both are first-in-codebase decisions worth preserving for future features).
- Update `docs/FEATURES.md` with a brief mention of the Summary section and the public-link narrowing rule.
- No migration, no feature flag. The three-phase deploy above is the rollback boundary; Phase 1 is independently reversible.
- **Three-tier bucketing validation**: during Phase 2 implementation, eyeball the granularity choice against the current production group-age distribution (how many groups fall in each tier?). If real data shows the heuristic fails for a meaningful slice, tune the thresholds or add a user toggle before Phase 3 ships. Document the observed distribution in a comment on the granularity function.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-17-group-spending-summary-requirements.md](../brainstorms/2026-04-17-group-spending-summary-requirements.md)
- Related code: `backend/routers/balances.py`, `backend/utils/balances.py`, `backend/utils/validation.py`, `backend/utils/rate_limiter.py`, `backend/routers/groups.py`, `backend/main.py`, `backend/schemas.py`, `backend/tests/conftest.py`, `backend/tests/test_balances.py`, `frontend/src/GroupDetailPage.tsx`, `frontend/src/services/api.ts`, `frontend/src/types/balance.ts`, `frontend/src/utils/formatters.ts`, `frontend/src/ThemeContext.tsx`.
- External docs: [airbnb/visx](https://airbnb.io/visx/), [@visx/shape](https://www.npmjs.com/package/@visx/shape), [@visx/scale](https://www.npmjs.com/package/@visx/scale), [@visx/axis](https://www.npmjs.com/package/@visx/axis).
