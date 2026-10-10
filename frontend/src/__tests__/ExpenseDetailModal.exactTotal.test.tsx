import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpenseDetailModal from '../ExpenseDetailModal';
import { expensesApi } from '../services/api';
import { offlineExpensesApi } from '../services/offlineApi';
import type { ExpenseWithSplits } from '../types/expense';

// Editing an EXACT split so the amounts no longer sum to the total used to
// dead-end on "Invalid Split". Now the dialog offers to adopt the sum as the
// new total and save in the same tap, same as the add flow.

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

/** A $50.00 expense split by exact amounts, $25.00 each. */
const exactExpense: ExpenseWithSplits = {
    id: 9,
    description: 'Groceries',
    amount: 5000,
    currency: 'USD',
    date: '2026-10-01T00:00:00',
    payer_id: 1,
    payer_is_guest: false,
    group_id: 3,
    created_by_id: 1,
    split_type: 'EXACT',
    splits: [
        {
            id: 91,
            expense_id: 9,
            user_id: 1,
            is_guest: false,
            amount_owed: 2500,
            percentage: null,
            shares: null,
            user_name: 'Maya Lin',
        },
        {
            id: 92,
            expense_id: 9,
            user_id: 2,
            is_guest: false,
            amount_owed: 2500,
            percentage: null,
            shares: null,
            user_name: 'Eliz',
        },
    ],
    kind: 'expense',
    is_settlement: false,
};

const renderModal = () =>
    render(
        <MemoryRouter>
            <ExpenseDetailModal
                isOpen
                onClose={vi.fn()}
                expenseId={9}
                onExpenseUpdated={vi.fn()}
                onExpenseDeleted={vi.fn()}
                groupMembers={groupMembers}
                groupGuests={[]}
                currentUserId={1}
            />
        </MemoryRouter>
    );

/** Enter edit mode and lower Eliz's share to $20.00: sum $45.00 vs total $50.00. */
const editIntoMismatch = async () => {
    renderModal();
    await screen.findByRole('dialog', { name: 'Expense details' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Eliz USD'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
};

describe('ExpenseDetailModal exact split total adjustment', () => {
    beforeEach(() => {
        vi.mocked(expensesApi.getById).mockReset();
        vi.mocked(expensesApi.getById).mockResolvedValue(exactExpense);
        vi.mocked(offlineExpensesApi.update).mockReset();
        vi.mocked(offlineExpensesApi.update).mockResolvedValue({
            success: true,
            data: null,
            offline: false,
        });
    });

    it('offers to update the total to the summed amounts, stating both figures', async () => {
        await editIntoMismatch();

        const dialog = await screen.findByRole('alertdialog', {
            name: "Amounts don't match the total",
        });
        expect(dialog).toHaveTextContent('$45.00');
        expect(dialog).toHaveTextContent('$50.00');
        expect(offlineExpensesApi.update).not.toHaveBeenCalled();
    });

    it('saves with the summed amount as the total on confirm', async () => {
        await editIntoMismatch();

        fireEvent.click(
            await screen.findByRole('button', { name: 'Update total to $45.00' })
        );

        await waitFor(() => expect(offlineExpensesApi.update).toHaveBeenCalled());
        const [id, payload] = vi.mocked(offlineExpensesApi.update).mock.calls[0];
        expect(id).toBe(9);
        expect(payload.amount).toBe(4500);
        // The splits are the entered amounts, untouched by the adjustment.
        expect(payload.splits).toEqual([
            { user_id: 1, is_guest: false, amount_owed: 2500 },
            { user_id: 2, is_guest: false, amount_owed: 2000 },
        ]);
    });

    it('returns to the edit form unsaved on Go back', async () => {
        await editIntoMismatch();

        fireEvent.click(await screen.findByRole('button', { name: 'Go back' }));

        expect(
            screen.queryByRole('alertdialog', { name: "Amounts don't match the total" })
        ).not.toBeInTheDocument();
        expect(offlineExpensesApi.update).not.toHaveBeenCalled();
        // The entered figures are all still there to edit.
        expect(screen.getByLabelText('Amount')).toHaveValue('50.00');
        expect(screen.getByLabelText('Eliz USD')).toHaveValue('20');
    });
});
