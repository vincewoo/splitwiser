---
date: 2026-04-17
topic: group-spending-summary
---

# Group Spending Summary

## Problem Frame

Members can already see who owes whom (`/balances`) and every individual expense, but there is no way to answer "how expensive was this group, and how was that cost distributed across members and over time?" Today a user wanting that has to eyeball the expense list or compute it mentally. This feature adds a read-only summary to the group detail page so members (and public-share viewers, at a coarser granularity) can see aggregate consumption plus a time-trend chart.

Read-only. No new expense writes. Surfaces information already implied by existing expenses.

## Requirements

**View placement & access**
- R1. Add a third **collapsible section** on the group detail page, placed after the existing Balances and Expenses sections. The page continues to use the current `isBalancesExpanded` / `isExpensesExpanded` pattern (`frontend/src/GroupDetailPage.tsx:134-135`); this is not a tab-bar migration.
- R2. The section is reachable via the existing public share link with no authentication, but the **public view is narrower than the member view** — see R12 and R15.
- R3. The authenticated endpoint that powers this section requires the requesting user to be a member of the group (use `verify_group_membership`, matching the pattern on the authenticated `/groups/{id}/balances` route).

**Per-member totals**
- R4. For each member, show their **total share of group consumption** — the sum of `ExpenseSplit.amount_owed` across expenses in this group attributed to them, converted to the group's `default_currency`.
- R5. Exclude `Expense.is_settlement = True` transactions from the consumption total — settlements are money moving between members, not group spending. The existing balance primitives in `backend/utils/balances.py` do **not** filter settlements; the summary aggregation must apply this filter itself.
- R6. **Fold managed guests and managed members into their managing user's row**, and render each row as **expandable** — tapping it reveals the breakdown of managed members' individual consumption shares (e.g. `Alice — $240 [tap] → Bob $80, Carol $60, Alice herself $100`). The folded totals must reconcile to how the Balances tab groups the same managed members.
- R7. Sort rows by total consumption **descending**, except pin the current user first regardless of rank (matches the "You first" pattern already in use on the Balances list at `frontend/src/GroupDetailPage.tsx:182-184`).

**Group-level total**
- R8. Show a **single group-level total at the top of the section** (sum across all members, in group currency). This is also exposed on the public share link — see R15.

