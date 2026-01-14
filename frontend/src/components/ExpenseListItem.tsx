import React, { memo } from 'react';
import { formatMoney, formatDate } from '../utils/formatters';

interface ExpenseSummary {
    id: number;
    date: string;
    icon?: string | null;
    description: string;
    amount: number;
    currency: string;
}

interface ExpenseListItemProps {
    expense: ExpenseSummary;
    payerName: string;
    onClick: (id: number) => void;
}

const ExpenseListItem: React.FC<ExpenseListItemProps> = memo(({ expense, payerName, onClick }) => {
    return (
        <button
            className="w-full text-left py-3 flex items-start lg:items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 -mx-2 px-2 rounded gap-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            onClick={() => onClick(expense.id)}
        >
            <div className="flex items-start lg:items-center gap-2 lg:gap-4 min-w-0 flex-1">
                <div className="text-xs text-gray-500 dark:text-gray-400 w-10 lg:w-12 flex-shrink-0">
                    {formatDate(expense.date, { month: 'short', day: 'numeric' })}
                </div>
                {expense.icon && (
                    <div className="text-xl flex-shrink-0">
                        {expense.icon}
                    </div>
                )}
                <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {expense.description}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        {payerName} paid
                    </div>
                </div>
            </div>
            <div className="text-xs lg:text-sm font-medium text-gray-900 dark:text-gray-100 flex-shrink-0">
                {formatMoney(expense.amount, expense.currency)}
            </div>
        </button>
    );
});

ExpenseListItem.displayName = 'ExpenseListItem';

export default ExpenseListItem;
