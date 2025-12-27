# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Splitwiser is a Splitwise clone for expense splitting among friends and groups. It features multi-currency support with historical exchange rate caching, various split types (equal, exact, percentage, shares, itemized), OCR receipt scanning with Google Cloud Vision, group-level currency management, debt simplification, guest user management, dark mode, and refresh token authentication.

## Architecture

### Backend (FastAPI + SQLAlchemy)

**Main Application:**
- `backend/main.py` - FastAPI app initialization and router registration
- `backend/models.py` - SQLAlchemy models: User, Group, GroupMember, Friendship, Expense, ExpenseSplit, GuestMember, RefreshToken, ExpenseItem, ExpenseItemAssignment
- `backend/schemas.py` - Pydantic schemas for request/response validation
- `backend/auth.py` - JWT token creation and password hashing
- `backend/database.py` - SQLite database configuration
- `backend/dependencies.py` - Shared FastAPI dependencies (auth, database session)

**Routers (Modular API Endpoints):**
- `backend/routers/auth.py` - Authentication (login, register, refresh tokens, logout)
- `backend/routers/groups.py` - Group CRUD, public share links
- `backend/routers/members.py` - Member and guest management, claiming
- `backend/routers/expenses.py` - Expense CRUD, split calculations
- `backend/routers/balances.py` - Balance calculations, debt simplification
- `backend/routers/friends.py` - Friend management
- `backend/routers/receipts.py` - OCR receipt scanning

**Utilities:**
- `backend/utils/currency.py` - Exchange rate fetching (Frankfurter API), caching
- `backend/utils/validation.py` - Split validation, participant verification
- `backend/utils/splits.py` - Split calculation logic (equal, exact, percentage, shares, itemized)

**OCR Integration:**
- `backend/ocr/service.py` - Google Cloud Vision API client (singleton)
- `backend/ocr/parser.py` - Receipt text parsing and item extraction

**Key Database Fields:**
- Group: `default_currency`, `icon`, `share_link_id`, `is_public`
- Expense: `exchange_rate`, `split_type`, `receipt_image_path`, `icon`, `notes`
- GuestMember: `claimed_by_id`, `managed_by_id`, `managed_by_type`

### Frontend (React + TypeScript + Vite)

**Core Components:**
- `frontend/src/App.tsx` - Main app with Dashboard, routing, protected routes
- `frontend/src/AuthContext.tsx` - Authentication with automatic token refresh
- `frontend/src/ThemeContext.tsx` - Dark mode with localStorage persistence
- `frontend/src/GroupDetailPage.tsx` - Group detail, balances, public share links
- `frontend/src/ExpenseDetailModal.tsx` - Expense viewing/editing with notes
- `frontend/src/AddExpenseModal.tsx` - Expense creation (5 split types)

**Services & Types:**
- `frontend/src/services/api.ts` - Centralized API client with auth handling
- `frontend/src/types/` - TypeScript definitions (group.ts, expense.ts, balance.ts, friend.ts)
- `frontend/src/utils/formatters.ts` - Money, date, and name formatting
- `frontend/src/utils/expenseCalculations.ts` - Frontend split calculations
- `frontend/src/utils/participantHelpers.ts` - Participant data helpers

**Feature Components:**
- `frontend/src/ReceiptScanner.tsx` - OCR receipt scanning
- `frontend/src/ManageGuestModal.tsx` - Guest management and balance aggregation
- `frontend/src/AddGuestModal.tsx` - Add non-registered users
- `frontend/src/components/expense/ExpenseItemList.tsx` - Itemized expense UI
- `frontend/src/hooks/useItemizedExpense.ts` - Itemized expense state management

### Key Patterns
- Money stored in cents (integer) to avoid floating-point issues
- Balance calculation: positive = owed to you, negative = you owe
- Debt simplification converts all currencies to USD using cached exchange rates
- Historical exchange rates cached at expense creation (Frankfurter API)
- Group-level default currency for expense pre-filling and balance display
- Guest users support claiming (merge history) and management (balance aggregation)
- Refresh tokens stored hashed (SHA-256) in database
- Public share links allow read-only group viewing without login
- Itemized expenses use proportional tax/tip distribution

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
```bash
cd backend
pytest tests/test_main.py  # Run backend tests
pytest tests/test_main.py::test_create_user -v  # Run single test
```

### Database Migrations
When schema changes are made, update the SQLite database:
```bash
cd backend
source venv/bin/activate
python -c "from database import Base, engine; import models; Base.metadata.create_all(bind=engine)"
```

