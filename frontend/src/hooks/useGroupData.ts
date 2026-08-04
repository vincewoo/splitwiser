import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Group, GroupBalance } from '../types/group';

export interface GroupExpenseSplit {
    id: number;
    expense_id: number;
    user_id: number;
    is_guest: boolean;
    amount_owed: number;
    percentage?: number;
    shares?: number;
    user_name: string;
}

export interface GroupExpense {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    group_id: number | null;
    splits: GroupExpenseSplit[];
    split_type?: string;
    icon?: string | null;
    is_settlement?: boolean;
    notes?: string | null;
    receipt_image_path?: string | null;
}

interface GroupData {
    group: Group | null;
    expenses: GroupExpense[];
    balances: GroupBalance[];
    loading: boolean;
    error: string | null;
    /** false shows each currency separately; true converts to the group's own. */
    inGroupCurrency: boolean;
    setInGroupCurrency: (value: boolean) => void;
    reload: () => Promise<void>;
}

/**
 * Group, its expenses and its balances, for the authenticated group workspace.
 *
 * Balances are fetched separately from the group itself because the conversion
 * mode is a query parameter — the server does the currency work against
 * historical rates, so switching modes is a refetch rather than a recompute.
 */
export function useGroupData(groupId: number | undefined): GroupData {
    const [group, setGroup] = useState<Group | null>(null);
    const [expenses, setExpenses] = useState<GroupExpense[]>([]);
    const [balances, setBalances] = useState<GroupBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [inGroupCurrency, setInGroupCurrency] = useState(true);

    const load = useCallback(async () => {
        if (groupId === undefined) return;
        setLoading(true);
        setError(null);

        try {
            const [groupData, expensesData] = await Promise.all([
                api.groups.getById(groupId),
                api.groups.getExpenses(groupId),
            ]);
            setGroup(groupData);
            setExpenses(expensesData);

            const balancesData = await api.groups.getBalances(
                groupId,
                inGroupCurrency ? groupData.default_currency : undefined
            );
            setBalances(balancesData);
        } catch (err) {
            const message = err instanceof Error ? err.message : '';
            if (message.includes('404') || message.includes('not found')) {
                setError('Group not found');
            } else if (message.includes('403')) {
                setError('You are not a member of this group');
            } else {
                setError('Failed to load group data');
            }
        } finally {
            setLoading(false);
        }
    }, [groupId, inGroupCurrency]);

    useEffect(() => {
        load();
    }, [load]);

    return {
        group,
        expenses,
        balances,
        loading,
        error,
        inGroupCurrency,
        setInGroupCurrency,
        reload: load,
    };
}
