import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGroupData } from '../useGroupData';

const getById = vi.fn();
const getExpenses = vi.fn();
const getBalances = vi.fn();
vi.mock('../../services/api', () => ({
    api: {
        groups: {
            getById: (...args: unknown[]) => getById(...args),
            getExpenses: (...args: unknown[]) => getExpenses(...args),
            getBalances: (...args: unknown[]) => getBalances(...args),
        },
    },
}));

let refreshGeneration = 0;
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ refreshGeneration }),
}));

beforeEach(() => {
    refreshGeneration = 0;
    getById.mockReset().mockResolvedValue({ id: 7, name: 'Tahoe', default_currency: 'USD' });
    getExpenses.mockReset().mockResolvedValue([]);
    getBalances.mockReset().mockResolvedValue([]);
});

describe('useGroupData', () => {
    it('fetches once on mount', async () => {
        const { result } = renderHook(() => useGroupData(7));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(getExpenses).toHaveBeenCalledTimes(1);
    });

    it('re-fetches when the app-wide refresh generation moves', async () => {
        // An expense added from the shell's modal calls refreshAll(), which
        // bumps the generation; the group showing that expense must follow
        // without the route remounting.
        const { result, rerender } = renderHook(() => useGroupData(7));
        await waitFor(() => expect(result.current.loading).toBe(false));

        getExpenses.mockResolvedValue([{ id: 1, description: 'Cabin' }]);
        refreshGeneration = 1;
        rerender();

        await waitFor(() => expect(getExpenses).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.expenses).toHaveLength(1));
    });

    it('keeps the loaded group on screen while it re-fetches', async () => {
        const { result, rerender } = renderHook(() => useGroupData(7));
        await waitFor(() => expect(result.current.group).not.toBeNull());

        refreshGeneration = 1;
        rerender();
        // `loading` flips, but the group is still there for the page to
        // render around — the page guards on `loading && !group`.
        expect(result.current.group).not.toBeNull();
        await waitFor(() => expect(result.current.loading).toBe(false));
    });
});
