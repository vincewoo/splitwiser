# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Splitwiser is a Splitwise clone for expense splitting among friends and groups. It features multi-currency support with historical exchange rate caching, various split types (equal, exact, percentage, shares), OCR receipt scanning, group-level currency management, and debt simplification.

## Architecture

### Backend (FastAPI + SQLAlchemy)
- `backend/main.py` - API endpoints and core business logic (expenses, groups, friends, balances, debt simplification, exchange rate caching)
- `backend/models.py` - SQLAlchemy models: User, Group, GroupMember, Friendship, Expense, ExpenseSplit
  - Group model includes `default_currency` field for group-level currency preference
  - Expense model includes `exchange_rate` field for caching historical exchange rates
- `backend/schemas.py` - Pydantic schemas for request/response validation with currency validation
- `backend/auth.py` - JWT authentication with bcrypt password hashing
- `backend/database.py` - SQLite database configuration
- Uses OAuth2 with Bearer tokens; all authenticated endpoints require `Authorization: Bearer <token>` header

### Frontend (React + TypeScript + Vite)
- `frontend/src/App.tsx` - Main app with Dashboard, routing, protected routes, and group creation with currency selection
- `frontend/src/AuthContext.tsx` - Authentication context provider
- `frontend/src/AddExpenseModal.tsx` - Expense creation with split type selection and automatic currency pre-fill from group default
- `frontend/src/ReceiptScanner.tsx` - OCR receipt scanning using tesseract.js
- `frontend/src/SettleUpModal.tsx` - Settlement modal
- `frontend/src/GroupDetailPage.tsx` - Group detail view with balance grouping by currency and conversion toggle
- `frontend/src/EditGroupModal.tsx` - Group editing with default currency management
- Styling with Tailwind CSS v4

### Key Patterns
- Money stored in cents (integer) to avoid floating-point issues
- Balance calculation: positive = owed to you, negative = you owe
- Debt simplification algorithm converts all currencies to USD for settlement
- Historical exchange rates cached at expense creation using Frankfurter API
- Group-level default currency for expense pre-filling and balance display preferences

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
- `POST /token` - Login (OAuth2 form: username=email, password)
- `GET /users/me` - Current user info

### Groups
- `POST /groups` - Create group (accepts `default_currency` field)
- `GET /groups` - List user's groups
- `GET /groups/{group_id}` - Get group details (includes `default_currency`)
- `PUT /groups/{group_id}` - Update group (can change `default_currency`)
- `DELETE /groups/{group_id}` - Delete group
- `GET /groups/{group_id}/balances` - Get group balances (per currency)

### Friends & Expenses
- `POST /friends`, `GET /friends` - Friend management
- `POST /expenses` - Create expense (automatically caches historical exchange rate)
- `GET /expenses` - List expenses
- `GET /expenses/{expense_id}` - Get expense details
- `PUT /expenses/{expense_id}` - Update expense
- `DELETE /expenses/{expense_id}` - Delete expense

### Balances & Currency
- `GET /balances` - User balance summary across all groups
- `GET /simplify_debts/{group_id}` - Debt simplification for a group
- `GET /exchange_rates` - Current currency exchange rates (fetched from Frankfurter API)

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

## Database Schema Changes

### groups table
```sql
ALTER TABLE groups ADD COLUMN default_currency TEXT DEFAULT 'USD';
```

### expenses table
```sql
ALTER TABLE expenses ADD COLUMN exchange_rate TEXT;
```