For manual column additions (e.g., adding new fields to existing tables):
```bash
sqlite3 db.sqlite3
ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT 'value';
```

## API Endpoints

### Authentication
- `POST /register` - User registration
- `POST /token` - Login (OAuth2 form: username=email, password), returns access_token and refresh_token
- `POST /auth/refresh` - Exchange refresh token for new access token
- `POST /auth/logout` - Revoke refresh token
- `GET /users/me` - Current user info

### Groups
- `POST /groups` - Create group (accepts `default_currency` field)
- `GET /groups` - List user's groups
- `GET /groups/{group_id}` - Get group details (includes `default_currency`)
- `PUT /groups/{group_id}` - Update group (can change `default_currency`)
- `DELETE /groups/{group_id}` - Delete group
- `GET /groups/{group_id}/balances` - Get group balances (per currency, includes managed guest aggregation)
- `POST /groups/{group_id}/guests` - Add guest member to group
- `DELETE /groups/{group_id}/guests/{guest_id}` - Remove guest from group
- `POST /groups/{group_id}/guests/{guest_id}/claim` - Claim guest profile (merge to registered user)
- `POST /groups/{group_id}/guests/{guest_id}/manage` - Link guest to manager for balance aggregation
- `DELETE /groups/{group_id}/guests/{guest_id}/manage` - Unlink guest from manager

### Friends & Expenses
- `POST /friends`, `GET /friends` - Friend management
- `POST /expenses` - Create expense (supports split_type: EQUAL, EXACT, PERCENTAGE, SHARES, ITEMIZED; caches historical exchange rate)
- `GET /expenses` - List expenses
- `GET /expenses/{expense_id}` - Get expense details (includes items for ITEMIZED type)
- `PUT /expenses/{expense_id}` - Update expense (updates cached exchange rate if date/currency changes)
- `DELETE /expenses/{expense_id}` - Delete expense

### Public Access
- `GET /public/groups/{share_link_id}` - Get group details via public share link (no auth required)
- `GET /public/groups/{share_link_id}/expenses/{expense_id}` - Get expense details via public link

### Balances & Currency
- `GET /balances` - User balance summary across all groups (includes managed guest balances)
- `GET /simplify_debts/{group_id}` - Debt simplification using cached exchange rates
- `GET /exchange_rates` - Current exchange rates (Frankfurter API)

## Feature Details

### Group Default Currency

Groups can have a default currency that streamlines expense creation and balance viewing.

**Database Schema:**
- `groups.default_currency` (String, default: "USD") - The preferred currency for the group

**Supported Currencies:**
- USD (US Dollar)
- EUR (Euro)
- GBP (British Pound)
- JPY (Japanese Yen)
- CAD (Canadian Dollar)

**Validation:**
- Pydantic field validator in `schemas.py` ensures only valid currencies are accepted
- Invalid currencies return 422 Unprocessable Entity error

**Frontend Features:**
1. **Group Creation** - Currency selector dropdown in sidebar (defaults to USD)
2. **Group Editing** - Default currency can be changed via Edit Group modal
3. **Expense Pre-fill** - When creating an expense in a group, currency automatically pre-fills with group's default
4. **Balance Display** - Toggle button to view all balances converted to group's default currency

**Backend Implementation:**
- `POST /groups` - Accepts `default_currency` in request body
- `PUT /groups/{group_id}` - Updates `default_currency` field
- `GET /groups/{group_id}` - Returns group with `default_currency` field

### Historical Exchange Rate Caching

Expenses cache their exchange rate at creation time for accurate historical tracking.

**Problem Solved:**
Exchange rates fluctuate daily. Without caching historical rates, old expenses would be converted using today's rates, leading to inaccurate balance calculations.

**Solution:**
Cache the exchange rate from the expense's currency to USD on the date of the expense.

**Database Schema:**
- `expenses.exchange_rate` (String, nullable) - Exchange rate from expense currency to USD on expense date
- Stored as string for SQLite compatibility
- Example: "1.0945" (means 1 EUR = 1.0945 USD on that date)

**API Used: Frankfurter API**
- URL: `https://api.frankfurter.app/`
- Free, no API key required
- Historical rates back to 1999
- Maintained using European Central Bank data
- No rate limits for reasonable usage

**How It Works:**

