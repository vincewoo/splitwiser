# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Splitwiser is a Splitwise clone for expense splitting among friends and groups. Key features: multi-currency support (USD, EUR, GBP, JPY, CAD, CNY, HKD, CHF), various split types (equal, exact, percentage, shares, itemized), LLM-based receipt scanning, debt simplification, guest/member management, dark mode, refresh token auth, email notifications via Brevo, PWA with offline support, and mobile-optimized UI.

## Architecture

### Backend (FastAPI + SQLAlchemy)

**Main Application:**
- `backend/main.py` - FastAPI app initialization and router registration
- `backend/models.py` - SQLAlchemy models: User, Group, GroupMember, Friendship, Expense, ExpenseSplit, GuestMember, RefreshToken, ExpenseItem, ExpenseItemAssignment, Tab, TabItem, TabParticipant, TabItemClaim
- `backend/schemas.py` - Pydantic schemas for request/response validation
- `backend/auth.py` - JWT token creation and password hashing
- `backend/database.py` - SQLite database configuration
- `backend/dependencies.py` - Shared FastAPI dependencies (auth, database session)

**Routers (Modular API Endpoints):**
- `backend/routers/auth.py` - Authentication (login, register, refresh tokens, logout, password reset, email change)
- `backend/routers/groups.py` - Group CRUD, public share links
- `backend/routers/members.py` - Member and guest management, claiming
- `backend/routers/expenses.py` - Expense CRUD, split calculations
- `backend/routers/balances.py` - Balance calculations, debt simplification
- `backend/routers/friends.py` - Friend management, friend request emails
- `backend/routers/ocr.py` - LLM-based receipt scanning endpoint
- `backend/routers/summary.py` - Summary endpoint
- `backend/routers/exports.py` - CSV balance sheet export (members only)
- `backend/routers/tabs.py` - Tabs: owner surface plus the public claim surface

**Utilities:**
- `backend/utils/currency.py` - Exchange rate fetching (Frankfurter API), caching
- `backend/utils/validation.py` - Split validation, participant verification
- `backend/utils/splits.py` - Split calculation logic (equal, exact, percentage, shares, itemized)
- `backend/utils/display.py` - Display name helpers for guests and claimed users
- `backend/utils/guest_merge.py` - Folding a guest's history onto a user id, shared by claiming and owner-driven merging; sums colliding splits so one person never ends up twice on one expense
- `backend/utils/email.py` - Brevo API email service for transactional emails
- `backend/utils/summary.py` - Consumption aggregation primitive
- `backend/utils/balance_sheet.py` - The settlement calculation as an auditable chain: item allocation, conversion, management folding, netting, simplification, plus self-checks that pin it against `/groups/{id}/balances`
- `backend/utils/csv_export.py` - Sectioned CSV rendering, with the spreadsheet-formula guard and cents/decimal columns
- `backend/utils/summary_cache.py` - Bounded in-memory TTL cache for public summary
- `backend/utils/tabs.py` - Tab share computation (orphan spreading, proportional tax/tip)

**Receipt Scanning:**
- `backend/ocr/llm_service.py` - LLM vision-based receipt parsing (image or PDF) with structured output

**Database Migrations:**
- `backend/migrations/` - Migration scripts with helper tools
- See `backend/migrations/README.md` for detailed migration documentation

### Frontend (React + TypeScript + Vite)

**Core Components:**
- `frontend/src/App.tsx` - Main app with Dashboard, routing, protected routes
- `frontend/src/AuthContext.tsx` - Authentication with automatic token refresh
- `frontend/src/ThemeContext.tsx` - Dark mode with localStorage persistence
- `frontend/src/routes/GroupPage.tsx` - Group detail: expenses, balances, spending, people
- `frontend/src/ExpenseDetailModal.tsx` - Expense viewing/editing with notes
- `frontend/src/AddExpenseModal.tsx` - Expense creation (5 split types)

