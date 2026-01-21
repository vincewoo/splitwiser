# Database Schema

## Tables

### Core Tables

```sql
-- Users
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    full_name TEXT NOT NULL
);

-- Groups
CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_by_id INTEGER NOT NULL,
    default_currency TEXT DEFAULT 'USD',
    icon TEXT,
    share_link_id TEXT UNIQUE,
    is_public BOOLEAN DEFAULT FALSE
);

-- Group Members
CREATE TABLE group_members (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    managed_by_id INTEGER,
    managed_by_type TEXT
);

-- Friendships
CREATE TABLE friendships (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending'
);
```

### Expense Tables

```sql
-- Expenses
CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'USD',
    date TEXT NOT NULL,
    group_id INTEGER,
    payer_id INTEGER NOT NULL,
    payer_is_guest BOOLEAN DEFAULT FALSE,
    split_type TEXT DEFAULT 'EQUAL',
    exchange_rate TEXT,
    receipt_image_path TEXT,
    icon TEXT,
    notes TEXT
);

-- Expense Splits
CREATE TABLE expense_splits (
    id INTEGER PRIMARY KEY,
    expense_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    is_guest BOOLEAN DEFAULT FALSE
);

-- Expense Items (for ITEMIZED split type)
CREATE TABLE expense_items (
    id INTEGER PRIMARY KEY,
    expense_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    is_tax_tip BOOLEAN DEFAULT FALSE
);

-- Expense Item Assignments
CREATE TABLE expense_item_assignments (
    id INTEGER PRIMARY KEY,
    expense_item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_guest BOOLEAN DEFAULT FALSE
);
```

### Guest & Auth Tables

```sql
-- Guest Members
CREATE TABLE guest_members (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_by_id INTEGER NOT NULL,
    claimed_by_id INTEGER,
    managed_by_id INTEGER,
    managed_by_type TEXT
);

-- Refresh Tokens
CREATE TABLE refresh_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE
);
```

## Performance Optimizations

### Database Optimizations

**Indexes Added:**
- Expense queries indexed for faster lookups
- Group member queries optimized with proper joins
- Balance calculations use efficient SQL queries

**N+1 Query Elimination:**
- Group details endpoint: Uses `joinedload` for members and guests
- Expense listing: Pre-loads related data in single query
- Balance calculations: Aggregates data efficiently
- Public group endpoints: Optimized for anonymous access
- Friend expenses and balances: Batch loading implemented

### Optimized Endpoints
- `GET /groups` - Group listing with member counts
- `GET /groups/{group_id}` - Group details with all relations
- `GET /groups/{group_id}/balances` - Balance calculations
- `GET /expenses` - Expense listing with participant details
- `GET /public/groups/{share_link_id}` - Public group access
- `GET /friends` - Friend listing with expense data

## Security Features

### Rate Limiting

**Protected Endpoints:**
- Authentication endpoints (`/token`, `/register`) - Prevents brute force attacks
- OCR endpoint (`/ocr/scan-receipt`) - Prevents API abuse (10MB file limit)
- Rate limits enforced using `slowapi` library
- Supports `X-Forwarded-For` header for proxy environments

**Configuration:**
- Default: 5 requests per minute for auth endpoints
- Default: 10 requests per minute for OCR endpoint

### Security Headers

**HTTP Security Headers:**
- `Content-Security-Policy` - Restricts resource loading
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS protection

### Input Validation

**Schema Validation:**
- Maximum length enforcement on all text fields
- File upload size limits (10MB for receipts)
- Email format validation
- Currency validation against allowed list

**Information Leakage Prevention:**
- OCR error messages sanitized
- Generic error responses for security-sensitive operations
- No exposure of internal paths or stack traces