1. **On Expense Creation:**
   ```python
   # User creates expense with date "2024-01-15" and currency "EUR"
   exchange_rate = get_exchange_rate_for_expense("2024-01-15", "EUR")
   # Fetches from: https://api.frankfurter.app/2024-01-15?from=EUR&to=USD
   # Returns: 1.0945
   # Stores in expense.exchange_rate = "1.0945"
   ```

2. **On Balance Viewing:**
   - Frontend fetches current rates from `/exchange_rates` endpoint
   - Backend calls Frankfurter API for latest rates
   - Frontend uses current rates for balance conversion display

**Fallback Mechanism:**
If Frankfurter API is unavailable:
- Falls back to hardcoded rates in `EXCHANGE_RATES` dict
- Prints warning to console
- System continues to function normally

**Functions:**
- `fetch_historical_exchange_rate(date, from_currency, to_currency)` - Fetches historical rate from API
- `get_exchange_rate_for_expense(date, currency)` - Wrapper with fallback logic
- `get_exchange_rates()` - Fetches current rates for frontend

**Benefits:**
- ✅ Accurate historical records preserved
- ✅ Only one API call per expense (minimal usage)
- ✅ Fast balance viewing (no API calls needed)
- ✅ Works offline if API fails (fallback rates)
- ✅ No API key required (free service)

### Balance Grouping by Currency

Group balance display intelligently groups and converts between currencies.

**Two Display Modes:**

1. **Grouped by Currency (Default):**
   - Balances organized by currency with section headers
   - Example:
     ```
     USD
       Alice  +$50.00
       Bob    -$30.00

     EUR
       Alice  +€20.00
     ```

2. **Converted to Group Currency (Toggle):**
   - All balances converted to group's default currency
   - Aggregates multi-currency balances per person
   - Example (group default: USD):
     ```
     Alice  +$73.30  (combined $50 + €20)
     Bob    -$30.00
     ```

**Frontend Implementation:**
- Toggle button: "Show in {currency}" / "Show by currency"
- Uses current exchange rates from `/exchange_rates` endpoint
- Client-side conversion for fast, responsive UI
- Filters out near-zero balances after conversion

**Conversion Logic:**
```typescript
// Convert through USD as intermediary
const amountInUSD = amount / exchangeRates[fromCurrency];
const converted = amountInUSD * exchangeRates[toCurrency];
```

## Currency Conversion Flow

```
Expense Created (2024-01-15)
    ↓
Fetch historical rate for 2024-01-15
    ↓ (Frankfurter API)
Cache rate in expense.exchange_rate
    ↓
Store expense with cached rate
    ↓
View Balances Today
    ↓
Fetch current rates
    ↓ (Frankfurter API)
Display with today's conversion rates
```

## OCR Receipt Scanning

Receipt scanning uses Google Cloud Vision API for text extraction.

### Architecture

```
backend/ocr/
├── service.py   # Google Cloud Vision client (singleton)
└── parser.py    # Receipt text parsing & item extraction
```

### Setup

