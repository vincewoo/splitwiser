# Bolt's Journal

## 2024-05-23 - Initial Setup
**Learning:** Performance optimization requires a baseline.
**Action:** Always verify existing tests and linting before starting.

## 2024-05-24 - N+1 Query in Guest Display Names
**Learning:** Manual relationship handling in SQLAlchemy (without ORM relationships) requires vigilant batch fetching. Helper functions like `get_guest_display_name` that take a `db` session often hide N+1 queries when called in loops.
**Action:** When seeing a loop over items that calls a display helper function, check if that helper hits the DB. If so, batch fetch the data beforehand and pass a dictionary.

## 2024-05-24 - Public Balances N+1 Optimization
**Learning:** Public endpoints that access shared resources (like group expenses) are just as susceptible to N+1 issues as authenticated ones, especially when traversing "virtual" relationships like expenses -> splits.
**Action:** Always batch fetch `ExpenseSplit`s when retrieving multiple expenses, using `expense_id.in_(...)` and grouping in a dictionary.

## 2024-05-24 - Intl Formatter Crash Risk
**Learning:** Replacing `date.toLocaleDateString()` with `Intl.DateTimeFormat.format()` for performance can cause crashes. `toLocaleDateString` gracefully returns "Invalid Date", while `format()` throws a `RangeError`.
**Action:** Always validate input dates with `isNaN(date.getTime())` before using `Intl.DateTimeFormat.format()`.

## 2024-05-25 - Itemized Expense N+1 Optimization
**Learning:** Display helpers like `get_guest_display_name` can trigger hidden N+1 queries if they internally query for claimed users.
**Action:** Always pre-fetch "claimed by" users when handling lists of guests, and pass the data explicitly or map it manually, rather than relying on the helper inside a loop.

## 2024-05-25 - Friends List N+1 Optimization
**Learning:** Iterating over a relationship table (like `Friendship`) and querying the related entity (like `User`) one-by-one inside the loop causes N+1 queries.
**Action:** Collect all related IDs first (e.g., `friend_ids`) and use a single batch query with `filter(Model.id.in_(ids))` to fetch all related records at once.
