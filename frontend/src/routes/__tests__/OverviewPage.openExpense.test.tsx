import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OverviewPage from '../OverviewPage';

let isDesktop = true;
let openExpenseId: number | null = null;

vi.mock('../../hooks/useMediaQuery', () => ({ useIsDesktop: () => isDesktop }));
vi.mock('../../hooks/useTabs', () => ({ useTabs: () => ({ openTabs: [] }) }));
vi.mock('../../hooks/useExpenseFeed', () => ({
    useExpenseFeed: () => ({ expenses: [], loading: false }),
}));
vi.mock('../../hooks/useExpenseLabels', () => ({
    useExpenseLabels: () => ({ payerName: () => '', groupName: () => null }),
}));
vi.mock('../../hooks/useOpenExpense', () => ({
    useOpenExpense: () => ({
        expenseId: openExpenseId,
        members: [],
        guests: [],
        open: vi.fn(),
        close: vi.fn(),
    }),
}));
vi.mock('../../hooks/useSettlement', () => ({
    useSettlement: () => ({ counterparties: [], directory: new Map() }),
}));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
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
        refreshAll: vi.fn(),
    }),
}));
vi.mock('../../ExpenseDetailModal', () => ({
    default: ({ expenseId }: { expenseId: number }) => (
        <div role="dialog">expense {expenseId}</div>
    ),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <OverviewPage />
        </MemoryRouter>
    );

describe('OverviewPage opening an expense', () => {
    beforeEach(() => {
        openExpenseId = null;
    });

    it.each([
        ['desktop', true],
        ['mobile', false],
    ])('shows the picked expense on %s', (_layout, desktop) => {
        isDesktop = desktop;
        openExpenseId = 334;
        renderPage();

        expect(screen.getByRole('dialog')).toHaveTextContent('expense 334');
    });

    it('shows no expense until one is picked', () => {
        isDesktop = true;
        renderPage();

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