**Services & Types:**
- `frontend/src/services/api.ts` - Centralized API client with auth handling
- `frontend/src/services/offlineApi.ts` - Offline API wrapper using IndexedDB
- `frontend/src/services/syncManager.ts` - Background sync manager for PWA
- `frontend/src/db/schema.ts` - IndexedDB schema for offline storage
- `frontend/src/types/` - TypeScript definitions (group.ts, expense.ts, balance.ts, friend.ts, summary.ts, tab.ts)
- `frontend/src/utils/formatters.ts` - Money, date, and name formatting
- `frontend/src/utils/expenseCalculations.ts` - Frontend split calculations
- `frontend/src/utils/tabShares.ts` - Live preview of tab shares, plus the itemized per-person breakdown behind each total; TS port of `backend/utils/tabs.py`
- `frontend/src/utils/venmo.ts` - Venmo deeplink builder for settle up (USD only), plus the note explaining a currency it cannot send
- `frontend/src/components/VenmoButton.tsx` - the hand-off itself, shared by every settle-up surface: a real link that upgrades a plain click to the installed app

**Feature Components:**
- `frontend/src/ReceiptScanner.tsx` - LLM-based receipt scanning (upload → AI scan → review items)
- `frontend/src/components/ReceiptViewer.tsx` - the scanned bill itself: a thumbnail that expands to full size in place, with a fit/actual-size toggle. Shared by the expense detail modal, the desktop expense pane and both tab boards; PDFs are offered as a link since they cannot go in an `<img>`
- `frontend/src/components/expense/ExpenseItemList.tsx` - Itemized expense UI with per-item splits
- `frontend/src/components/group/GroupPersonSheet.tsx` - Per-person actions in a group: claim a guest, merge a guest into a member's account (owner only), fold a balance into a manager, remove, send a friend request
- `frontend/src/components/AddPersonSheet.tsx` - Add a friend by email
- `frontend/src/hooks/useBalanceSheetExport.ts` - Downloads the balance sheet CSV; owns the blob URL lifecycle and refuses while offline, since the sheet is server-computed and a cached one would be stale
- `frontend/src/hooks/useOpenExpense.ts` - Opens the expense detail modal from a feed row, loading group context in the background
- `frontend/src/components/tab/OpenTabsList.tsx` - Open tabs as re-entry rows; on the home page and Activity
- `frontend/src/hooks/useItemizedExpense.ts` - Itemized expense state management
- `frontend/src/components/summary/SummarySection.tsx` - Spending summary (consumption, not balances)
- `frontend/src/components/summary/MemberConsumptionTable.tsx` - Per-member rows
- `frontend/src/components/summary/SpendingTrendChart.tsx` - Stacked bar chart (visx)
- `frontend/src/routes/TabBoardPage.tsx` - Host's view of a live tab (mobile list / desktop two-pane)
- `frontend/src/routes/TabClaimPage.tsx` - `/t/:shareToken`; no auth, no shell
- `frontend/src/routes/TabPassPage.tsx` - Pass-the-phone claiming for a table with no other devices; signed in but outside the shell
- `frontend/src/components/tab/OpenTabSheet.tsx` - Naming the venue and setting the tip, the last step before a scanned bill becomes a tab
- `frontend/src/components/tab/WhoPaidSheet.tsx` - Who fronted the bill, including somebody with no Splitwiser account, plus the Venmo handle the claim page needs to reach them
- `frontend/src/components/tab/TabAmountsSheet.tsx` - Correcting a live tab's tax and tip; the scan is a convenience, not the authority
- `frontend/src/components/tab/` - Receipt paper, item × person matrix, QR, progress
- `frontend/src/components/tab/TabBreakdown.tsx` - What each person owes and why (their items, unclaimed share, tax and tip); used on the board, the close screen, the claim page and the expense detail modal

**PWA Support:**
- `frontend/public/manifest.json` - PWA manifest for installable app
- Service worker for offline caching and background sync

### Key Patterns
- Money stored in cents (integer) to avoid floating-point issues
- Balance calculation: positive = owed to you, negative = you owe
- Debt simplification converts all currencies to USD using cached exchange rates
- Historical exchange rates cached at expense creation (Frankfurter API)
- Guest users support claiming (merge history), owner-driven merging onto a named account, and management (balance aggregation)
- Registered members can also be managed for balance aggregation
- Refresh tokens stored hashed (SHA-256) in database with server-side revocation
- Itemized expenses use proportional tax/tip distribution. `utils/splits.py::allocate_items` is the single implementation: the write path collapses it to one total per person, the balance sheet keeps the per-line detail including which person absorbed the remainder cents
- Settling up can hand off to Venmo (app scheme first, https fallback) with the amount pre-filled; it never marks anything paid, since there is no callback. Offered on every surface that settles a specific debt — `/settle`, a group's Simplify Debts, a person's Settle up, the overview's "Clear it in N payments" — but only for debts the signed-in user is party to
- Tabs are share-link bills with no group: high-entropy expiring write tokens, anonymous claimers held by their own claim token, signed-in claimers seated as their account so the closed tab becomes a real shared expense, unclaimed lines spread across everyone at close. A claimer can Venmo the host straight from the claim page — the surface where the hand-off matters most, since they often owe somebody they have no other way to pay
- Receipt uploads (images and PDFs) stored in `data/receipts/` directory (configurable via `DATA_DIR` env var); PDFs are rasterized per-page for the LLM but the original file is preserved. Served from `/static/receipts/`, which reaches the browser as `/api/static/receipts/` — so the service worker's navigation fallback must keep its hands off `/api/` (see `navigateFallbackDenylist` in `frontend/vite.config.ts`)

