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

## 2025-05-24 - Itemized Expense N+1
**Learning:** Iterating over "items" of an expense and then fetching "assignments" for each item creates a nested N+1 loop (N items * M assignments). Using helper functions for user display names inside this inner loop exacerbates the problem.
**Action:** Flatten nested loops by fetching all child records (assignments) for all parent records (items) in one go using `in_` clauses, then regroup in memory. Re-implement simple helper logic (like name lookup) using pre-fetched dictionaries.
