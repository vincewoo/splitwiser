import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OverviewPage from '../OverviewPage';
import type { FeedExpense } from '../../hooks/useExpenseFeed';

let isDesktop = true;

const BILL: FeedExpense = {
    id: 334,
    description: 'Bar bill',
    amount: 58900,
    currency: 'USD',
    date: '2026-10-30',
    payer_id: 1,
    group_id: null,
    kind: 'expense',
};

const refreshAll = vi.fn();

vi.mock('../../hooks/useMediaQuery', () => ({ useIsDesktop: () => isDesktop }));
vi.mock('../../hooks/useTabs', () => ({ useTabs: () => ({ openTabs: [] }) }));
vi.mock('../../hooks/useExpenseFeed', () => ({
    useExpenseFeed: () => ({ expenses: [BILL], loading: false }),
}));
vi.mock('../../hooks/useExpenseLabels', () => ({
    useExpenseLabels: () => ({ payerName: () => 'You paid', groupName: () => null }),
}));
vi.mock('../../hooks/useSettlement', () => ({
    useSettlement: () => ({ counterparties: [], directory: new Map() }),
}));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../services/api', () => ({ groupsApi: { getById: vi.fn() } }));
vi.mock('../../layouts/shellActions', () => ({
    useShellActions: () => ({
        openAddExpense: vi.fn(),
        openSettleUp: vi.fn(),
        openProfile: vi.fn(),
    }),
}));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 1, full_name: 'Ana' } }) }));
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({
        groups: [],
        friends: [],
        balances: [],
        showInMyCurrency: false,
        setShowInMyCurrency: vi.fn(),
        displayCurrency: 'USD',
        pendingRequests: [],
        refreshAll,
    }),
}));
vi.mock('../../ExpenseDetailModal', () => ({
    default: ({
        expenseId,
        onClose,
        onExpenseDeleted,
    }: {
        expenseId: number;
        onClose: () => void;
        onExpenseDeleted: () => void;
    }) => (
        <div role="dialog">
            expense {expenseId}
            <button onClick={onClose}>Close</button>
            <button onClick={onExpenseDeleted}>Delete</button>
        </div>
    ),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <OverviewPage />
        </MemoryRouter>
    );

describe('OverviewPage opening a Lately expense', () => {
    beforeEach(() => {
        isDesktop = true;
        refreshAll.mockClear();
    });

    it.each([
        ['desktop', true],
        ['mobile', false],
    ])('opens the clicked row on %s', (_layout, desktop) => {
        isDesktop = desktop;
        renderPage();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Bar bill/ }));

        expect(screen.getByRole('dialog')).toHaveTextContent('expense 334');
    });

    it('closes the expense', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /Bar bill/ }));

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes and refreshes after a delete', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: /Bar bill/ }));

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });
});
