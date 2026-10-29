import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PersonPage from '../PersonPage';
import { AppDataProvider, useAppData } from '../../contexts/AppDataContext';

const getFriendById = vi.fn();
const getFriendExpenses = vi.fn();
const getFriendBalance = vi.fn();
const getFriends = vi.fn();
const getGroups = vi.fn();
const getBalances = vi.fn();
const getPending = vi.fn();
const getGroupById = vi.fn();
vi.mock('../../services/api', () => ({
    friendsApi: {
        getAll: (...args: unknown[]) => getFriends(...args),
        getPendingCount: (...args: unknown[]) => getPending(...args),
        getById: (...args: unknown[]) => getFriendById(...args),
        getExpenses: (...args: unknown[]) => getFriendExpenses(...args),
        getBalance: (...args: unknown[]) => getFriendBalance(...args),
    },
    groupsApi: {
        getAll: (...args: unknown[]) => getGroups(...args),
        getById: (...args: unknown[]) => getGroupById(...args),
    },
    balancesApi: { getAll: (...args: unknown[]) => getBalances(...args) },
}));

vi.mock('../../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin', default_currency: 'USD' } }),
}));

vi.mock('../../hooks/useMediaQuery', () => ({
    useIsDesktop: () => true,
}));

// AddExpenseModal sits (closed) in PersonPage's tree; its sync/offline stack
// would drag the syncManager and IndexedDB into the test.
vi.mock('../../contexts/SyncContext', () => ({
    useSync: () => ({ isOnline: true }),
}));
vi.mock('../../services/offlineApi', () => ({
    offlineGroupsApi: { getById: vi.fn() },
    offlineExpensesApi: { create: vi.fn() },
}));

// The detail modal's own fetches are not the subject here: what it is handed is.
vi.mock('../../ExpenseDetailModal', () => ({
    default: (props: { groupMembers: { full_name: string }[]; friends?: { full_name: string }[] }) => (
        <div data-testid="expense-modal">
            members: {props.groupMembers.map(m => m.full_name).join(', ') || 'none'};
            friends: {(props.friends ?? []).map(f => f.full_name).join(', ') || 'none'}
        </div>
    ),
}));

/**
 * Stands in for the shell's mutation surfaces (the add-expense modal, a
 * settlement, a pull to refresh) — anything that ends in refreshAll().
 */
function RefreshProbe() {
    const { refreshAll } = useAppData();
    return <button onClick={() => refreshAll()}>Refresh everything</button>;
}

/**
 * Rendered under the real AppDataProvider, like SettleUpPage's tests: the page
 * relies on the refresh generation the provider bumps, and a static mock would
 * leave it frozen.
 */
const open = () =>
    render(
        <MemoryRouter initialEntries={['/people/2']}>
            <AppDataProvider>
                <RefreshProbe />
                <Routes>
                    <Route path="/people/:friendId" element={<PersonPage />} />
                </Routes>
            </AppDataProvider>
        </MemoryRouter>
    );

const dinner = {
    id: 21,
    description: 'Dinner',
    amount: 4200,
    currency: 'USD',
    date: '2026-10-01',
    payer_id: 1,
    group_id: null,
};

beforeEach(() => {
    getFriendById.mockReset().mockResolvedValue({
        id: 2,
        full_name: 'Sam Okafor',
        email: 'sam@example.com',
    });
    getFriendExpenses.mockReset().mockResolvedValue([]);
    getFriendBalance.mockReset().mockResolvedValue([]);
    getFriends.mockReset().mockResolvedValue([]);
    getGroups.mockReset().mockResolvedValue([]);
    getBalances.mockReset().mockResolvedValue({ balances: [] });
    getPending.mockReset().mockResolvedValue({ count: 0 });
    getGroupById.mockReset();
    // PersonPage fetches exchange rates straight through fetch().
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ USD: 1 }) })
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('PersonPage refresh generation', () => {
    it('loads the person once on mount — the provider\'s initial load does not double it', async () => {
        open();
        await screen.findByText('Sam Okafor');
        expect(getFriendExpenses).toHaveBeenCalledTimes(1);
    });

    it('reloads exactly once after a refreshAll-driven generation bump', async () => {
        // An expense added from the shell's modal calls refreshAll(); this
        // page's shared-expense list must pick it up without remounting. If
        // someone drops refreshGeneration from the load effect's deps,
        // FAB-adds go stale here and nothing fails.
        open();
        await screen.findByText('Sam Okafor');
        expect(getFriendExpenses).toHaveBeenCalledTimes(1);

        getFriendExpenses.mockResolvedValue([dinner]);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh everything' }));

        await screen.findByText('Dinner');
        // One bump, one reload — not one per collection the provider refreshes.
        await waitFor(() => expect(getFriendExpenses).toHaveBeenCalledTimes(2));
        expect(getFriendExpenses).toHaveBeenCalledTimes(2);
    });
});

describe('PersonPage opening an expense', () => {
    it('hands a group expense its group\'s members, so the edit form can resolve them', async () => {
        getFriendExpenses.mockResolvedValue([{ ...dinner, id: 22, description: 'Green fees', group_id: 7 }]);
        getGroupById.mockResolvedValue({
            members: [{ id: 1, user_id: 1, full_name: 'Maya Lin' }, { id: 2, user_id: 2, full_name: 'Sam Okafor' }],
            guests: [],
        });
        open();

        fireEvent.click(await screen.findByText('Green fees'));

        expect(getGroupById).toHaveBeenCalledWith(7);
        await waitFor(() =>
            expect(screen.getByTestId('expense-modal')).toHaveTextContent('members: Maya Lin, Sam Okafor')
        );
    });

    it('hands a non-group expense your friends instead, and fetches no group', async () => {
        getFriends.mockResolvedValue([{ id: 2, full_name: 'Sam Okafor', email: 'sam@example.com' }]);
        getFriendExpenses.mockResolvedValue([dinner]);
        open();

        fireEvent.click(await screen.findByText('Dinner'));

        expect(getGroupById).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(screen.getByTestId('expense-modal')).toHaveTextContent('friends: Sam Okafor')
        );
    });
});
