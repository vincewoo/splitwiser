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
- 💱 **Multi-Currency Support** - Support for USD, EUR, GBP, JPY, CAD
- 📅 **Historical Exchange Rates** - Automatic caching of exchange rates from expense date
- 🌍 **Live Currency Conversion** - Real-time exchange rates via Frankfurter API
- 🎯 **Smart Currency Grouping** - View balances grouped by currency or converted to group default
- 📸 **OCR Receipt Scanning** - Extract expense details from receipt photos using Google Cloud Vision API
- 👻 **Guest Members** - Add non-registered users with claiming and balance aggregation
- 🔗 **Public Share Links** - Share read-only group views without requiring login
- 📝 **Notes on Expenses** - Add freeform text notes to expense entries
- 🏷️ **Icons/Categories** - Emoji icons for groups and expense categorization
- 🌙 **Dark Mode** - System-wide dark theme with preference persistence
- 🔑 **Secure Authentication** - Refresh tokens with server-side revocation

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
│   │   └── splits.py                # Split calculation logic
│   ├── ocr/                         # OCR integration
│   │   ├── service.py               # Google Cloud Vision client
│   │   └── parser.py                # Receipt text parsing
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
│   │   ├── AddGuestModal.tsx        # Add guest users
│   │   ├── services/
│   │   │   └── api.ts               # Centralized API client
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

### Guest User Management

Add non-registered users to groups for expense tracking:

- **Add Guests** - Invite people without requiring registration
- **Guest Participation** - Guests can be payers or participants in expenses
- **Claim Profiles** - Registered users can claim guest accounts to merge expense history
- **Balance Aggregation** - Link guests to managers for simplified balance tracking
- **Automatic Migration** - When claiming, all guest expenses transfer to registered account

**Use Case:** Add "Bob's Friend" to a trip group. Later, when they register, they can claim the guest profile and inherit all expense history.

### Itemized Expense Splitting

Perfect for restaurant bills and itemized receipts:

- **Per-Item Assignment** - Assign each item to specific people
- **Shared Items** - Split items equally among multiple people
- **Proportional Tax/Tip** - Automatically distribute tax/tip based on subtotal shares
- **OCR Integration** - Scan receipts to auto-populate items
- **Smart UI** - Compact view for large groups, inline buttons for small groups
- **Exact Calculations** - Handles rounding to ensure totals match exactly

**Example:** Restaurant bill with 3 items + tax/tip. Each person is assigned their items, and the tax/tip is distributed proportionally to their subtotal.

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

## Development

### Running Tests

```bash
cd backend
source venv/bin/activate
pytest tests/test_main.py
```

### Building for Production

```bash
# Frontend
cd frontend
npm run build

# Backend
cd backend
# Set production environment variables
# Deploy with gunicorn or similar WSGI server
```

## Environment Variables

### Backend

Create a `.env` file in the backend directory:

```env
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30
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

## Contributing

This is a demonstration project. Feel free to fork and modify for your own use.

## Acknowledgments

- Inspired by [Splitwise](https://www.splitwise.com/)
- Exchange rate data provided by [Frankfurter API](https://www.frankfurter.app/)
- OCR powered by [Google Cloud Vision API](https://cloud.google.com/vision)
