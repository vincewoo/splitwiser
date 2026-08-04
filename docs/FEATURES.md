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

## Venmo Hand-off on Settle Up

Splitwiser records that a debt was settled; it never moves money. This closes
the gap between the two by handing the payment to Venmo with the recipient,
amount and note already filled in, so nobody retypes a figure they might get
wrong.

### Setting a handle

- `User.venmo_username` — nullable, no default. Absent means "I haven't set
  one", which is the right starting state for every existing user.
- Set from Account settings. The server strips a leading `@` and surrounding
  whitespace, so pasting `@maya-chen` straight off Venmo works.
- An **empty** value clears the handle; **omitting** the field leaves it alone.
  That distinction matters because saving any other part of the profile must
  not wipe it.
- Validation is deliberately loose beyond the obvious unsafe characters
  (`[A-Za-z0-9_-]`, max 30). Venmo owns the rules for what handles exist and
  has changed them before — rejecting a handle somebody actually has would be
  worse than letting a bad one through, where the link just lands on a Venmo
  page that says no such user.

### Who can see it

Two audiences, both people you already share money with:

- **Friends** — `GET /friends` carries `venmo_username`.
- **Fellow group members** — `GET /simplify_debts/{group_id}` returns a
  `participants` array beside `transactions`, giving each id a `display_name`
  and `venmo_username`. That endpoint already requires group membership, which
  is exactly the right gate. It also fixes an older wart: the settle screen
  could only name people from the friends list, so a group member you had not
  befriended read as "Person 7".

- **Whoever holds a tab's link** — `GET /public/tabs/{share_token}` returns
  `host_name` and `host_venmo_username`. This is the one unauthenticated
  audience, and it is a deliberate carve-out rather than a loosening: a tab is
  precisely where you owe somebody you may have just met, with no group, no
  friendship and often no second meeting, so the link is the only channel
  there is. Narrow in three ways — only the **host's** handle, never another
  claimer's; only while the token is live, since a revoked or expired one is
  refused before the payload is built; and never on a *group* share link,
  which `test_venmo_username.py` still asserts.

  "Host" means whoever fronted the bill, which is not always the person who
  opened the tab — see *Who paid* in `docs/TABS.md`. When that person has no
  Splitwiser account the handle comes off their seat rather than a `User` row,
  which is the case the seat-level handle exists for: everyone at the table
  owes somebody who is not in the app at all, and the link is the only way to
  tell them where to send it.

Group share links remain closed: a handle must not ride along with a link to a
standing group's whole history.

### Where it appears

Settling up is not one screen, so the hand-off is not one button. Every surface
that offers to settle a specific debt offers to hand it to Venmo, rendered by
the shared `frontend/src/components/VenmoButton.tsx`:

| Surface | Reached from | Figure handed over |
| --- | --- | --- |
| `routes/SettleUpPage.tsx` | `/settle` — the FAB, the overview, the mobile balances card | One payment inside one group |
| `SimplifyDebtsModal.tsx` | A group's **Settle up** (header on desktop, footer on mobile) | One payment inside that group |
| `SettleUpModal.tsx` | A person's **Settle up** | The amount being typed, to that person |
| `routes/OverviewPage.tsx` | The "Clear it in N payments" card | One person's balance, netted across groups |
| `routes/TabClaimPage.tsx` | A tab's share link — no account, no shell | The claimer's own share, paid to the host |

Two things stay true wherever it appears. Only debts the signed-in user is
party to get a button — `SimplifyDebtsModal` lists the whole group's payments,
including ones between two other people, and those are somebody else's to make.
And the hand-off never stands in for recording: each surface keeps its own
"Mark as paid" or **Save** beside it.

Rows that only *navigate* to a settle surface — the people list, a person's
balance card — deliberately have no button. They lead somewhere that does. The
tab board and the pass-the-phone screen have none either: both are the host's
own device, and the host is the one being paid.

The claim page carries one extra caution the others do not need. While the tab
is open the figure is provisional — unclaimed lines spread across everyone at
the table, so a share sent halfway through claiming is a share sent short. The
button says so until the tab closes and the number is final.

### The link

Built by `frontend/src/utils/venmo.ts`:

```
https://venmo.com/?txn=pay&audience=private&recipients=<handle>&amount=<dollars>&note=<note>
```

- **`txn`** is `pay` when you owe them and `charge` when they owe you, so the
  button reads "Pay with Venmo" or "Ask on Venmo".
- **The app scheme first, https as the fallback.** `buildVenmoLinks` returns
  both — `venmo://paycharge?<same query>` and the https form. On a touch device
  `openVenmo` fires the scheme, then falls back to https unless the page gets
  hidden first, since being backgrounded is what actually happens when another
  app takes over. Any of `visibilitychange`, `pagehide` or `blur` counts,
  because which one fires varies by browser. On a device with no coarse pointer
  there is no app to reach, so it skips the scheme and opens https directly
  rather than burning the timeout.
- The button is still a real `<a href>` pointing at the https link, so it can
  be copied, middle-clicked and opened in a new tab; the click handler only
  upgrades an ordinary left-click, and bows out on meta/ctrl/shift.
- **USD only.** Venmo has no notion of the other currencies this app supports,
  and pre-filling `52.14` from a EUR debt would ask for the wrong number of
  dollars. `buildVenmoLink` returns `null` for anything else and the UI says
  why rather than silently dropping the button.
- The note is plain ASCII: it lands in a Venmo memo, where a middot arrives as
  `%C2%B7`.

### It does not mark anything paid

Opening Venmo is not proof of payment — there is no callback and no way to
learn whether the transfer went through. "Mark as paid" stays a separate,
deliberate action that records the settlement expense exactly as before. The
row says so in as many words. `VenmoButton` also cancels its pending app→web
fallback on unmount, so dismissing a modal mid-hand-off cannot navigate the
page out from under you a second later.

### When there is no button

- **Guests** — no account, so no handle to reach. Nothing is said, because
  there is nothing the viewer could do about it.
- **Somebody who hasn't set a handle** — likewise silent. Whether they publish
  one is their business, not a fault in the debt.
- **A debt in another currency** — this one *is* explained, by
  `venmoUnavailableNote(currency)`: it is a fact about Venmo the viewer can act
  on by settling another way.
- **A payment between two other people** — real, shown, but not this user's to
  make.
