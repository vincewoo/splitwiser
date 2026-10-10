import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddExpenseModal from '../AddExpenseModal';
import { offlineExpensesApi, offlineGroupsApi } from '../services/offlineApi';

// An EXACT split whose amounts do not sum to the total used to dead-end on
// "Invalid Split". Now the dialog offers to adopt the sum as the new total
// and save in the same tap.

vi.mock('../contexts/SyncContext', () => ({
    useSync: () => ({ isOnline: true }),
}));

vi.mock('../AuthContext', () => ({
    useAuth: () => ({
        user: { id: 1, full_name: 'Vince', email: 'v@example.com', default_currency: 'USD' },
    }),
}));

vi.mock('../services/offlineApi', () => ({
    offlineGroupsApi: { getById: vi.fn() },
    offlineExpensesApi: { create: vi.fn() },
}));

const groupDetail = {
    id: 7,
    name: 'Ski trip',
    created_by_id: 1,
    default_currency: 'USD',
    members: [
        { id: 1, user_id: 1, full_name: 'Vince', email: 'v@example.com' },
        { id: 2, user_id: 2, full_name: 'Dana', email: 'd@example.com' },
    ],
    guests: [],
};

const renderModal = () =>
    render(
        <AddExpenseModal
            isOpen={true}
            onClose={() => {}}
            onExpenseAdded={() => {}}
            friends={[]}
            groups={[{ id: 7, name: 'Ski trip', created_by_id: 1, default_currency: 'USD' }]}
            preselectedGroupId={7}
        />
    );

/** Total $50.00, exact amounts $20.00 + $25.00 = $45.00: a mismatch. */
const fillMismatchedExactSplit = async () => {
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '50.00' } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Dinner' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Dana' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Exact' }));

    fireEvent.change(screen.getByLabelText('You USD'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Dana USD'), { target: { value: '25' } });
};

describe('AddExpenseModal exact split total adjustment', () => {
    beforeEach(() => {
        vi.mocked(offlineGroupsApi.getById).mockReset();
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(groupDetail);
        vi.mocked(offlineExpensesApi.create).mockReset();
        vi.mocked(offlineExpensesApi.create).mockResolvedValue({
            success: true,
            data: null,
            offline: false,
        });
    });

    it('offers to update the total to the summed amounts, stating both figures', async () => {
        renderModal();
        await fillMismatchedExactSplit();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        const dialog = await screen.findByRole('alertdialog', {
            name: "Amounts don't match the total",
        });
        expect(dialog).toHaveTextContent('$45.00');
        expect(dialog).toHaveTextContent('$50.00');
        expect(offlineExpensesApi.create).not.toHaveBeenCalled();
    });

    it('saves with the summed amount as the total on confirm', async () => {
        renderModal();
        await fillMismatchedExactSplit();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        fireEvent.click(
            await screen.findByRole('button', { name: 'Update total to $45.00' })
        );

        await waitFor(() => expect(offlineExpensesApi.create).toHaveBeenCalled());
        const [payload] = vi.mocked(offlineExpensesApi.create).mock.calls[0];
        expect(payload.amount).toBe(4500);
        // The splits are the entered amounts, untouched by the adjustment.
        expect(payload.splits).toEqual([
            { user_id: 1, is_guest: false, amount_owed: 2000 },
            { user_id: 2, is_guest: false, amount_owed: 2500 },
        ]);
    });

    it('returns to the form unsaved on Go back', async () => {
        renderModal();
        await fillMismatchedExactSplit();

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Go back' }));

        expect(
            screen.queryByRole('alertdialog', { name: "Amounts don't match the total" })
        ).not.toBeInTheDocument();
        expect(offlineExpensesApi.create).not.toHaveBeenCalled();
        // The entered figures are all still there to edit.
        expect(screen.getByLabelText('Amount')).toHaveValue('50.00');
        expect(screen.getByLabelText('You USD')).toHaveValue('20');
    });

    it('keeps the dead-end error when the amounts sum to zero', async () => {
        renderModal();
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '50.00' } });
        fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Dinner' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Dana' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Exact' }));

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        // A zero total is not an expense, so there is nothing to offer.
        expect(await screen.findByRole('dialog', { name: 'Invalid Split' })).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /Update total/ })
        ).not.toBeInTheDocument();
        expect(offlineExpensesApi.create).not.toHaveBeenCalled();
    });
});