**Time-trend chart**
- R9. Render a **stacked bar chart** for the authenticated (member) view — one bar per time period, each bar stacked by per-member consumption share. Y-axis is group-currency amount; X-axis is time periods. Colors and folding match R6 (managed members fold into their manager's color).
- R10. Use `Expense.date` (the user-selected ISO date string on each expense) for bucketing. Ignore any server-side timestamps.
- R11. **Auto-select bucket granularity by the group's active span** (earliest to latest `Expense.date` among non-settlement expenses):
  - span < 3 months → bucket by ISO week
  - 3 months ≤ span < 18 months → bucket by calendar month
  - span ≥ 18 months → bucket by calendar quarter
  Granularity is chosen by the server at response time; no user-facing toggle in v1.
- R12. Chart totals must reconcile to the per-member totals (R4) using the same currency conversion and managed-member folding. The chart data is returned in the same response as the table data — one round trip.
- R13. Periods with zero spending are still shown as empty bars between filled ones so the time axis is continuous.
- R14. Minimum chart interaction: tapping a bar (or hovering on wide screens) shows a tooltip with the period label and, for the authenticated view, the per-member breakdown for that period. Tap target ≥ 44 px. Dark-mode colors must remain distinguishable.

**Public share-link exposure**
- R15. The public share-link version of the Summary section shows **only**:
  - The group-level total (R8)
  - A **single-series** bar chart of group-total spending per period (same bucketing as R11, but not stacked by member)
  - An inline rate note if R17 fires
  Per-member rows (R4), managed-member breakdowns (R6), member names, and the stacked segmentation (R9) are **not** exposed on the public endpoint. This is a deliberate privacy tightening over existing public `/balances` parity: the public share link is a forwardable capability URL, and per-member lifetime consumption over time is qualitatively different from settlement-position data.
- R16. The public summary endpoint (`GET /public/{share_link_id}/summary` or equivalent) must ship with a **per-IP rate limit** using the existing `backend/utils/rate_limiter.py` pattern. This is a new precedent for the `/public/*` namespace; extending rate-limiting to the other public share-link endpoints is out of scope here but should be filed as a follow-up.

**Currency handling**
- R17. All amounts are displayed in the group's `default_currency`. Conversion uses the same two-leg path as `/balances` today: historical expense-currency → USD via each expense's stored `Expense.exchange_rate`, then static USD → group currency via `convert_currency` in `backend/utils/currency.py`. This is a **hybrid** policy (leg 1 historical, leg 2 static); it is intentional because it guarantees consistency with the Balances tab for the same expenses. Do not fetch new rates or change `/balances`.
- R18. If an expense is missing `Expense.exchange_rate` (legacy data), fall back to the current static rate for both legs. Do not silently drop the expense. This matches the fallback path already in `backend/utils/balances.py:64-67`.
- R19. If R18's legacy-fallback path is triggered for any expense contributing to the visible totals, show a non-blocking inline note in the section header (e.g. "Some amounts use estimated exchange rates"). Same note visible to authenticated and public viewers.

**Empty / edge states**
- R20. If the group has no non-settlement expenses, show an empty state: "No spending yet — add an expense to see the summary." The same copy must handle the settlement-only edge case (a group where every expense is `is_settlement=True`) rather than implying the user hasn't added anything.
- R21. If only a single period of data exists (e.g. a brand-new group with one expense), render the single bar without any degenerate trend-line UI; the per-member totals table remains the primary read. Loading/error states (skeleton + retry) must exist for both the table and the chart.

## Success Criteria

- A member opening the Summary section can answer "how much did each of us consume in this group?" in under 5 seconds without doing any math.
- A member can eyeball whether group spending is accelerating, steady, or tailing off over the group's lifetime, and which member(s) are driving recent change, without leaving the section.
- Per-member totals and chart totals reconcile to each other and to the Balances tab: manager rows include their managed members' consumption, currency conversion uses the same two-leg hybrid path, and Summary figures never contradict Balances.
- A public share-link viewer sees the group-level total and a single-series trend chart — no member names, no per-member breakdowns, no stacked segmentation.
- The Summary section is read-only; nothing on it writes expenses, edits splits, or changes balances.

## Scope Boundaries

- **Read-only.** No edits, no expense creation, no categorization.
- **No categories / tags.** Splitwiser has no expense categories; this feature does not introduce them.
- **No date-range filter.** The view always represents the entire group lifetime; bucketing adapts (R11).
- **No user-facing week/month toggle.** Granularity is auto-selected (R11).
- **No CSV / export.**
- **No IA migration to tabs.** R1 adds a collapsible section. A page-level tab redesign is out of scope.
- **No re-implementation of balance logic.** The feature consumes or shares `backend/utils/balances.py` primitives, extended to produce per-member consumption totals and per-period buckets rather than net balances. The existing `/balances` endpoint's return shape is unchanged.
- **No changes to `/balances` or other `/public/*` endpoints.** R16's rate-limit precedent applies only to the new summary endpoint.
- **No `total paid` column.** Dropped from scope: no named user question answered by it that Balances doesn't already answer.

## Key Decisions

- **Headline metric is consumption, not paid.** Answers the user's framing: "how expensive was this group once everything's settled?"
- **Exclude settlements.** Including them would double-count money already accounted for and distort "spending."
- **Fold managed members, but make the row expandable.** Keeps the top-line number reconciled with Balances while letting users see "who actually consumed what" on demand.
- **Stacked-per-member chart for members, single-series for public.** Members get the richer view the primary question demands; public viewers get the "how expensive over time?" signal without any per-member disclosure. Resolves the public-share privacy concern without sacrificing the member-side value.
- **Three-tier auto-bucketing (week / month / quarter).** Prevents long-lived household groups from rendering 48+ monthly bars while still giving trip groups weekly resolution. Keyed off expense-span, not group-creation date, so dormant-then-active groups still get sensible granularity.
- **Hybrid currency path is intentional.** Fully historical conversion would diverge from how `/balances` has always worked; the two views have to agree, so we match the existing path and document the hybrid explicitly.
- **Third collapsible section, not a new tab.** Current page uses collapsible sections; adding a tab bar would be an IA migration outside this feature's scope.
- **Per-IP rate limit on the public endpoint.** First precedent on the `/public/*` namespace, but the new endpoint is the most expensive public route (full expense scan + currency conversion + time bucketing), so a limiter is load-bearing for stability.

## Dependencies / Assumptions

- Assumes the `backend/utils/balances.py` aggregation can be **extended** (or a sibling primitive added) to produce (a) per-member consumption (sum of `ExpenseSplit.amount_owed` per member, settlements filtered, managed-member folding reused) and (b) per-period bucket sums. The existing primitive returns *net* balances and doesn't filter settlements; this is the concrete extension required.
- Assumes endpoint shape (e.g. new `GET /groups/{id}/summary` + `GET /public/{share_link_id}/summary`, or extending `/balances` with optional aggregate fields) is a planning decision. Whichever is chosen, the public response must be strictly narrower than the authenticated one (see R15).
- Assumes adding a charting library is acceptable. None exists today in `frontend/package.json`. This is the first charting primitive in the codebase — treat the choice as a trajectory commitment, not a throwaway detail.
- Assumes `Expense.exchange_rate` is populated for most currency-mismatched expenses. R18 handles the legacy-missing case; if production data has a large fraction of nulls, a one-time backfill may be a reasonable prerequisite (see Outstanding Questions).
- Assumes the per-IP rate-limiter implementation in `backend/utils/rate_limiter.py` can be applied to a public-share route unchanged.

## Outstanding Questions

### Resolve Before Planning
_None — all product and scope decisions are resolved._

### Deferred to Planning
- [Affects R4–R9,R15][Technical] Endpoint shape — new `/groups/{id}/summary` + `/public/{share_link_id}/summary`, or extensions to `/balances` with optional fields. Public variant must return a strictly smaller response than the authenticated one (R15).
- [Affects R9][Needs research] Charting library choice (`recharts`, `visx`, `chart.js`, or hand-rolled SVG) — weigh against PWA precache size (`vite-plugin-pwa`), dark-mode theming, stacked-bar + tooltip ergonomics, and keyboard/screen-reader a11y. Set a bundle-size budget as part of the decision.
- [Affects R11][Technical] Timezone policy for week/month/quarter bucket boundaries. `Expense.date` is a plain ISO date string (no TZ). Planning should pick one of: bucket in UTC, viewer-local, or group-creator-local, and state the choice explicitly — there is no "correct" answer, only a documented convention.
- [Affects R14][Technical] Per-member color palette for the stacked chart — deterministic assignment (e.g. by member join order) from a fixed palette, with a single "Others" gray for groups with more members than the palette supports. Must remain distinguishable in both light and dark mode.
- [Affects R14][Technical] Chart accessibility — at minimum a `role=img` summary label and a visually-hidden data table fallback for screen reader users; keyboard navigation per bar segment is desirable.
- [Affects R16][Technical] Rate-limit budget for `GET /public/{share_link_id}/summary`. Existing limiters in `backend/utils/rate_limiter.py` use tuned per-endpoint limits (auth 5/min, OCR 5/min). Public summary is expensive per-call; 30/min/IP is a reasonable starting point. Consider a short server-side response cache (TTL ~60s keyed by share_link_id) if load turns out to be a concern.
- [Affects R18][Needs research] How many production expenses are missing `exchange_rate`? If large, consider a backfill task so R19's "estimated rates" note doesn't fire on nearly every group.

## Next Steps

-> `/ce:plan` for structured implementation planning.
