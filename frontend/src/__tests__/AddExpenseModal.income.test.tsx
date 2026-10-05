import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddExpenseModal from '../AddExpenseModal';
import { offlineExpensesApi } from '../services/offlineApi';

// The Expense | Money received toggle: same form, reversed flow. These tests
// pin what income mode changes — labels, hidden controls, and the kind the
// payload carries — and that the toggle undoes all of it.

vi.mock('../services/offlineApi', () => ({
    offlineGroupsApi: { getById: vi.fn() },
    offlineExpensesApi: { create: vi.fn() },
}));

vi.mock('../AuthContext', () => ({
    useAuth: () => ({
        user: { id: 1, email: 'you@example.com', full_name: 'You' },
        loading: false,
    }),
}));

vi.mock('../contexts/SyncContext', () => ({ useSync: () => ({ isOnline: true }) }));

vi.mock('../hooks/useCurrencyPreferences', () => ({
    useCurrencyPreferences: () => ({
        sortedCurrencies: [{ code: 'USD', name: 'US Dollar', flag: '🇺🇸' }],
        recordCurrencyUsage: vi.fn(),
        hasRecentCurrencies: false,
    }),
}));

vi.mock('../ReceiptScanner', () => ({ default: () => null }));

const friends = [
    { id: 2, full_name: 'Eliz', email: 'eliz@example.com' },
];

const renderModal = (
    props: Partial<React.ComponentProps<typeof AddExpenseModal>> = {}
) =>
    render(
        <AddExpenseModal
            isOpen
            onClose={vi.fn()}
            onExpenseAdded={vi.fn()}
            friends={friends}
            groups={[]}
            {...props}
        />
    );

const toggleTo = (label: string) =>
    fireEvent.click(screen.getByRole('radio', { name: label }));

describe('AddExpenseModal income mode', () => {
    beforeEach(() => {
        vi.mocked(offlineExpensesApi.create).mockReset();
        vi.mocked(offlineExpensesApi.create).mockResolvedValue({
            success: true,
            data: null,
            offline: false,
        });
    });

    it('switches the labels and helper caption with the toggle', () => {
        renderModal();

        // Expense mode is the baseline.
        expect(screen.getByText('New expense')).toBeInTheDocument();
        expect(
            screen.getByText(
                'One person paid for something; the others owe them their share.'
            )
        ).toBeInTheDocument();

        toggleTo('Money received');

        expect(screen.getByRole('heading', { name: 'Money received' })).toBeInTheDocument();
        expect(
            screen.getByText(
                'One person is holding money the others have a share of — a refund, returned deposit, winnings.'
            )
        ).toBeInTheDocument();
        expect(screen.queryByText('New expense')).not.toBeInTheDocument();
    });

    it('asks who received rather than who paid', () => {
        renderModal();
        // The payer select only appears with more than one candidate.
        fireEvent.click(screen.getByRole('button', { name: 'Eliz' }));
        expect(screen.getByLabelText('Paid by:')).toBeInTheDocument();

        toggleTo('Money received');

        expect(screen.getByLabelText('Received by:')).toBeInTheDocument();
        expect(screen.queryByLabelText('Paid by:')).not.toBeInTheDocument();
    });

    it('hides the scan button, the itemized pill and the settlement checkbox', () => {
        renderModal();
        expect(screen.getByRole('button', { name: 'Scan a receipt' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'By item' })).toBeInTheDocument();
        expect(
            screen.getByLabelText('This is a settlement (payment)')
        ).toBeInTheDocument();

        toggleTo('Money received');

        expect(
            screen.queryByRole('button', { name: 'Scan a receipt' })
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: 'By item' })).not.toBeInTheDocument();
        expect(
            screen.queryByLabelText('This is a settlement (payment)')
        ).not.toBeInTheDocument();
    });

    it('falls back from ITEMIZED to EQUAL when toggled to income', () => {
        renderModal();
        fireEvent.click(screen.getByRole('radio', { name: 'By item' }));

        toggleTo('Money received');

        expect(screen.getByRole('radio', { name: 'Equal' })).toBeChecked();
    });

    it('opens pre-toggled when the FAB row asks for income', () => {
        renderModal({ initialKind: 'income' });
        expect(screen.getByRole('heading', { name: 'Money received' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Money received' })).toBeChecked();
    });

    it('submits a kind: income payload with positive amounts', async () => {
        renderModal({ initialKind: 'income' });

        fireEvent.click(screen.getByRole('button', { name: 'Eliz' }));
        fireEvent.change(screen.getByLabelText('Amount'), {
            target: { value: '200.00' },
        });
        fireEvent.change(screen.getByPlaceholderText('Enter a description'), {
            target: { value: 'Airbnb refund' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

        await waitFor(() => expect(offlineExpensesApi.create).toHaveBeenCalled());
        const payload = vi.mocked(offlineExpensesApi.create).mock.calls[0][0];
        expect(payload.kind).toBe('income');
        // The compat alias must not contradict the enum.
        expect(payload.is_settlement).toBe(false);
        expect(payload.amount).toBe(20000);
        expect(payload.splits.every((s) => s.amount_owed > 0)).toBe(true);
    });

    it('still submits kind: expense from expense mode', async () => {
        renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Eliz' }));
        fireEvent.change(screen.getByLabelText('Amount'), {
            target: { value: '50.00' },
        });
        fireEvent.change(screen.getByPlaceholderText('Enter a description'), {
            target: { value: 'Dinner' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

        await waitFor(() => expect(offlineExpensesApi.create).toHaveBeenCalled());
        const payload = vi.mocked(offlineExpensesApi.create).mock.calls[0][0];
        expect(payload.kind).toBe('expense');
        expect(payload.is_settlement).toBe(false);
    });

    it('still submits kind: settlement when the legacy checkbox is on', async () => {
        renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Eliz' }));
        fireEvent.change(screen.getByLabelText('Amount'), {
            target: { value: '50.00' },
        });
        fireEvent.change(screen.getByPlaceholderText('Enter a description'), {
            target: { value: 'Paying Eliz back' },
        });
        fireEvent.click(screen.getByLabelText('This is a settlement (payment)'));
        fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

        await waitFor(() => expect(offlineExpensesApi.create).toHaveBeenCalled());
        const payload = vi.mocked(offlineExpensesApi.create).mock.calls[0][0];
        expect(payload.kind).toBe('settlement');
        expect(payload.is_settlement).toBe(true);
    });
});
