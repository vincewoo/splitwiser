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

## 2024-05-25 - Dashboard Balances N+1 Optimization
**Learning:** Iterating over user groups to calculate balances one-by-one (`calculate_net_balances`) causes N+1 queries (where N is the number of groups). This scales poorly for users in many groups.
**Action:** Use `calculate_net_balances_batch` to fetch all data (expenses, splits, members) for all groups in a single set of batched queries (O(1)), then process in memory.