1. Create Google Cloud project and enable Cloud Vision API
2. Create service account with "Cloud Vision API User" role
3. Download JSON credentials file
4. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
   ```

### Free Tier

- 1,000 pages/month free
- Requires GCP account with billing enabled (won't charge within free tier)

### API Endpoint

- `POST /ocr/scan-receipt` - Upload receipt image, returns extracted items
- Accepts: JPEG, PNG, WebP (max 10MB)
- Returns:
  ```json
  {
    "items": [{"description": "Burger", "price": 1299}],
    "total": 1299,
    "raw_text": "Full receipt text..."
  }
  ```

### How It Works

1. Frontend uploads image to `/ocr/scan-receipt`
2. Backend sends image bytes to Google Cloud Vision API
3. Vision returns full text with bounding boxes
4. Parser extracts item-price pairs using regex patterns
5. Filters out noise (totals, tax, dates, phone numbers)
6. Returns structured items with prices in cents

## Guest User Management

Non-registered users can participate in expenses and later claim their profiles.

### Database Schema

**GuestMember Model:**
- `id` - Primary key
- `group_id` - Group the guest belongs to
- `name` - Guest's display name
- `created_by_id` - User who added the guest
- `claimed_by_id` - User who claimed this guest (nullable)
- `managed_by_id` - ID of manager (user or guest, nullable)
- `managed_by_type` - Type of manager: 'user' or 'guest' (nullable)

### Features

**1. Guest Creation**
- Any group member can add guests with just a name
- Guests can be payers or participants in expenses
- Endpoint: `POST /groups/{group_id}/guests`

**2. Guest Claiming**
- Registered users can claim guest profiles to merge expense history
- All expenses where guest was payer transfer to claiming user
- All expense splits involving guest transfer to claiming user
- Claiming user automatically added to group if not already member
- Endpoint: `POST /groups/{group_id}/guests/{guest_id}/claim`

**3. Guest Management (Balance Aggregation)**
- Link a guest to a "manager" (registered user OR another guest)
- Guest's balance aggregates with manager's balance in balance view
- Guest still appears separately in expense details
- Prevents circular management (cannot manage self)
- Cannot manage claimed guests
- Auto-unlink when manager leaves group
- Endpoints:
  - `POST /groups/{group_id}/guests/{guest_id}/manage` - Link to manager
  - `DELETE /groups/{group_id}/guests/{guest_id}/manage` - Unlink

### Example Use Case

```
1. Alice adds "Bob's Friend" as guest to group
2. Guest participates in several expenses
3. Bob registers and claims guest profile
4. All guest expenses transfer to Bob
5. Bob is automatically added to the group
```

### Frontend Components
- `ManageGuestModal.tsx` - UI for linking guests to managers
- `AddGuestModal.tsx` - Simple form to add guest by name
- Visual indicators show managed guest relationships in balance view

## Public Share Links

Enable read-only group sharing without requiring authentication.

### Database Schema

**Group Model Additions:**
- `share_link_id` - Unique UUID for the public share link (nullable)
- `is_public` - Boolean flag indicating if public sharing is enabled (default: false)

### How It Works

**Enabling Public Sharing:**
1. Group owner opens group settings
2. Toggles "Enable public sharing"
3. Backend generates unique `share_link_id` (UUID)
4. Frontend displays shareable URL

**Accessing Public Links:**
1. Anyone with the link can view group balances and expenses
2. No login required
3. Read-only access (no modifications allowed)
4. Expense details accessible via modal

### API Endpoints

- `PUT /groups/{group_id}` - Toggle `is_public` flag, generates `share_link_id`
- `GET /public/groups/{share_link_id}` - Get group details (no auth)
- `GET /public/groups/{share_link_id}/expenses/{expense_id}` - Get expense details (no auth)

### Frontend Implementation

- `GroupDetailPage.tsx` - Handles both authenticated and public views
- Uses `isPublicView` prop to toggle between edit/read-only modes
- Share button copies public URL to clipboard
- All edit buttons hidden in public view

## Refresh Token Authentication

Secure authentication with short-lived access tokens and long-lived refresh tokens.

### Architecture

**Token Types:**
1. **Access Token (JWT)**
   - Short-lived (30 minutes)
   - Contains user email and expiry
   - Used for API authentication
   - Transmitted in Authorization header

2. **Refresh Token (Random)**
   - Long-lived (30 days)
   - Cryptographically secure random token (256-bit)
   - Stored hashed (SHA-256) in database
   - Used to obtain new access tokens

### Database Schema

**RefreshToken Model:**
- `id` - Primary key
- `user_id` - Owner of token
- `token_hash` - SHA-256 hash (plaintext never stored)
- `expires_at` - Expiry datetime
- `created_at` - Creation datetime
- `revoked` - Boolean flag for logout

### Authentication Flow

**Login:**
```
1. POST /token with credentials
2. Server validates password
3. Server creates access token (JWT, 30 min)
4. Server creates refresh token (random, 30 days)
5. Server stores HASHED refresh token in database
6. Server returns both tokens to client
7. Client stores both in localStorage
```

**Token Refresh:**
```
1. Access token expires (401 error)
2. Client POST /auth/refresh with refresh token
3. Server validates refresh token hash
4. Server checks not revoked and not expired
5. Server creates new access token
6. Client updates localStorage
7. Client retries original request
```

**Logout:**
```
1. Client POST /auth/logout with refresh token
2. Server marks token as revoked in database
3. Client clears localStorage
```

### Security Benefits
- Access tokens short-lived (minimizes attack window)
- Refresh tokens stored hashed (protects against DB breach)
- Token revocation on logout (prevents reuse)
- Automatic refresh provides seamless UX
- No password storage in client after login

### Frontend Implementation
- `AuthContext.tsx` implements automatic token refresh on 401
- Transparent retry logic for expired access tokens
- All API calls automatically use current access token

### Functions

**Backend ([auth.py](backend/auth.py)):**
- `create_access_token(data)` - Generate JWT with 30 min expiry
- `create_refresh_token()` - Generate secure random token
- `hash_token(token)` - SHA-256 hash for storage
- `verify_access_token(token)` - Validate JWT

**Frontend ([AuthContext.tsx](frontend/src/AuthContext.tsx)):**
- `refreshAccessToken()` - Exchange refresh token for new access token
- `fetchWithRefresh()` - Auto-retry on 401 with token refresh

## Itemized Expense Splitting

Split expenses by individual items with proportional tax/tip distribution (e.g., restaurant bills).

### Database Schema

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

### Split Calculation Algorithm

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

### Example

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

### Frontend Implementation

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

### Validation Rules
1. All non-tax/tip items must have at least one assignee
2. Sum of splits must equal expense total (±1 cent tolerance)
3. Expense total auto-calculated from sum of items
4. All participants must exist in database

### API Usage

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

## Dark Mode

System-wide dark theme with user preference persistence.

### Architecture

**Theme Context ([ThemeContext.tsx](frontend/src/ThemeContext.tsx)):**
- React Context API for global theme state
- Persists preference to localStorage
- Falls back to system preference if no saved preference
- Applies 'dark' class to `<html>` element

### Implementation

**Preference Priority:**
1. User's saved preference in localStorage
2. System preference from `prefers-color-scheme` media query
3. Default: light mode

**Theme Toggle:**
- Button in sidebar footer
- Sun icon (yellow) when in dark mode → click for light
- Moon icon (gray) when in light mode → click for dark

**Styling:**
- Tailwind CSS v4 with `@variant dark (&:where(.dark, .dark *));`
- All components use `dark:` variants for dark mode styles
- Examples:
  - `dark:bg-gray-800` - Dark backgrounds
  - `dark:text-gray-100` - Light text
  - `dark:border-gray-700` - Dark borders
  - `dark:hover:bg-gray-600` - Dark hover states

**Smooth Transitions:**
```css
* {
  transition: background-color 0.2s ease-in-out,
              border-color 0.2s ease-in-out;
}
```

### Coverage
All 20+ frontend components implement dark mode:
- Modals (AddExpense, SettleUp, EditGroup, ManageGuest)
- Forms (Login, Register)
- Lists (Groups, Friends, Expenses, Balances)
- Detail pages (GroupDetail, ExpenseDetail)
- Navigation (Sidebar, Header)

### Storage
```typescript
// Save preference
localStorage.setItem('theme', isDark ? 'dark' : 'light');

