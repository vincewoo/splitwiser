# Splitwiser

A full-featured expense splitting application built with FastAPI and React, inspired by Splitwise.

## Features

### Core Functionality
- 🔐 **User Authentication** - Refresh token-based authentication with automatic token renewal
- 👫 **Friend Management** - Add and manage friends for expense splitting
- 🏢 **Group Management** - Create groups with customizable default currencies
- 💰 **Expense Tracking** - Track expenses with multiple split types
- 📊 **Balance Calculation** - Real-time balance tracking across all groups
- 🔄 **Debt Simplification** - Minimize transactions using graph algorithms

### Advanced Features
- 💱 **Multi-Currency Support** - Support for USD, EUR, GBP, JPY, CAD, CNY, HKD, CHF with currency flags
- 📅 **Historical Exchange Rates** - Automatic caching of exchange rates from expense date
- 🌍 **Live Currency Conversion** - Real-time exchange rates via Frankfurter API
- 🎯 **Smart Currency Grouping** - View balances grouped by currency or converted to group default
- 📸 **OCR Receipt Scanning V3** - Two-phase interactive system with bounding box editor and per-item splits
- 👻 **Guest Members** - Add non-registered users with claiming and balance aggregation
- 👥 **Member Management** - Balance aggregation for registered users, not just guests
- 🔗 **Public Share Links** - Share read-only group views without requiring login
- 📝 **Notes on Expenses** - Add freeform text notes to expense entries
- 🖼️ **Receipt Images** - Attach and view receipt photos on expenses
- 🏷️ **Icons/Categories** - Emoji icons for groups and expense categorization
- 🌙 **Dark Mode** - System-wide dark theme with preference persistence
- 🔑 **Secure Authentication** - Refresh tokens with server-side revocation
- 📧 **Email Notifications** - Password reset, friend requests, and security alerts via Brevo API
- 🛡️ **Security Hardened** - Rate limiting, CSP headers, input validation, file upload limits
- ⚡ **Performance Optimized** - N+1 query elimination, database indexes, efficient SQL
- 📱 **Progressive Web App** - Install to home screen with offline support
- 🔌 **Offline Mode** - Create expenses offline, auto-sync when online
- ❓ **Help & FAQ** - Comprehensive in-app documentation covering all features

### Split Types
- ⚖️ **Equal Split** - Divide expense equally among participants
- 📝 **Exact Split** - Specify exact amounts for each person
- 📊 **Percentage Split** - Split by custom percentages
- 🎲 **Shares Split** - Split by number of shares
- 🧾 **Itemized Split** - Split by individual items with proportional tax/tip distribution

## Tech Stack

### Backend
- **FastAPI** - Modern Python web framework
- **SQLAlchemy** - SQL toolkit and ORM
- **SQLite** - Lightweight database
- **Pydantic** - Data validation
- **JWT** - Secure authentication tokens
- **bcrypt** - Password hashing

### Frontend
- **React 18** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool
- **Tailwind CSS v4** - Utility-first CSS with dark mode support

### External APIs
- **Frankfurter API** - Free, real-time and historical exchange rates (no API key required)
- **Google Cloud Vision API** - OCR for receipt scanning (1,000 pages/month free tier)
- **Brevo API** - Transactional email service (300 emails/day free tier)

## Getting Started

### Prerequisites
- Python 3.12+
- Node.js 18+
- npm or yarn

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend will run at `http://localhost:8000`

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at `http://localhost:5173`

### Database Initialization

The database is automatically created on first run. To manually initialize:

```bash
cd backend
source venv/bin/activate
python -c "from database import Base, engine; import models; Base.metadata.create_all(bind=engine)"
```

## API Documentation

Once the backend is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Project Structure

