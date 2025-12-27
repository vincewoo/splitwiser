"""
Migration script to normalize expense date formats.

Converts ISO datetime strings (e.g., 2025-12-27T00:00:00.000Z) 
to plain date strings (e.g., 2025-12-27) for consistent sorting.

Run: python3 migrate_normalize_dates.py
"""

from database import SessionLocal
from models import Expense


def normalize_date(date_str: str) -> str:
    """Normalize date string to YYYY-MM-DD format."""
    if not date_str:
        return date_str
    if 'T' in date_str:
        return date_str.split('T')[0]
    return date_str


def main():
    db = SessionLocal()
    expenses = db.query(Expense).all()
    updated = 0
    
    for expense in expenses:
        if expense.date and 'T' in expense.date:
            old_date = expense.date
            expense.date = normalize_date(expense.date)
            print(f"Fixed expense {expense.id}: {old_date} -> {expense.date}")
            updated += 1
    
    db.commit()
    db.close()
    print(f"\nMigration complete. Updated {updated} expenses.")


if __name__ == "__main__":
    main()