## Development Commands

### Backend
```bash
cd backend
source venv/bin/activate  # Activate virtual environment
pip install -r requirements.txt  # Install dependencies
uvicorn main:app --reload  # Run dev server on http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install  # Install dependencies
npm run dev  # Run dev server (Vite)
npm run build  # Build for production (tsc + vite build)
npm run lint  # Run ESLint
```

### Testing

Backend (pytest, in-memory SQLite — no external services are contacted):
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt  # test deps are in requirements-dev.txt
pytest tests/                              # Run the whole suite
pytest tests/test_expenses.py              # Run one file
pytest tests/test_main.py::test_create_user -v  # Run a single test
pytest tests/ --cov=. --cov-report=term-missing # With coverage
```

Frontend (Vitest):
```bash
cd frontend
npm run test        # Run once
npm run test:watch  # Watch mode
```

Test layout:
- `backend/tests/test_utils_*.py` — unit tests for pure logic (split maths,
  validation, currency, display names, dates). No HTTP, no network.
- `backend/tests/test_*.py` (others) — integration tests driving the real
  FastAPI app through `TestClient` against a per-test in-memory database.
- `backend/tests/test_performance_*.py` / `test_perf_*.py` — query-count
  regression guards.
- `frontend/src/**/__tests__/` — colocated tests: pure-logic unit tests for
  utilities and hooks, plus React Testing Library component tests
  (e.g. `AddExpenseModal.groupMembers.test.tsx`, `ReceiptScanner.test.tsx`).

Conventions:
- Tests must not depend on execution order. Install FastAPI dependency
  overrides via the `app_overrides` fixture rather than mutating
  `app.dependency_overrides` directly, and never rebind that attribute — `app`
  is a process-wide singleton and a leaked override silently authenticates
  later tests as the wrong user.
- Outbound calls (Frankfurter exchange rates, Brevo email, LLM receipt
  scanning) are mocked; the suite runs offline.

### Linting

```bash
cd frontend
npm run lint      # report everything
npm run lint:ci   # what CI runs: fails on any error, or >19 warnings
```

The codebase is free of ESLint errors and of `any`. Two rules are set to
`warn` in `eslint.config.js` because their remaining violations need
structural changes rather than local edits — see the comments there for the
reasoning:
- `react-hooks/set-state-in-effect` (fetch-on-mount, reset-modal-on-open)
- `react-refresh/only-export-components` (context modules, app entry point)

Those plus `react-hooks/exhaustive-deps` make up the 19 accepted warnings.
`lint:ci` caps the count so the backlog cannot grow; lower the ceiling in
`package.json` as warnings are worked off.

### Backend static analysis

```bash
cd backend
source venv/bin/activate
ruff check .            # lint (config: backend/ruff.toml)
ruff check . --fix      # apply safe autofixes
pip-audit -r requirements.txt -r requirements-dev.txt  # dependency CVEs
```

Ruff runs a deliberately scoped starter set (`E4/E7/E9`, `F`, `I`, `B`,
`RUF`) that the codebase holds at zero. `SIM` and `UP` are the natural next
additions — see the comments in `ruff.toml` for what enabling them costs.
Three ignores are framework requirements rather than style preferences, most
importantly `E711`/`E712`: SQLAlchemy compiles `== None` / `== False` into
SQL, and rewriting them to `is None` / `is False` silently breaks the query.

`pip-audit` currently ignores PYSEC-2026-1325 in `ecdsa` (pulled in by
python-jose). Upstream ships no fix, and it is unreachable here because JWTs
use HS256 only — revisit if `auth.ALGORITHM` ever becomes an EC curve. The
reasoning is recorded in `.github/workflows/audit.yml`.

### Continuous integration

CI runs on Python 3.11 / Node 20, matching the production image:
- `.github/workflows/_tests.yml` — the reusable check definition (backend
  tests, backend ruff, frontend tests, frontend eslint). Edit this to change
  how the checks run; it is never triggered on its own.
- `.github/workflows/tests.yml` — calls it for pull requests into `main`.
- `.github/workflows/deploy.yml` — calls it as a gate before deploying to
  Fly.io, so a push to `main` (or a manual deploy of another branch) only
  ships when all four checks pass on that exact ref.
- `.github/workflows/audit.yml` — `pip-audit`, on dependency-file changes and
  weekly. Kept out of the deploy gate on purpose: a CVE disclosed upstream
  should not block an unrelated hotfix from shipping.

### Database Migrations
When schema changes are made, update the SQLite database:
```bash
cd backend
source venv/bin/activate
python -c "from database import Base, engine; import models; Base.metadata.create_all(bind=engine)"
```

For manual column additions:
```bash
sqlite3 db.sqlite3
ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT 'value';
```

## API Endpoints

### Authentication
- `POST /register` - User registration
- `POST /token` - Login (OAuth2 form: username=email, password)
- `POST /auth/refresh` - Exchange refresh token for new access token
- `POST /auth/logout` - Revoke refresh token
- `GET /users/me` - Current user info
- `POST /auth/forgot-password`, `POST /auth/reset-password` - Password reset flow
- `POST /auth/change-password`, `POST /auth/change-email` - Account changes

### Groups
- `GET /groups` - List groups (`schemas.Group`): **no `members`/`guests` fields at all.** Use for name/currency/icon only
- `GET /groups/{group_id}` - Full group (`schemas.GroupWithMembers`): the only endpoint that returns `members` and `guests`
- `POST /groups`, `PUT /groups/{group_id}`, `DELETE /groups/{group_id}` - Group CRUD
- `GET /groups/{group_id}/balances` - Get group balances
- `POST /groups/{group_id}/guests` - Add guest member
- `POST /groups/{group_id}/guests/{guest_id}/claim` - Claim guest profile
- `POST /groups/{group_id}/guests/{guest_id}/merge` - Fold a guest onto a named account already in the group — the fix for someone who joined as themselves instead of taking the guest's seat. Group owner only, except onto your own account (which is `claim`)
- `POST /groups/{group_id}/guests/{guest_id}/manage` - Link guest to manager

### Expenses
- `POST /expenses`, `GET /expenses`, `GET /expenses/{expense_id}`, `PUT /expenses/{expense_id}`, `DELETE /expenses/{expense_id}` - Expense CRUD
- Split types: EQUAL, EXACT, PERCENTAGE, SHARES, ITEMIZED
- The detail response carries `tab_id` when the expense is what a closed tab
  resolved into, and only for that tab's owner — see `docs/TABS.md`

### Friends
- `POST /friends`, `GET /friends` - Friend management
- `POST /friends/request` - Send friend request email

### Public Access
- `GET /public/groups/{share_link_id}` - Get group via public link (no auth)
- `GET /public/groups/{share_link_id}/expenses/{expense_id}` - Get expense via public link

### Balances & Currency
- `GET /balances` - User balance summary across all groups
- `GET /simplify_debts/{group_id}` - Debt simplification, plus a `participants` directory (display name + Venmo handle) for the ids in it
- `GET /exchange_rates` - Current exchange rates

### OCR
- `POST /ocr/scan-receipt` - Upload a receipt image (JPEG/PNG/WebP) or PDF (up to 10 pages, treated as one receipt), get LLM-extracted items with prices

### Exports
- `GET /groups/{group_id}/balance_sheet.csv` - The group's settlement maths as a sectioned CSV: expenses with itemized lines nested under their parent, the stored splits they reconcile against, currency conversion, management folding, net balances, the simplified transactions, and a CHECKS block stating whether it all reconciles. Members only — no public share-link variant, since the sheet states everyone's full position

### Summary
- `GET /groups/{group_id}/summary` - Per-member consumption totals, group total, time-bucketed series (authenticated members)
- `GET /groups/public/{share_link_id}/summary` - Narrower version for public share-link viewers (group total + single-series chart only)

### Tabs
A tab is a one-off bill people claim their own items from via a link — no group, nobody to invite. See `docs/TABS.md`.

Owner (authenticated):
- `POST /tabs`, `GET /tabs`, `GET /tabs/{tab_id}` - Open, list, read
- `POST /tabs/{tab_id}/items`, `DELETE /tabs/{tab_id}/items/{item_id}` - Lines the scan missed; deleting drops the line's claims
- `PATCH /tabs/{tab_id}/amounts` - Correct the tax or the tip while the tab is open; `total` follows, and a closed tab is refused
- `POST /tabs/{tab_id}/participants` - Seat somebody with no phone of their own; a guest seat, same name rules as joining. Takes an optional `venmo_username`, for a seat that is going to be owed money
- `PATCH /tabs/{tab_id}/participants/{participant_id}` - Tick somebody off as settled, or give an account-less seat a Venmo handle; still writable after close
- `POST /tabs/{tab_id}/payer` - Name the seat that fronted the bill while the tab is open; it need not have an account
- `POST /tabs/{tab_id}/items/{item_id}/claim` - Claim as yourself (any signed-in participant)
- `POST /tabs/{tab_id}/items/{item_id}/claim/{participant_id}` - Set anyone's claim (owner only)
- `POST /tabs/{tab_id}/revoke` - Kill the link without closing
- `POST /tabs/{tab_id}/close` - Resolve into one direct expense — or, when the payer has no Splitwiser account, into a plain record with no expense at all, since everyone settles with them outside the app

Public (no auth, rate-limited):
- `GET /public/tabs/{share_token}` - Read the tab, plus `host_name` / `host_venmo_username` so a claimer can Venmo whoever fronted the bill — the only unauthenticated audience for a handle, and the host's alone
- `POST /public/tabs/{share_token}/join` - Join with a name; returns a claim token. Names are unique per tab, so a name already at the table is refused. Optionally authenticated: a signed-in claimer is seated as their account (and can bind it to a seat they already claimed from anonymously), so closing the tab reaches their balances instead of leaving a guest line
- `POST /public/tabs/{share_token}/rename` - Change the name you claim under, keeping your claims; the claim token is unchanged
- `POST /public/tabs/{share_token}/items/{item_id}/claim` - Claim or release, authenticated by `claim_token`

## Key Database Fields

- User: `default_currency`, `venmo_username` (no @; friends and fellow group members, plus the host's on a tab's share link — never on a group's)
- Group: `default_currency`, `icon`, `share_link_id`, `is_public`
- GroupMember: `managed_by_id`, `managed_by_type`
- Expense: `exchange_rate`, `split_type`, `receipt_image_path`, `icon`, `notes`, `payer_is_guest`
- ExpenseSplit: `is_guest`
- GuestMember: `claimed_by_id`, `managed_by_id`, `managed_by_type`
- RefreshToken: `token_hash`, `expires_at`, `revoked`
- ExpenseItem: `description`, `price`, `is_tax_tip`
- ExpenseItemAssignment: `user_id`, `is_guest`
- Tab: `share_token`, `token_expires_at`, `revoked`, `status`, `tax`, `tip`, `total`, `expense_id`, `payer_id` (a user, set at close), `payer_participant_id` (a seat, nameable while open — how an off-app payer is recorded)
- TabItem: `description`, `price`, `added_manually`
- TabParticipant: `display_name` (unique per tab, case-insensitively), `user_id` (null when anonymous; unique per tab otherwise), `claim_token`, `venmo_username` (account-less seats only), `paid` / `paid_at`
- TabItemClaim: `item_id`, `participant_id` (unique together)

## Detailed Documentation

For more detailed information, see the `docs/` directory:
- `docs/FEATURES.md` - Currency features, dark mode, balance grouping, Venmo hand-off
- `docs/AUTHENTICATION.md` - Refresh tokens, email notifications
- `docs/OCR.md` - Receipt scanning system
- `docs/LLM_RECEIPT_SCANNING.md` - LLM-based receipt scanning implementation plan
- `docs/USER_MANAGEMENT.md` - Guest/member management, public links
- `docs/ITEMIZED_EXPENSES.md` - Itemized split algorithm
- `docs/TABS.md` - Tabs: share-link bills, claim tokens, share computation
- `docs/PWA.md` - Progressive Web App, offline support
- `docs/DATABASE.md` - Schema, performance, security
