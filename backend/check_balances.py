from database import SessionLocal
import models

db = SessionLocal()
try:
    # Calculate balances for Tim (guest ID 12)
    tim_id = 12
    jezmin_id = 13
    group_id = 1

    # Get all expenses and calculate balances manually
    expenses = db.query(models.Expense).filter(models.Expense.group_id == group_id).all()

    tim_balance = {}
    jezmin_balance = {}

    for expense in expenses:
        splits = db.query(models.ExpenseSplit).filter(models.ExpenseSplit.expense_id == expense.id).all()

        for split in splits:
            # Check if it's Tim or Jezmin as debtor
            if split.is_guest and split.user_id == tim_id:
                if expense.currency not in tim_balance:
                    tim_balance[expense.currency] = 0
                tim_balance[expense.currency] -= split.amount_owed
            if split.is_guest and split.user_id == jezmin_id:
                if expense.currency not in jezmin_balance:
                    jezmin_balance[expense.currency] = 0
                jezmin_balance[expense.currency] -= split.amount_owed

        # Check if Tim or Jezmin is the payer
        if expense.payer_is_guest and expense.payer_id == tim_id:
            for split in splits:
                if expense.currency not in tim_balance:
                    tim_balance[expense.currency] = 0
                tim_balance[expense.currency] += split.amount_owed
        if expense.payer_is_guest and expense.payer_id == jezmin_id:
            for split in splits:
                if expense.currency not in jezmin_balance:
                    jezmin_balance[expense.currency] = 0
                jezmin_balance[expense.currency] += split.amount_owed

    print('Raw balances:')
    print('  Tim balance:', tim_balance)
    print('  Jezmin balance:', jezmin_balance)

    # Convert to dollars for easier reading
    print('\nIn dollars:')
    for currency, amount_cents in tim_balance.items():
        print(f'  Tim {currency}: ${amount_cents / 100:.2f}')
    for currency, amount_cents in jezmin_balance.items():
        print(f'  Jezmin {currency}: ${amount_cents / 100:.2f}')
finally:
    db.close()
