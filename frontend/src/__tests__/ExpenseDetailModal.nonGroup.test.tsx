import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpenseDetailModal from '../ExpenseDetailModal';
import { expensesApi } from '../services/api';
import { offlineExpensesApi } from '../services/offlineApi';
import type { ExpenseWithSplits } from '../types/expense';

// Editing an expense with no group. The form used to know people only through
// the group's members, so here it knew nobody: not your friends, not you, and
// not the people already on the bill, who then dropped out of the save.

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

const split = (id: number, user_id: number, user_name: string, amount_owed: number) => ({
    id,
    expense_id: 7,
    user_id,
    is_guest: false,
    amount_owed,
    percentage: null,
    shares: null,
    user_name,
});

/** You (1) and Sam (9), who is on the bill but not your friend. */
const equalExpense: ExpenseWithSplits = {
    id: 7,
    description: 'Golf',
    amount: 6000,
    currency: 'USD',
    date: '2026-10-23T00:00:00',
    payer_id: 1,
    payer_is_guest: false,
    group_id: null,
    created_by_id: 1,
    split_type: 'EQUAL',
    splits: [split(71, 1, 'Maya Lin', 3000), split(72, 9, 'Sam', 3000)],
    expense_guests: [],
    kind: 'expense',
    is_settlement: false,
};

const itemizedExpense: ExpenseWithSplits = {
    ...equalExpense,
    split_type: 'ITEMIZED',
    amount: 1000,
    splits: [split(71, 1, 'Maya Lin', 1000)],
    items: [
        {
            id: 5,
            expense_id: 7,
            description: 'Pasta',
            price: 1000,
            is_tax_tip: false,
            split_type: 'EQUAL',
            assignments: [{ user_id: 1, is_guest: false, user_name: 'Maya Lin' }],
        },
    ],
};

const friends = [{ id: 2, full_name: 'Eliz', email: 'eliz@example.com' }];

const openEditor = async (expense: ExpenseWithSplits) => {
    vi.mocked(expensesApi.getById).mockResolvedValue(expense);
    render(
        <MemoryRouter>
            <ExpenseDetailModal
                isOpen
                onClose={vi.fn()}
                expenseId={7}
                onExpenseUpdated={vi.fn()}
                onExpenseDeleted={vi.fn()}
                groupMembers={[]}
                groupGuests={[]}
                friends={friends}
                currentUserId={1}
            />
        </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
};

const pill = (name: string) => screen.getAllByRole('button', { name })[0];

const savedPayload = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(offlineExpensesApi.update).toHaveBeenCalled());
    return vi.mocked(offlineExpensesApi.update).mock.calls[0][1];
};

describe('ExpenseDetailModal editing a non-group expense', () => {
    beforeEach(() => {
        vi.mocked(expensesApi.getById).mockReset();
        vi.mocked(offlineExpensesApi.update).mockReset();
        vi.mocked(offlineExpensesApi.update).mockResolvedValue({
            success: true,
            data: null,
            offline: false,
        });
    });

    it('offers you, your friends, and everyone already on the bill', async () => {
        await openEditor(equalExpense);

        expect(pill('You')).toHaveAttribute('aria-pressed', 'true');
        expect(pill('Sam')).toHaveAttribute('aria-pressed', 'true');
        expect(pill('Eliz')).toHaveAttribute('aria-pressed', 'false');
    });

    it('keeps the people already on it when saving', async () => {
        await openEditor(equalExpense);

        const payload = await savedPayload();
        expect(payload.splits.map((s: { user_id: number }) => s.user_id).sort()).toEqual([1, 9]);
    });

    it('adds a friend to the split', async () => {
        await openEditor(equalExpense);

        fireEvent.click(pill('Eliz'));
        const payload = await savedPayload();

        const owed = Object.fromEntries(
            payload.splits.map((s: { user_id: number; amount_owed: number }) => [s.user_id, s.amount_owed])
        );
        expect(owed).toEqual({ 1: 2000, 2: 2000, 9: 2000 });
    });

    it('adds a new guest and sends them by name with a temp id', async () => {
        await openEditor(itemizedExpense);

        fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'Ben' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add guest' }));
        expect(pill('Ben')).toHaveAttribute('aria-pressed', 'true');

        // Hand the pasta to Ben on the item's own row of people.
        const pasta = screen.getByText('Pasta').closest('div[class*="rounded"]') as HTMLElement;
        const pastaPills = within(pasta.parentElement as HTMLElement);
        fireEvent.click(pastaPills.getAllByRole('button', { name: 'Ben' }).at(-1)!);
        fireEvent.click(pastaPills.getAllByRole('button', { name: 'You' }).at(-1)!);

        const payload = await savedPayload();
        expect(payload.expense_guests).toHaveLength(1);
        const [ben] = payload.expense_guests ?? [];
        expect(ben.name).toBe('Ben');
        const pastaItem = payload.items?.find(i => i.description === 'Pasta');
        expect(pastaItem?.assignments).toEqual([{ is_guest: false, temp_guest_id: ben.temp_id }]);
    });

    it('refuses a guest name already on the expense', async () => {
        await openEditor({
            ...itemizedExpense,
            expense_guests: [
                { id: 11, expense_id: 7, name: 'Dana', amount_owed: 0, paid: false, paid_at: null },
            ],
        });

        fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'dana' } });

        expect(screen.getByRole('button', { name: 'Add guest' })).toBeDisabled();
        expect(screen.getByText('dana is already on this expense.')).toBeInTheDocument();
    });
});
