# Changelog

All notable changes to the Splitwiser project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added - 2025-12-10

#### Group Default Currency Feature
- Added `default_currency` field to Group model (defaults to USD)
- Currency validation in Pydantic schemas (supports USD, EUR, GBP, JPY, CAD)
- Currency selector dropdown in group creation form
- Edit Group modal now includes currency editor
- Expense creation automatically pre-fills currency from group's default
- Toggle button on Group Detail page to view balances in group's default currency
- Balance grouping by currency with clear section headers

**Backend Changes:**
- `backend/models.py` - Added `default_currency` column to `Group` model
- `backend/schemas.py` - Updated `GroupBase`, `GroupCreate`, `GroupUpdate` with currency field and validation
- `backend/main.py` - Updated group creation/update endpoints to handle `default_currency`

**Frontend Changes:**
- `frontend/src/App.tsx` - Added currency selector to group creation
- `frontend/src/EditGroupModal.tsx` - Added currency editor
- `frontend/src/AddExpenseModal.tsx` - Implemented automatic currency pre-fill from group default
- `frontend/src/GroupDetailPage.tsx` - Added balance grouping by currency and conversion toggle
- Updated Group TypeScript interfaces across all components

**Database Migration:**
```sql
ALTER TABLE groups ADD COLUMN default_currency TEXT DEFAULT 'USD';
```

#### Historical Exchange Rate Caching
- Expenses now cache their historical exchange rate at creation time
- Integration with Frankfurter API (free, no API key required)
- Fallback to static rates if API is unavailable
- `/exchange_rates` endpoint now fetches live rates from Frankfurter API

**Backend Changes:**
- `backend/models.py` - Added `exchange_rate` field to `Expense` model
- `backend/main.py` - Added three new functions:
  - `fetch_historical_exchange_rate()` - Fetches historical rates from Frankfurter API
  - `get_exchange_rate_for_expense()` - Wrapper with fallback logic
  - Updated `get_exchange_rates()` - Now fetches live rates from API
- Expense creation now automatically fetches and caches exchange rate for the expense date

**API Integration:**
- Frankfurter API (`https://api.frankfurter.app/`)
  - Historical rates back to 1999
  - No API key required
  - Maintained using European Central Bank data
  - Free for reasonable usage

**Database Migration:**
```sql
ALTER TABLE expenses ADD COLUMN exchange_rate TEXT;
```

**Benefits:**
- Accurate historical tracking of exchange rates
- Only one API call per expense (minimal API usage)
- Fast balance viewing (uses cached rates)
- Works offline with fallback to static rates

### Changed - 2025-12-10
- Balance display now groups by currency first, then by person
- Exchange rate endpoint now fetches live rates instead of using static values
- Group detail page UI enhanced with currency conversion toggle

### Technical Details

**Files Modified:**
- Backend: `models.py`, `schemas.py`, `main.py`
- Frontend: `App.tsx`, `GroupDetailPage.tsx`, `AddExpenseModal.tsx`, `EditGroupModal.tsx`
- Database: Added columns to `groups` and `expenses` tables

**Dependencies:**
- No new dependencies added (uses existing `requests` library for API calls)

**Testing:**
- Historical rate fetching tested for EUR, GBP on various dates
- Current rate endpoint tested and verified
- Database migrations completed successfully

**Known Limitations:**
- Frankfurter API supports EUR, USD, and other major currencies but not all world currencies
- Historical rates only available from 1999 onwards
- Existing expenses (created before this update) have NULL exchange_rate and will use fallback rates
