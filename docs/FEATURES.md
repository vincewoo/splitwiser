# Feature Details

## Group Default Currency

Groups can have a default currency that streamlines expense creation and balance viewing.

**Database Schema:**
- `groups.default_currency` (String, default: "USD") - The preferred currency for the group

**Supported Currencies:**
- USD (US Dollar)
- EUR (Euro)
- GBP (British Pound)
- JPY (Japanese Yen)
- CAD (Canadian Dollar)
- CNY (Chinese Yuan)
- HKD (Hong Kong Dollar)

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

## Historical Exchange Rate Caching

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

## Balance Grouping by Currency

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

## Dark Mode

System-wide dark theme with user preference persistence.

**Theme Context ([ThemeContext.tsx](../frontend/src/ThemeContext.tsx)):**
- React Context API for global theme state
- Persists preference to localStorage
- Falls back to system preference if no saved preference
- Applies 'dark' class to `<html>` element

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

## Currency Enhancements

### Additional Currencies

Added support for:
- **CNY** - Chinese Yuan (Renminbi) 🇨🇳
- **HKD** - Hong Kong Dollar 🇭🇰

### Currency Flags

Visual currency selector with flag emojis:
- USD 🇺🇸, EUR 🇪🇺, GBP 🇬🇧, JPY 🇯🇵, CAD 🇨🇦, CNY 🇨🇳, HKD 🇭🇰

### Recently-Used Sorting

Currency selectors show recently-used currencies first:
- Stored in localStorage
- Top 3 recent currencies sorted to top

```typescript
// Save currency usage
const recentCurrencies = JSON.parse(localStorage.getItem('recentCurrencies') || '[]');
recentCurrencies.unshift(selectedCurrency);
localStorage.setItem('recentCurrencies', JSON.stringify(recentCurrencies.slice(0, 3)));
```
