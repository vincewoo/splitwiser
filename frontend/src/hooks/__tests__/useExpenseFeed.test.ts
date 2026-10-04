import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExpenseFeed } from '../useExpenseFeed';

const getAll = vi.fn();
vi.mock('../../services/api', () => ({
    expensesApi: {
        getAll: (...args: unknown[]) => getAll(...args),
    },
}));

let refreshGeneration = 0;
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ refreshGeneration }),
}));

const cabin = {
    id: 1,
    description: 'Cabin',
    amount: 5000,
    currency: 'USD',
    date: '2026-10-01',
    payer_id: 1,
    group_id: 7,
};

beforeEach(() => {
    refreshGeneration = 0;
    getAll.mockReset().mockResolvedValue([]);
});

describe('useExpenseFeed', () => {
    it('fetches once on mount', async () => {
        const { result } = renderHook(() => useExpenseFeed());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(getAll).toHaveBeenCalledTimes(1);
    });

    it('re-fetches exactly once when the app-wide refresh generation moves', async () => {
        // An expense added from the shell's modal (or a pull to refresh) calls
        // refreshAll(), which bumps the generation; the Activity feed and the
        // Overview's "Lately" card must follow without remounting. If someone
        // drops refreshGeneration from the effect's deps, FAB-adds go stale
        // again and nothing fails.
        const { result, rerender } = renderHook(() => useExpenseFeed());
        await waitFor(() => expect(result.current.loading).toBe(false));

        getAll.mockResolvedValue([cabin]);
        refreshGeneration = 1;
        rerender();

        await waitFor(() => expect(result.current.expenses).toHaveLength(1));
        expect(result.current.expenses[0].description).toBe('Cabin');
        // One bump, one fetch — a third call would mean the effect also keys
        // on something that changes alongside the generation.
        expect(getAll).toHaveBeenCalledTimes(2);
    });
});
