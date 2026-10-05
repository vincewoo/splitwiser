import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpenseDetailModal from '../ExpenseDetailModal';
import { expensesApi } from '../services/api';
import { offlineExpensesApi } from '../services/offlineApi';
import type { ExpenseWithSplits } from '../types/expense';

// The detail modal on an income row: reversed labels in view mode, no
// settle-style controls (nobody owes the receiver anything), and an edit that
// round-trips kind: 'income' rather than silently downgrading the row.

vi.mock('../services/api', () => ({
    expensesApi: {
        getById: vi.fn(),
        getPublicById: vi.fn(),
        toggleExpenseGuestPaid: vi.fn(),
    },
    tabsApi: { getById: vi.fn() },
}));

vi.mock('../services/offlineApi', () => ({
    offlineExpensesApi: { update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../contexts/SyncContext', () => ({ useSync: () => ({ isOnline: true }) }));

const groupMembers = [
    {
        id: 1,
        user_id: 1,
        full_name: 'Maya Lin',
        email: 'maya@example.com',
        managed_by_id: null,
        managed_by_type: null,
        managed_by_name: null,
    },
    {
        id: 2,
        user_id: 2,
        full_name: 'Eliz',
        email: 'eliz@example.com',
        managed_by_id: null,
        managed_by_type: null,
        managed_by_name: null,
    },
];

/**
 * A non-group income row with an expense guest on it: the guest is what makes
 * the quick-settle assertions bite, since the section only ever renders when
 * expense_guests exist — hiding it must be the kind's doing, not the data's.
 */
const incomeExpense: ExpenseWithSplits = {
    id: 7,
    description: 'Airbnb refund',
    amount: 20000,
    currency: 'USD',
    date: '2026-10-01T00:00:00',
    payer_id: 1,
    payer_is_guest: false,
    group_id: null,
    created_by_id: 1,
    split_type: 'EQUAL',
    splits: [
        {
            id: 71,
            expense_id: 7,
            user_id: 1,
            is_guest: false,
            amount_owed: 10000,
            percentage: null,
            shares: null,
            user_name: 'Maya Lin',
        },
        {
            id: 72,
            expense_id: 7,
            user_id: 2,
            is_guest: false,
            amount_owed: 10000,
            percentage: null,
            shares: null,
            user_name: 'Eliz',
        },
    ],
    expense_guests: [
        {
            id: 11,
            expense_id: 7,
            name: 'Guest Dana',
            amount_owed: 5000,
            paid: false,
            paid_at: null,
        },
    ],
    kind: 'income',
    is_settlement: false,
};

const renderModal = () =>
    render(
        <MemoryRouter>
            <ExpenseDetailModal
                isOpen
                onClose={vi.fn()}
                expenseId={7}
                onExpenseUpdated={vi.fn()}
                onExpenseDeleted={vi.fn()}
                groupMembers={groupMembers}
                groupGuests={[]}
                currentUserId={1}
            />
        </MemoryRouter>
    );

describe('ExpenseDetailModal income rows', () => {
    beforeEach(() => {
        vi.mocked(expensesApi.getById).mockReset();
        vi.mocked(expensesApi.getById).mockResolvedValue(incomeExpense);
        vi.mocked(offlineExpensesApi.update).mockReset();
        vi.mocked(offlineExpensesApi.update).mockResolvedValue({
            success: true,
            data: null,
            offline: false,
        });
    });

    it('shows Received by and Shared among instead of the expense labels', async () => {
        renderModal();

        expect(
            await screen.findByRole('dialog', { name: 'Money received details' })
        ).toBeInTheDocument();
        expect(screen.getByText('Received by')).toBeInTheDocument();
        expect(screen.getByText('Shared among')).toBeInTheDocument();
        expect(screen.queryByText('Paid by')).not.toBeInTheDocument();
        expect(screen.queryByText('Split breakdown')).not.toBeInTheDocument();
    });

    it('offers no quick settle in view mode and no settlement checkbox in edit mode', async () => {
        renderModal();
        await screen.findByText('Received by');

        // The expense guest is on the row, so only the kind can be hiding this.
        expect(screen.queryByText('Quick settle')).not.toBeInTheDocument();
        expect(screen.queryByText('Guest Dana')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

        expect(
            screen.queryByLabelText('This is a settlement (payment)')
        ).not.toBeInTheDocument();
        expect(screen.getByLabelText('Received by')).toBeInTheDocument();
    });

    it('round-trips kind: income through an edit', async () => {
        renderModal();
        await screen.findByText('Received by');

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Description'), {
            target: { value: 'Airbnb refund (adjusted)' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

        await waitFor(() => expect(offlineExpensesApi.update).toHaveBeenCalled());
        const [id, payload] = vi.mocked(offlineExpensesApi.update).mock.calls[0];
        expect(id).toBe(7);
        expect(payload.kind).toBe('income');
        // The compat alias must not contradict the enum.
        expect(payload.is_settlement).toBe(false);
        expect(payload.description).toBe('Airbnb refund (adjusted)');
    });

    it('keeps the expense surfaces for a plain expense with the same guests', async () => {
        vi.mocked(expensesApi.getById).mockResolvedValue({
            ...incomeExpense,
            kind: 'expense',
        });
        renderModal();

        expect(
            await screen.findByRole('dialog', { name: 'Expense details' })
        ).toBeInTheDocument();
        expect(screen.getByText('Paid by')).toBeInTheDocument();
        expect(screen.getByText('Split breakdown')).toBeInTheDocument();
        expect(screen.getByText('Quick settle')).toBeInTheDocument();
    });
});
