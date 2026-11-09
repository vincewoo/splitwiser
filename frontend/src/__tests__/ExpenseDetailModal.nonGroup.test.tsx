import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpenseDetailModal from '../ExpenseDetailModal';
import { expensesApi, tabsApi } from '../services/api';
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

    it('does not send a guest added but given no item', async () => {
        await openEditor(itemizedExpense);

        fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'Ben' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add guest' }));
        const payload = await savedPayload();

        expect(payload.expense_guests).toBeUndefined();
    });

    it('offers Add guest only on an itemized split, where a guest can owe something', async () => {
        await openEditor(equalExpense);

        expect(screen.queryByLabelText('Guest name')).not.toBeInTheDocument();
    });

    it('leaves ad-hoc guests out of Paid by', async () => {
        await openEditor({
            ...equalExpense,
            expense_guests: [
                { id: 1, expense_id: 7, name: 'Dana', amount_owed: 0, paid: false, paid_at: null },
            ],
        });

        const payers = Array.from(
            (screen.getByLabelText('Paid by') as HTMLSelectElement).options
        ).map(o => o.textContent);
        expect(payers).toEqual(['You', 'Sam']);
    });
});

describe('ExpenseDetailModal viewing a non-group expense', () => {
    it('names a payer who is on the bill but not a friend', async () => {
        vi.mocked(expensesApi.getById).mockResolvedValue({ ...equalExpense, payer_id: 9 });
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

        const paidBy = await screen.findByText('Paid by');
        expect(paidBy.parentElement).toHaveTextContent('Paid bySam');
    });
});

describe('ExpenseDetailModal on an expense a tab closed into', () => {
    it('shows its own items and links to the tab instead of re-reading it', async () => {
        vi.mocked(expensesApi.getById).mockResolvedValue({ ...itemizedExpense, tab_id: 12 });
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

        expect(await screen.findByRole('button', { name: 'Open the tab' })).toBeInTheDocument();
        // The expense's own Items section, not a breakdown read off the tab.
        const items = screen.getByRole('heading', { name: 'Items' }).parentElement as HTMLElement;
        expect(within(items).getByText('Pasta')).toBeInTheDocument();
        expect(tabsApi.getById).not.toHaveBeenCalled();
    });
});

describe('ExpenseDetailModal split breakdown with ad-hoc guests', () => {
    // Tancy's guest id is 1, the same as yours: her lines must not land on you.
    const guest = (id: number, name: string, amount_owed: number) => ({
        id,
        expense_id: 7,
        name,
        amount_owed,
        paid: false,
        paid_at: null,
    });
    const atTheTable: ExpenseWithSplits = {
        ...itemizedExpense,
        amount: 4290,
        splits: [split(71, 1, 'Maya Lin', 1430)],
        expense_guests: [guest(1, 'Tancy', 2530), guest(2, 'Matie', 330)],
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
            {
                id: 6,
                expense_id: 7,
                description: 'Ramen',
                price: 2000,
                is_tax_tip: false,
                split_type: 'EQUAL',
                assignments: [{ user_id: 1, is_guest: false, expense_guest_id: 1, user_name: 'Tancy' }],
            },
            {
                id: 8,
                expense_id: 7,
                description: 'Beer',
                price: 900,
                is_tax_tip: false,
                split_type: 'EQUAL',
                assignments: [
                    { user_id: 1, is_guest: false, user_name: 'Maya Lin' },
                    { user_id: 1, is_guest: false, expense_guest_id: 1, user_name: 'Tancy' },
                    { user_id: 2, is_guest: false, expense_guest_id: 2, user_name: 'Matie' },
                ],
            },
            {
                id: 9,
                expense_id: 7,
                description: 'Tax',
                price: 390,
                is_tax_tip: true,
                split_type: 'EQUAL',
                assignments: [],
            },
        ],
    };

    const renderAtTheTable = (expense: ExpenseWithSplits) => {
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
    };

    it('shows every guest with their own lines, not just you', async () => {
        renderAtTheTable(atTheTable);

        const heading = await screen.findByRole('heading', { name: 'Split breakdown' });
        const section = heading.parentElement as HTMLElement;
        const cards = within(section).getAllByText(/^(You|Matie|Tancy)$/).map(
            (name) => name.parentElement?.parentElement as HTMLElement
        );

        expect(cards.map((card) => card.firstChild?.textContent)).toEqual([
            'You$14.30',
            'Matie$3.30',
            'Tancy$25.30',
        ]);
        const [you, matie, tancy] = cards;
        expect(you).toHaveTextContent('Pasta');
        expect(you).not.toHaveTextContent('Ramen');
        expect(matie).toHaveTextContent('Beer');
        expect(matie).not.toHaveTextContent('Pasta');
        expect(tancy).toHaveTextContent('Ramen');
        expect(tancy).toHaveTextContent('Beer');
        expect(tancy).not.toHaveTextContent('Pasta');
        // Her share of the tax: 2,300 of the 3,900 in lines.
        expect(tancy).toHaveTextContent('+ Tax (59.0% share)$2.30');
    });

    it('leaves guests out once the bill is no longer itemized', async () => {
        // An edit away from ITEMIZED leaves the guests' old amounts behind.
        renderAtTheTable({ ...atTheTable, split_type: 'EQUAL', items: [] });

        const heading = await screen.findByRole('heading', { name: 'Split breakdown' });
        const section = heading.parentElement as HTMLElement;
        expect(within(section).getByText('You')).toBeInTheDocument();
        expect(within(section).queryByText('Tancy')).not.toBeInTheDocument();
        expect(within(section).queryByText('Matie')).not.toBeInTheDocument();
    });
});