// Load preference
const savedTheme = localStorage.getItem('theme');
const prefersDark = savedTheme === 'dark' ||
  window.matchMedia('(prefers-color-scheme: dark)').matches;
```

## Database Schema Changes

### New Tables

```sql
-- Guest user management
CREATE TABLE guest_members (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_by_id INTEGER NOT NULL,
    claimed_by_id INTEGER,
    managed_by_id INTEGER,
    managed_by_type TEXT
);

-- Refresh token authentication
CREATE TABLE refresh_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE
);

-- Itemized expense items
CREATE TABLE expense_items (
    id INTEGER PRIMARY KEY,
    expense_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    is_tax_tip BOOLEAN DEFAULT FALSE
);

-- Itemized expense assignments
CREATE TABLE expense_item_assignments (
    id INTEGER PRIMARY KEY,
    expense_item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_guest BOOLEAN DEFAULT FALSE
);
```

### Modified Tables

```sql
-- Group default currency
ALTER TABLE groups ADD COLUMN default_currency TEXT DEFAULT 'USD';

-- Historical exchange rate caching
ALTER TABLE expenses ADD COLUMN exchange_rate TEXT;

-- Guest user support in expenses
ALTER TABLE expenses ADD COLUMN payer_is_guest BOOLEAN DEFAULT FALSE;
ALTER TABLE expense_splits ADD COLUMN is_guest BOOLEAN DEFAULT FALSE;

-- Receipt images and notes
ALTER TABLE expenses ADD COLUMN receipt_image_path TEXT;
ALTER TABLE expenses ADD COLUMN icon TEXT;
ALTER TABLE expenses ADD COLUMN notes TEXT;

-- Group icons and public sharing
ALTER TABLE groups ADD COLUMN icon TEXT;
ALTER TABLE groups ADD COLUMN share_link_id TEXT UNIQUE;
ALTER TABLE groups ADD COLUMN is_public BOOLEAN DEFAULT FALSE;
```
