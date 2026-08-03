import React, { useMemo } from 'react';
import { IconTile, Money, TagPill } from '../ui';
import { formatDate } from '../../utils/formatters';
import { expenseImpact, impactLabel } from '../../utils/expenseImpact';
import type { GroupExpense } from '../../hooks/useGroupData';

export interface GroupExpenseListProps {
    expenses: GroupExpense[];
    currentUserId?: number;
    payerName: (expense: GroupExpense) => string;
    selectedId?: number | null;
    /** Omit on read-only surfaces; rows then render as plain, unfocusable rows. */
    onSelect?: (expense: GroupExpense) => void;
    /** 'compact' is the desktop pane; 'full' is the mobile list. */
    variant?: 'compact' | 'full';
}

/** How the split was made, phrased for the row's second line. */
function splitSummary(expense: GroupExpense): string {
    const count = expense.splits?.length ?? 0;
    switch (expense.split_type) {
        case 'ITEMIZED':
            return 'itemized';
        case 'PERCENTAGE':
            return `percentages, ${count} ways`;
        case 'SHARES':
            return `shares, ${count} ways`;
        case 'EXACT':
            return `exact, ${count} ways`;
        default:
            return count ? `equal, ${count} ways` : 'equal';
    }
}

const ExpenseRow: React.FC<{
    expense: GroupExpense;
    currentUserId?: number;
    payerName: (expense: GroupExpense) => string;
    selected: boolean;
    onSelect?: () => void;
    compact: boolean;
}> = ({ expense, currentUserId, payerName, selected, onSelect, compact }) => {
    const impact = expenseImpact(expense, currentUserId);
    /*
     * A settlement carries no impact line. It moves money that was already
     * owed rather than creating a new debt, and the split it is recorded
     * through makes the person being paid look like the one taking it on —
     * "Tim pays Vince … you owe $465" to Vince, who was just paid. The row
     * already says who paid whom, and the amount is the transfer itself.
     */
    const label = expense.is_settlement ? 'none' : impactLabel(impact);

    const base = compact
        ? 'flex items-center gap-3 px-2.5 py-[11px] rounded-sw-row w-full text-left'
        : 'flex items-center gap-3 py-[11px] border-b border-sw-line w-full text-left';

    const classes = `${base} ${
        selected
            ? 'bg-sw-surface shadow-[0_0_0_1px_var(--sw-accent-soft)]'
            : onSelect
              ? 'hover:bg-sw-surface'
              : ''
    } ${expense.is_settlement ? 'opacity-[0.72]' : ''} ${
        onSelect
            ? 'focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2'
            : ''
    }`;

    const inner = (
        <>
            <IconTile
                tone={compact ? 'neutral' : 'surface'}
                size={compact ? 32 : 38}
            >
                {expense.icon || (expense.is_settlement ? '🏦' : '🧾')}
            </IconTile>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span
                        className={`${compact ? 'text-[13.5px]' : 'text-sm'} font-medium truncate`}
                    >
                        {expense.description}
                    </span>
                    {expense.split_type === 'ITEMIZED' && (
                        <TagPill tone="outline" className="flex-none">
                            itemized
                        </TagPill>
                    )}
                </div>
                <div
                    className={`${compact ? 'text-[11.5px]' : 'text-xs'} text-sw-dim truncate`}
                >
                    {expense.is_settlement
                        ? payerName(expense)
                        : `${payerName(expense)} · ${splitSummary(expense)}`}
                </div>
            </div>

            <div className="text-right flex-none">
                <Money
                    amount={expense.amount}
                    currency={expense.currency}
                    className={`${compact ? 'text-[13.5px]' : 'text-sm'} font-medium`}
                />
                {label !== 'none' &&
                    (compact ? (
                        // Desktop has room to say it in words.
                        <div className="text-[11.5px]">
                            <span
                                className={impact.amount > 0 ? 'text-sw-pos' : 'text-sw-neg'}
                            >
                                {label === 'lent' ? 'you lent ' : 'you owe '}
                                <Money
                                    amount={Math.abs(impact.amount)}
                                    currency={expense.currency}
                                    tone={impact.amount > 0 ? 'positive' : 'negative'}
                                />
                            </span>
                        </div>
                    ) : (
                        // Mobile carries the meaning in the sign and the color.
                        <Money
                            amount={impact.amount}
                            currency={expense.currency}
                            sign="always"
                            tone="auto"
                            className="block text-[11.5px]"
                        />
                    ))}
            </div>
        </>
    );

    if (!onSelect) {
        return <div className={classes}>{inner}</div>;
    }

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? 'true' : undefined}
            className={classes}
        >
            {inner}
        </button>
    );
};

/**
 * The group's expenses, grouped under date headings — the shape both the
 * desktop workspace pane and the mobile group screen use.
 */
const GroupExpenseList: React.FC<GroupExpenseListProps> = ({
    expenses,
    currentUserId,
    payerName,
    selectedId,
    onSelect,
    variant = 'compact',
}) => {
    const compact = variant === 'compact';

    // Newest first, then bucketed by day so each date heading appears once.
    const days = useMemo(() => {
        const sorted = [...expenses].sort((a, b) => {
            const byDate = b.date.localeCompare(a.date);
            return byDate !== 0 ? byDate : b.id - a.id;
        });

        const buckets: { date: string; expenses: GroupExpense[] }[] = [];
        for (const expense of sorted) {
            const last = buckets[buckets.length - 1];
            if (last && last.date === expense.date) {
                last.expenses.push(expense);
            } else {
                buckets.push({ date: expense.date, expenses: [expense] });
            }
        }
        return buckets;
    }, [expenses]);

    if (expenses.length === 0) {
        return (
            <p className="text-[12.5px] text-sw-dim text-center py-10">
                Nothing here yet.
            </p>
        );
    }

    return (
        <div className="flex flex-col">
            {days.map(({ date, expenses: dayExpenses }) => (
                <React.Fragment key={date}>
                    <div
                        className={`${compact ? 'px-2' : ''} pt-3 pb-1 text-[11px] uppercase tracking-[0.09em] text-sw-dim`}
                    >
                        {formatDate(date, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                        })}
                    </div>
                    {dayExpenses.map((expense) => (
                        <ExpenseRow
                            key={expense.id}
                            expense={expense}
                            currentUserId={currentUserId}
                            payerName={payerName}
                            selected={expense.id === selectedId}
                            onSelect={onSelect ? () => onSelect(expense) : undefined}
                            compact={compact}
                        />
                    ))}
                </React.Fragment>
            ))}
        </div>
    );
};

export default GroupExpenseList;
