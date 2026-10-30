import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GrouplessPage from '../GrouplessPage';
import type { FeedExpense } from '../../hooks/useExpenseFeed';

let feed: { expenses: FeedExpense[]; loading: boolean } = { expenses: [], loading: false };

vi.mock('../../hooks/useExpenseFeed', () => ({ useExpenseFeed: () => feed }));
vi.mock('../../hooks/useExpenseLabels', () => ({
    useExpenseLabels: () => ({ payerName: () => 'You paid', groupName: () => null }),
}));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../services/api', () => ({ groupsApi: { getById: vi.fn() } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ friends: [], refreshAll: vi.fn() }),
}));
vi.mock('../../ExpenseDetailModal', () => ({
    default: ({ expenseId }: { expenseId: number }) => (
        <div role="dialog">expense {expenseId}</div>
    ),
}));

const expense = (id: number, description: string, group_id: number | null): FeedExpense => ({
    id,
    description,
    amount: 1000,
    currency: 'USD',
    date: '2026-10-30',
    payer_id: 1,
    group_id,
    kind: 'expense',
});

const renderPage = () =>
    render(
        <MemoryRouter>
            <GrouplessPage />
        </MemoryRouter>
    );

describe('GrouplessPage', () => {
    beforeEach(() => {
        feed = { expenses: [], loading: false };
    });

    it('lists only expenses with no group', () => {
        feed.expenses = [
            expense(334, 'Bar bill', null),
            expense(335, 'Ski cabin', 7),
            expense(313, 'Seven Sins', null),
        ];
        renderPage();

        expect(screen.getByRole('button', { name: /Bar bill/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Seven Sins/ })).toBeInTheDocument();
        expect(screen.queryByText('Ski cabin')).not.toBeInTheDocument();
    });

    it('opens an expense when its row is clicked', () => {
        feed.expenses = [expense(334, 'Bar bill', null)];
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: /Bar bill/ }));

        expect(screen.getByRole('dialog')).toHaveTextContent('expense 334');
    });

    it('says so when there are none', () => {
        feed.expenses = [expense(335, 'Ski cabin', 7)];
        renderPage();

        expect(screen.getByText('No group-less expenses')).toBeInTheDocument();
    });

    it('links back to groups', () => {
        renderPage();

        expect(screen.getByRole('link', { name: 'Back to groups' })).toHaveAttribute(
            'href',
            '/groups'
        );
    });

    it('shows loading until the feed arrives', () => {
        feed = { expenses: [], loading: true };
        renderPage();

        expect(screen.getByText('Loading…')).toBeInTheDocument();
        expect(screen.queryByText('No group-less expenses')).not.toBeInTheDocument();
    });
});
