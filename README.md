# Splitwiser

A full-featured expense splitting application built with FastAPI and React, inspired by Splitwise.

## Features

### Core Functionality
- 👥 **User Authentication** - JWT-based authentication with secure password hashing
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
- 📸 **OCR Receipt Scanning** - Extract expense details from receipt photos using Tesseract.js
- 👻 **Guest Members** - Add non-registered users to group expenses

### Split Types
- ⚖️ **Equal Split** - Divide expense equally among participants
- 📝 **Exact Split** - Specify exact amounts for each person
- 📊 **Percentage Split** - Split by custom percentages
- 🎲 **Shares Split** - Split by number of shares

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
- **Tailwind CSS v4** - Utility-first CSS
- **Tesseract.js** - OCR for receipt scanning

### External APIs
- **Frankfurter API** - Free, real-time and historical exchange rates (no API key required)

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
splitwiser/
├── backend/
│   ├── main.py              # API endpoints and business logic
│   ├── models.py            # Database models
│   ├── schemas.py           # Pydantic schemas
│   ├── auth.py              # Authentication logic
│   ├── database.py          # Database configuration
│   ├── requirements.txt     # Python dependencies
│   └── db.sqlite3          # SQLite database (generated)
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Main app component
│   │   ├── AuthContext.tsx          # Auth context provider
│   │   ├── GroupDetailPage.tsx      # Group detail view
│   │   ├── AddExpenseModal.tsx      # Expense creation
│   │   ├── EditGroupModal.tsx       # Group editing
│   │   ├── SettleUpModal.tsx        # Settlement UI
│   │   └── ReceiptScanner.tsx       # OCR receipt scanning
│   ├── package.json         # npm dependencies
│   └── vite.config.ts       # Vite configuration
│
├── CLAUDE.md               # Development guide for Claude Code
├── CHANGELOG.md            # Version history and changes
└── README.md              # This file
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

Create a `.env` file in the backend directory:

```env
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

## Contributing

This is a demonstration project. Feel free to fork and modify for your own use.

## License

MIT License - feel free to use this project for learning or as a starting point for your own applications.

## Acknowledgments

- Inspired by [Splitwise](https://www.splitwise.com/)
- Exchange rate data provided by [Frankfurter API](https://www.frankfurter.app/)
- OCR powered by [Tesseract.js](https://tesseract.projectnaptha.com/)
