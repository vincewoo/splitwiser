import React from 'react';
import { IconTile, Money } from './ui';
import { formatDate } from '../utils/formatters';
import { fallbackIcon, isSettlement } from '../utils/expenseKind';
import type { FeedExpense } from '../hooks/useExpenseFeed';

export interface ExpenseFeedRowProps {
    expense: FeedExpense;
    /** Resolves a payer id to a display name; returns null for unknown ids. */
    payerName: (expense: FeedExpense) => string;
    /** Group name for the expense, when it belongs to one. */
    groupName?: string | null;
    onClick?: () => void;
    /** 'md' is the standalone feed; 'sm' is the Overview's "Lately" card. */
    size?: 'sm' | 'md';
}

/**
 * One expense in a feed: an icon tile, who paid and where, and the bill total.
 *
 * The amount shown is the whole bill, not the viewer's share — the list
 * endpoint does not return splits.
 */
const ExpenseFeedRow: React.FC<ExpenseFeedRowProps> = ({
    expense,
    payerName,
    groupName,
    onClick,
    size = 'md',
}) => {
    const small = size === 'sm';
    const subtitle = [payerName(expense), groupName].filter(Boolean).join(' · ');

    const inner = (
        <>
            <IconTile tone={small ? 'neutral' : 'surface'} size={small ? 30 : 38}>
                {expense.icon || fallbackIcon(expense)}
            </IconTile>
            <div className="flex-1 min-w-0">
                <div
                    className={`${small ? 'text-[13.5px]' : 'text-sm'} font-medium truncate`}
                >
                    {expense.description}
                </div>
                <div
                    className={`${small ? 'text-[11.5px]' : 'text-xs'} text-sw-dim truncate`}
                >
                    {subtitle}
                </div>
            </div>
            <div className="text-right flex-none">
                <Money
                    amount={expense.amount}
                    currency={expense.currency}
                    // Only settlements recede; money received is news.
                    tone={isSettlement(expense) ? 'muted' : 'default'}
                    className={small ? 'text-[13px]' : 'text-sm'}
                />
                <div className="text-[11.5px] text-sw-dim">
                    {formatDate(expense.date, { month: 'short', day: 'numeric' })}
                </div>
            </div>
        </>
    );

    const classes = small
        ? 'flex items-center gap-3 px-2.5 py-[9px] rounded-[9px] w-full text-left'
        : 'flex items-center gap-3 py-[11px] border-b border-sw-line w-full text-left';

    if (!onClick) {
        return <div className={classes}>{inner}</div>;
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className={`${classes} hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2`}
        >
            {inner}
        </button>
    );
};

export default ExpenseFeedRow;
