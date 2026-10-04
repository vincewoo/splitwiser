import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOpenTabs } from '../useOpenTabs';

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

beforeEach(() => {
    refreshGeneration = 0;
    getAll.mockReset().mockResolvedValue([brunch]);
});

describe('useOpenTabs', () => {
    it('fetches the open tabs once on mount', async () => {
        const { result } = renderHook(() => useOpenTabs());
        await waitFor(() => expect(result.current.openTabs).toHaveLength(1));
        expect(getAll).toHaveBeenCalledTimes(1);
        expect(getAll).toHaveBeenCalledWith('open');
    });

    it('re-fetches exactly once when the app-wide refresh generation moves', async () => {
        // Opening a tab from the scanner, or closing one into an expense, ends
        // in refreshAll(); the re-entry rows on Home and Activity must pick the
        // change up in place. If someone drops refreshGeneration from the
        // effect's deps, a freshly opened tab never appears until a remount
        // and nothing fails.
        const { result, rerender } = renderHook(() => useOpenTabs());
        await waitFor(() => expect(result.current.openTabs).toHaveLength(1));

        getAll.mockResolvedValue([brunch, karaoke]);
        refreshGeneration = 1;
        rerender();

        await waitFor(() => expect(result.current.openTabs).toHaveLength(2));
        // One bump, one fetch — not a cascade.
        expect(getAll).toHaveBeenCalledTimes(2);
    });
});
