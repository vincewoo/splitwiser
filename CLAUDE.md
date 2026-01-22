# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Splitwiser is a Splitwise clone for expense splitting among friends and groups. Key features: multi-currency support (USD, EUR, GBP, JPY, CAD, CNY, HKD, CHF), various split types (equal, exact, percentage, shares, itemized), two-phase OCR receipt scanning, debt simplification, guest/member management, dark mode, refresh token auth, email notifications via Brevo, PWA with offline support, and mobile-optimized UI.

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
- `backend/routers/auth.py` - Authentication (login, register, refresh tokens, logout, password reset, email change)
- `backend/routers/groups.py` - Group CRUD, public share links
- `backend/routers/members.py` - Member and guest management, claiming
- `backend/routers/expenses.py` - Expense CRUD, split calculations
- `backend/routers/balances.py` - Balance calculations, debt simplification
- `backend/routers/friends.py` - Friend management, friend request emails
- `backend/routers/ocr.py` - Two-phase OCR (region detection, text extraction)

**Utilities:**
- `backend/utils/currency.py` - Exchange rate fetching (Frankfurter API), caching
- `backend/utils/validation.py` - Split validation, participant verification
- `backend/utils/splits.py` - Split calculation logic (equal, exact, percentage, shares, itemized)
- `backend/utils/display.py` - Display name helpers for guests and claimed users
- `backend/utils/email.py` - Brevo API email service for transactional emails

**OCR Integration:**
- `backend/ocr/service.py` - Google Cloud Vision API client (singleton)
- `backend/ocr/parser.py` - Receipt text parsing and item extraction (V1)
- `backend/ocr/parser_v2.py` - Enhanced spatial layout parser with improved accuracy
- `backend/ocr/regions.py` - Smart region detection and filtering for two-phase OCR (V3)

**Database Migrations:**
- `backend/migrations/` - Migration scripts with helper tools
- See `backend/migrations/README.md` for detailed migration documentation

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
- `frontend/src/services/offlineApi.ts` - Offline API wrapper using IndexedDB
- `frontend/src/services/syncManager.ts` - Background sync manager for PWA
- `frontend/src/db/schema.ts` - IndexedDB schema for offline storage
- `frontend/src/types/` - TypeScript definitions (group.ts, expense.ts, balance.ts, friend.ts)
- `frontend/src/utils/formatters.ts` - Money, date, and name formatting
- `frontend/src/utils/expenseCalculations.ts` - Frontend split calculations

**Feature Components:**
- `frontend/src/ReceiptScanner.tsx` - Two-phase OCR receipt scanning (V3)
- `frontend/src/components/expense/BoundingBoxEditor.tsx` - Interactive bounding box editor
- `frontend/src/components/expense/ItemPreviewEditor.tsx` - Item review and editing interface
- `frontend/src/components/expense/ExpenseItemList.tsx` - Itemized expense UI with per-item splits
- `frontend/src/ManageGuestModal.tsx` - Guest management and balance aggregation
- `frontend/src/ManageMemberModal.tsx` - Member management for registered users
- `frontend/src/hooks/useItemizedExpense.ts` - Itemized expense state management
- `frontend/src/hooks/useBoundingBoxes.ts` - Bounding box state management for OCR

**PWA Support:**
- `frontend/public/manifest.json` - PWA manifest for installable app
- Service worker for offline caching and background sync

### Key Patterns
- Money stored in cents (integer) to avoid floating-point issues
- Balance calculation: positive = owed to you, negative = you owe
- Debt simplification converts all currencies to USD using cached exchange rates
- Historical exchange rates cached at expense creation (Frankfurter API)
- Guest users support claiming (merge history) and management (balance aggregation)
- Registered members can also be managed for balance aggregation
- Refresh tokens stored hashed (SHA-256) in database with server-side revocation
- Itemized expenses use proportional tax/tip distribution
- Receipt images stored in `backend/receipts/` directory

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
- `POST /groups`, `GET /groups`, `GET /groups/{group_id}`, `PUT /groups/{group_id}`, `DELETE /groups/{group_id}` - Group CRUD
- `GET /groups/{group_id}/balances` - Get group balances
- `POST /groups/{group_id}/guests` - Add guest member
- `POST /groups/{group_id}/guests/{guest_id}/claim` - Claim guest profile
- `POST /groups/{group_id}/guests/{guest_id}/manage` - Link guest to manager

### Expenses
- `POST /expenses`, `GET /expenses`, `GET /expenses/{expense_id}`, `PUT /expenses/{expense_id}`, `DELETE /expenses/{expense_id}` - Expense CRUD
- Split types: EQUAL, EXACT, PERCENTAGE, SHARES, ITEMIZED

### Friends
- `POST /friends`, `GET /friends` - Friend management
- `POST /friends/request` - Send friend request email

### Public Access
- `GET /public/groups/{share_link_id}` - Get group via public link (no auth)
- `GET /public/groups/{share_link_id}/expenses/{expense_id}` - Get expense via public link

### Balances & Currency
- `GET /balances` - User balance summary across all groups
- `GET /simplify_debts/{group_id}` - Debt simplification
- `GET /exchange_rates` - Current exchange rates

### OCR
- `POST /ocr/detect-regions` - Upload receipt, get detected text regions (Phase 1)
- `POST /ocr/extract-regions` - Extract text from specific regions (Phase 2)

## Key Database Fields

- Group: `default_currency`, `icon`, `share_link_id`, `is_public`
- GroupMember: `managed_by_id`, `managed_by_type`
- Expense: `exchange_rate`, `split_type`, `receipt_image_path`, `icon`, `notes`, `payer_is_guest`
- ExpenseSplit: `is_guest`
- GuestMember: `claimed_by_id`, `managed_by_id`, `managed_by_type`
- RefreshToken: `token_hash`, `expires_at`, `revoked`
- ExpenseItem: `description`, `price`, `is_tax_tip`
- ExpenseItemAssignment: `user_id`, `is_guest`

## Detailed Documentation

For more detailed information, see the `docs/` directory:
- `docs/FEATURES.md` - Currency features, dark mode, balance grouping
- `docs/AUTHENTICATION.md` - Refresh tokens, email notifications
- `docs/OCR.md` - Receipt scanning two-phase system
- `docs/USER_MANAGEMENT.md` - Guest/member management, public links
- `docs/ITEMIZED_EXPENSES.md` - Itemized split algorithm
- `docs/PWA.md` - Progressive Web App, offline support
- `docs/DATABASE.md` - Schema, performance, security