```
splitwise/
├── backend/
│   ├── main.py                      # FastAPI app initialization
│   ├── models.py                    # SQLAlchemy database models
│   ├── schemas.py                   # Pydantic schemas for validation
│   ├── auth.py                      # JWT token creation and hashing
│   ├── database.py                  # Database configuration
│   ├── dependencies.py              # Shared FastAPI dependencies
│   ├── routers/                     # API route handlers
│   │   ├── auth.py                  # Authentication endpoints
│   │   ├── groups.py                # Group management endpoints
│   │   ├── members.py               # Member/guest management
│   │   ├── expenses.py              # Expense CRUD operations
│   │   ├── balances.py              # Balance calculations
│   │   ├── friends.py               # Friend management
│   │   └── receipts.py              # OCR receipt scanning
│   ├── utils/                       # Utility modules
│   │   ├── currency.py              # Exchange rate handling
│   │   ├── validation.py            # Input validation helpers
│   │   ├── splits.py                # Split calculation logic
│   │   ├── display.py               # Display name helpers
│   │   └── email.py                 # Brevo API email service
│   ├── ocr/                         # OCR integration
│   │   ├── service.py               # Google Cloud Vision client
│   │   ├── parser.py                # Receipt text parsing (V1)
│   │   └── parser_v2.py             # Enhanced spatial layout parser
│   ├── migrations/                  # Database migration scripts
│   │   ├── README.md                # Migration documentation
│   │   ├── migrate.sh               # Migration helper (direct install)
│   │   ├── migrate-docker.sh        # Migration helper (Docker)
│   │   └── *.py                     # Individual migration scripts
│   ├── requirements.txt             # Python dependencies
│   └── db.sqlite3                   # SQLite database (generated)
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Main app component with routing
│   │   ├── AuthContext.tsx          # Auth context (auto-refresh tokens)
│   │   ├── ThemeContext.tsx         # Dark mode context
│   │   ├── GroupDetailPage.tsx      # Group detail view
│   │   ├── ExpenseDetailModal.tsx   # Expense viewing/editing
│   │   ├── AddExpenseModal.tsx      # Expense creation (5 split types)
│   │   ├── EditGroupModal.tsx       # Group settings editor
│   │   ├── SettleUpModal.tsx        # Settlement UI
│   │   ├── ReceiptScanner.tsx       # OCR receipt scanning
│   │   ├── ManageGuestModal.tsx     # Guest management UI
│   │   ├── ManageMemberModal.tsx    # Member management UI
│   │   ├── AddGuestModal.tsx        # Add guest users
│   │   ├── AddMemberModal.tsx       # Add registered members
│   │   ├── DeleteGroupConfirm.tsx   # Confirmation dialogs
│   │   ├── HelpPage.tsx             # Help & FAQ documentation
│   │   ├── services/
│   │   │   ├── api.ts               # Centralized API client
│   │   │   ├── offlineApi.ts        # Offline API wrapper
│   │   │   └── syncManager.ts       # Background sync manager
│   │   ├── db/
│   │   │   └── schema.ts            # IndexedDB schema for offline
│   │   ├── types/                   # TypeScript type definitions
│   │   │   ├── group.ts
│   │   │   ├── expense.ts
│   │   │   ├── balance.ts
│   │   │   └── friend.ts
│   │   ├── utils/                   # Utility functions
│   │   │   ├── formatters.ts        # Money/date formatting
│   │   │   ├── expenseCalculations.ts
│   │   │   └── participantHelpers.ts
│   │   ├── components/
│   │   │   └── expense/
│   │   │       └── ExpenseItemList.tsx  # Itemized expense UI
│   │   └── hooks/
│   │       └── useItemizedExpense.ts    # Itemized expense logic
│   ├── public/
│   │   ├── manifest.json            # PWA manifest
│   │   └── icons/                   # App icons (various sizes)
│   ├── package.json                 # npm dependencies
│   └── vite.config.ts               # Vite configuration
│
├── CLAUDE.md                        # Development guide for Claude Code
├── CHANGELOG.md                     # Version history and changes
├── DEPLOYMENT.md                    # Deployment instructions
└── README.md                        # This file
```

## Currency Features

### Group Default Currency
- Set a default currency when creating a group
- Automatically pre-fill expense currency based on group default
- Edit group currency at any time
- View all balances converted to group's default currency

### Historical Exchange Rates
- Exchange rates are cached when expenses are created
- Uses Frankfurter API for accurate historical rates back to 1999
- Fallback to static rates if API is unavailable
- No API key required

### Balance Conversion
Two viewing modes:
1. **Grouped by Currency** - See balances organized by currency
2. **Converted to Group Currency** - View all balances in a single currency

## Key Features

### Email Notifications

Splitwiser sends transactional emails for important account and social events:

**Features:**
- **Password Reset** - Secure reset links with 1-hour expiration
- **Password Changed** - Security notifications when password is updated
- **Email Verification** - Verify new email addresses with 24-hour expiration
- **Email Change Alerts** - Security notifications sent to old email
- **Friend Requests** - Email notifications when someone sends you a friend request

**Implementation:**
- Uses Brevo API (not SMTP) for reliable delivery
- Professional HTML email templates with plain text fallbacks
- Graceful fallback if email is not configured
- Free tier: 300 emails/day

See [EMAIL_SETUP.md](EMAIL_SETUP.md) for configuration instructions.

### Guest & Member Management

Add and manage both registered and non-registered users:

**Guest Management:**
- **Add Guests** - Invite people without requiring registration
- **Guest Participation** - Guests can be payers or participants in expenses
- **Claim Profiles** - Registered users can claim guest accounts to merge expense history
- **Balance Aggregation** - Link guests to managers for simplified balance tracking
- **Automatic Migration** - When claiming, all guest expenses transfer to registered account
- **Guest-to-Guest Management** - Guests can manage other guests

**Member Management (NEW):**
- **Registered User Aggregation** - Link registered members for combined balance view
- **Consistent Interface** - Same management flow for both guests and members
- **Visual Separation** - "Splitwisers" and "Guests" sections in group view
- **Flexible Tracking** - Aggregate balances for couples, families, or shared accounts

**Use Case:** Add "Bob's Friend" to a trip group. Later, when they register, they can claim the guest profile and inherit all expense history. Or link two registered users (e.g., a couple) to see their combined balance.

### Advanced Receipt Scanning (Two-Phase OCR)

Interactive receipt scanning with unprecedented accuracy:

