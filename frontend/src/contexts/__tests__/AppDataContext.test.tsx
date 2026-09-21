import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppDataProvider, useAppData } from '../AppDataContext';

const getFriends = vi.fn();
const getGroups = vi.fn();
const getBalances = vi.fn();
const getPending = vi.fn();
vi.mock('../../services/api', () => ({
    friendsApi: {
        getAll: (...args: unknown[]) => getFriends(...args),
        getPendingCount: (...args: unknown[]) => getPending(...args),
    },
    groupsApi: { getAll: (...args: unknown[]) => getGroups(...args) },
    balancesApi: { getAll: (...args: unknown[]) => getBalances(...args) },
}));

vi.mock('../../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin', default_currency: 'USD' } }),
}));

/** Shows the generation and offers the refresh, like a screen would. */
function Probe() {
    const { refreshGeneration, refreshAll, loading } = useAppData();
    return (
        <div>
            <span data-testid="generation">{refreshGeneration}</span>
            <span data-testid="loading">{String(loading)}</span>
            <button onClick={() => refreshAll()}>Refresh</button>
        </div>
    );
}

beforeEach(() => {
    getFriends.mockReset().mockResolvedValue([]);
    getGroups.mockReset().mockResolvedValue([]);
    getBalances.mockReset().mockResolvedValue({ balances: [] });
    getPending.mockReset().mockResolvedValue({ count: 0 });
});

describe('AppDataContext refresh generation', () => {
    it('does not bump on the initial load — screens mounting alongside fetch on their own', async () => {
        render(
            <AppDataProvider>
                <Probe />
            </AppDataProvider>
        );
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
        expect(screen.getByTestId('generation')).toHaveTextContent('0');
        expect(getGroups).toHaveBeenCalledTimes(1);
    });

    it('bumps on every refreshAll, so screen-local fetches follow', async () => {
        render(
            <AppDataProvider>
                <Probe />
            </AppDataProvider>
        );
        await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(screen.getByTestId('generation')).toHaveTextContent('1'));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(screen.getByTestId('generation')).toHaveTextContent('2'));
        expect(getGroups).toHaveBeenCalledTimes(3);
    });
});
