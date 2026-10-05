import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../contexts/AppDataContext';
import { expensesApi } from '../services/api';
import type { ExpenseKind } from '../utils/expenseKind';

export interface FeedExpense {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest?: boolean;
    group_id: number | null;
    icon?: string | null;
    is_settlement?: boolean;
    kind?: ExpenseKind;
}

/**
 * Every expense the user is part of, newest first.
 *
 * Shared by the Activity page and the Overview's "Lately" card so the two do
 * not each define their own sort order.
 *
 * Note: /expenses returns expenses without their splits, so callers can show
 * the bill total but not the user's share of it.
 */
export function useExpenseFeed(): {
    expenses: FeedExpense[];
    loading: boolean;
} {
    const { refreshGeneration } = useAppData();
    const [expenses, setExpenses] = useState<FeedExpense[]>([]);
    const [loading, setLoading] = useState(true);

    // On mount, and again on every global refresh (see `refreshGeneration`).
    useEffect(() => {
        let cancelled = false;
        expensesApi
            .getAll()
            .then((data: FeedExpense[]) => {
                if (!cancelled) setExpenses(data);
            })
            .catch((error) => console.error('Failed to fetch expenses:', error))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [refreshGeneration]);

    const sorted = useMemo(
        () =>
            [...expenses].sort((a, b) => {
                const byDate = b.date.localeCompare(a.date);
                // Same-day expenses fall back to id, so the feed is stable and
                // the most recently added leads.
                return byDate !== 0 ? byDate : b.id - a.id;
            }),
        [expenses]
    );

    return { expenses: sorted, loading };
}