**Phase 1: Region Definition**
- Automatic text region detection using AI
- Interactive bounding box editor with drag, resize, delete
- Pinch-to-zoom and touch gestures for mobile
- Double-click to add custom regions
- Visual feedback and numbered labels

**Phase 2: Item Review**
- Split-view with receipt preview and extracted items
- Inline editing of descriptions and prices
- Per-item split methods (Equal, Exact, Percentage, Shares)
- Cropped region preview for each item
- Bidirectional highlighting (item ↔ receipt region)
- Smart sorting by position on receipt

**Features:**
- 5-minute response caching (single API call per receipt)
- Client-side image compression (automatic)
- Desktop and mobile optimized
- Tax/tip item marking
- Comprehensive validation

**Example:** Scan a restaurant receipt, adjust the detected regions if needed, review/edit the extracted items, mark tax/tip, and apply different split methods per item (e.g., one person gets 2 shares of drinks, another gets 1 share).

### Itemized Expense Splitting

Perfect for restaurant bills and itemized receipts:

- **Per-Item Assignment** - Assign each item to specific people
- **Per-Item Split Methods** - Each item can use Equal, Exact, Percentage, or Shares splitting
- **Shared Items** - Split items with custom ratios among multiple people
- **Proportional Tax/Tip** - Automatically distribute tax/tip based on subtotal shares
- **OCR Integration** - Two-phase receipt scanning auto-populates items
- **Smart UI** - Compact view for large groups, inline buttons for small groups
- **Exact Calculations** - Handles rounding to ensure totals match exactly

**Example:** Restaurant bill with 3 items + tax/tip. Each person is assigned their items with custom split methods (one item split 2:1 by shares, another split 60/40 by percentage), and the tax/tip is distributed proportionally to their subtotal.

### Refresh Token Authentication

Secure, seamless authentication:

- **Short-lived Access Tokens** - 30-minute JWT tokens minimize security risk
- **Long-lived Refresh Tokens** - 30-day tokens stored hashed in database
- **Automatic Renewal** - Frontend transparently refreshes expired tokens
- **Server-side Revocation** - Logout invalidates tokens immediately
- **No Re-authentication** - Users stay logged in without repeated password prompts

### Dark Mode

System-wide dark theme:

- **Preference Persistence** - Saves choice to localStorage
- **System Integration** - Falls back to OS preference if not set
- **Smooth Transitions** - Animated color changes for better UX
- **Full Coverage** - All 20+ components support dark mode
- **Easy Toggle** - One-click switch in sidebar

### Progressive Web App (PWA)

Install and use offline:

- **Installable** - Add to home screen on iOS and Android
- **Offline Support** - Create and edit expenses without internet connection
- **Background Sync** - Automatically syncs changes when connection restored
- **IndexedDB Storage** - Local database for offline data persistence
- **Cached Exchange Rates** - Currency conversion works offline
- **Service Worker** - Fast loading and offline asset caching
- **App Icons** - Custom icons including maskable icons for Android

**Use Case:** Create expenses on a flight or in areas with poor connectivity. Everything syncs automatically when you're back online.

### Mobile-Optimized Experience

Native-like experience on mobile devices:

- **Custom Modals** - No browser `alert()` or `prompt()` dialogs
- **iOS Keyboard** - Numeric keypad for amount inputs
- **Web Share API** - Native sharing on mobile for group links
- **Responsive Design** - Optimized for small screens
- **Touch-Friendly** - Large tap targets and gesture support
- **Dark Mode PWA** - Themed splash screen and UI on iPhone

## Development

### Running Tests

```bash
cd backend
source venv/bin/activate
pytest tests/test_main.py
```

### Deployment (Fly.io)

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions on deploying to Fly.io.


## Environment Variables

### Backend

Create a `.env` file in the backend directory:

```env
# Required: Authentication
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# Optional: Transactional Email (Brevo API)
BREVO_API_KEY=your-brevo-api-key
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME=Splitwiser
FRONTEND_URL=https://your-domain.com

# Optional: Google Cloud Vision (OCR)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

### OCR Setup (Optional)

For receipt scanning with Google Cloud Vision:

1. Create a Google Cloud project
2. Enable Cloud Vision API
3. Create a service account with "Cloud Vision API User" role
4. Download JSON credentials file
5. Set environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
```

**Note:** Free tier includes 1,000 pages/month. Billing must be enabled but won't charge within free tier.

### Email Setup (Optional)

For transactional emails (password reset, friend requests, etc.), configure Brevo API:

1. Create a [Brevo](https://www.brevo.com/) account (free tier: 300 emails/day)
2. Verify a sender email address in Brevo dashboard
3. Generate an API key from **SMTP & API** section
4. Set environment variables (see above)

See [EMAIL_SETUP.md](EMAIL_SETUP.md) for detailed step-by-step configuration guide.

## Contributing

This is a demonstration project. Feel free to fork and modify for your own use.

## Acknowledgments

- Inspired by [Splitwise](https://www.splitwise.com/)
- Exchange rate data provided by [Frankfurter API](https://www.frankfurter.app/)
- OCR powered by [Google Cloud Vision API](https://cloud.google.com/vision)
