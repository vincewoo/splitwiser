import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ActivityPage from '../ActivityPage';

let tabs: { openTabs: unknown[]; closedTabs: unknown[] } = { openTabs: [], closedTabs: [] };
vi.mock('../../hooks/useTabs', () => ({ useTabs: () => tabs }));
vi.mock('../../hooks/useExpenseFeed', () => ({
    useExpenseFeed: () => ({ expenses: [], loading: false }),
}));
vi.mock('../../hooks/useExpenseLabels', () => ({
    useExpenseLabels: () => ({ payerName: () => '', groupName: () => null }),
}));
vi.mock('../../hooks/useOpenExpense', () => ({
    useOpenExpense: () => ({ expenseId: null, open: vi.fn(), close: vi.fn() }),
}));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ refreshAll: vi.fn(), friends: [] }),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <ActivityPage />
        </MemoryRouter>
    );

describe('ActivityPage past tabs', () => {
    it('links to the tabs page when there are closed tabs', () => {
        tabs = { openTabs: [], closedTabs: [{ id: 12 }, { id: 13 }] };
        renderPage();

        const link = screen.getByRole('link', { name: /Past tabs/ });
        expect(link).toHaveAttribute('href', '/tabs');
        expect(link).toHaveTextContent('2');
    });

    it('offers no link with no closed tabs', () => {
        tabs = { openTabs: [], closedTabs: [] };
        renderPage();

        expect(screen.queryByRole('link', { name: /Past tabs/ })).not.toBeInTheDocument();
    });
});
