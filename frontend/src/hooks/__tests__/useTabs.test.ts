import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTabs } from '../useTabs';

const getAll = vi.fn();
vi.mock('../../services/api', () => ({
    tabsApi: {
        getAll: (...args: unknown[]) => getAll(...args),
    },
}));

let refreshGeneration = 0;
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ refreshGeneration }),
}));

const brunch = { id: 3, status: 'open', total: 8600 };
const karaoke = { id: 4, status: 'open', total: 12000 };
const golf = { id: 5, status: 'closed', total: 58903 };

beforeEach(() => {
    refreshGeneration = 0;
    getAll.mockReset().mockResolvedValue([brunch]);
});

describe('useTabs', () => {
    it('fetches every tab once on mount and splits open from closed', async () => {
        getAll.mockResolvedValue([brunch, golf]);
        const { result } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.openTabs).toEqual([brunch]);
        expect(result.current.closedTabs).toEqual([golf]);
        expect(getAll).toHaveBeenCalledTimes(1);
        expect(getAll).toHaveBeenCalledWith();
    });

    it('counts as loaded when the fetch fails, so a page stops saying Loading', async () => {
        getAll.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.openTabs).toEqual([]);
    });

    it('re-fetches exactly once when the app-wide refresh generation moves', async () => {
        // Opening a tab from the scanner, or closing one into an expense, ends
        // in refreshAll(); the re-entry rows on Home and Activity must pick the
        // change up in place. If someone drops refreshGeneration from the
        // effect's deps, a freshly opened tab never appears until a remount
        // and nothing fails.
        const { result, rerender } = renderHook(() => useTabs());
        await waitFor(() => expect(result.current.openTabs).toHaveLength(1));

        getAll.mockResolvedValue([brunch, karaoke]);
        refreshGeneration = 1;
        rerender();

        await waitFor(() => expect(result.current.openTabs).toHaveLength(2));
        // One bump, one fetch — not a cascade.
        expect(getAll).toHaveBeenCalledTimes(2);
    });
});
