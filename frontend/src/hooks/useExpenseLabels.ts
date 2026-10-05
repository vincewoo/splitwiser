import { useCallback, useMemo } from 'react';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth } from '../AuthContext';
import { payerVerb } from '../utils/expenseKind';
import type { FeedExpense } from './useExpenseFeed';

/**
 * Resolves the ids on a feed expense into names the user recognises.
 *
 * Shared by the Activity page and the Overview's "Lately" card so both phrase
 * an expense the same way.
 */
export function useExpenseLabels() {
    const { user } = useAuth();
    const { groups, friends } = useAppData();

    const groupNames = useMemo(
        () => new Map(groups.map((g) => [g.id, g.name])),
        [groups]
    );
    const friendNames = useMemo(
        () => new Map(friends.map((f) => [f.id, f.full_name])),
        [friends]
    );

    const payerName = useCallback(
        (expense: FeedExpense): string => {
            const verb = payerVerb(expense);
            if (expense.payer_is_guest) return `A guest ${verb}`;
            if (expense.payer_id === user?.id) return `You ${verb}`;
            const name = friendNames.get(expense.payer_id);
            return name ? `${name} ${verb}` : `Someone ${verb}`;
        },
        [friendNames, user?.id]
    );

    const groupName = useCallback(
        (expense: FeedExpense): string | null =>
            expense.group_id ? groupNames.get(expense.group_id) ?? null : null,
        [groupNames]
    );

    return { payerName, groupName };
}
