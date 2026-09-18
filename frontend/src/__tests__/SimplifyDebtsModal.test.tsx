import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SimplifyDebtsModal from '../SimplifyDebtsModal';

const simplifyDebts = vi.fn();
const createExpense = vi.fn();
vi.mock('../services/api', () => ({
    api: {
        balances: { simplifyDebts: (...args: unknown[]) => simplifyDebts(...args) },
        expenses: { create: (...args: unknown[]) => createExpense(...args) },
    },
}));

// Maya is the signed-in user throughout.
vi.mock('../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin' }, loading: false }),
}));

const members = [
    { id: 10, user_id: 1, full_name: 'Maya Lin' },
    { id: 11, user_id: 2, full_name: 'Sam Okafor' },
    { id: 12, user_id: 3, full_name: 'Dev Rao' },
];
const guests = [{ id: 5, name: 'Table 4' }];

const participants = [
    { user_id: 1, is_guest: false, display_name: 'Maya Lin', venmo_username: 'maya-l' },
    { user_id: 2, is_guest: false, display_name: 'Sam Okafor', venmo_username: 'sam-ok' },
    { user_id: 3, is_guest: false, display_name: 'Dev Rao', venmo_username: 'dev-r' },
    { user_id: 5, is_guest: true, display_name: 'Table 4', venmo_username: null },
];

const tx = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
    from_id: from,
    from_is_guest: false,
    to_id: to,
    to_is_guest: false,
    amount: 4235,
    currency: 'USD',
    ...extra,
});

const open = () =>
    render(
        <SimplifyDebtsModal
            isOpen
            onClose={() => {}}
            groupId={7}
            groupName="Tahoe"
            groupCurrency="USD"
            members={members}
            guests={guests}
        />
    );

beforeEach(() => {
    simplifyDebts.mockReset();
    createExpense.mockReset();
    createExpense.mockResolvedValue({ ok: true });
});

describe('SimplifyDebtsModal Venmo hand-off', () => {
    it('offers to pay the person the signed-in user owes', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2)],
            participants,
        });
        open();

        const link = await screen.findByRole('link', {
            name: 'Pay Sam Okafor with Venmo',
        });
        const url = new URL(link.getAttribute('href')!);
        expect(url.searchParams.get('txn')).toBe('pay');
        expect(url.searchParams.get('recipients')).toBe('sam-ok');
        expect(url.searchParams.get('amount')).toBe('42.35');
        expect(url.searchParams.get('note')).toBe('Settling up: Tahoe');
    });

    it('asks rather than pays when the debt runs the other way', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(2, 1)],
            participants,
        });
        open();

        const link = await screen.findByRole('link', {
            name: 'Ask Sam Okafor on Venmo',
        });
        expect(new URL(link.getAttribute('href')!).searchParams.get('txn')).toBe(
            'charge'
        );
    });

    it('offers nothing for a payment between two other people', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(2, 3)],
            participants,
        });
        open();

        await screen.findByText('Sam Okafor');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers nothing when the counterparty has published no handle', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2)],
            participants: participants.map((p) =>
                p.user_id === 2 ? { ...p, venmo_username: null } : p
            ),
        });
        open();

        await screen.findByText('Sam Okafor');
        expect(screen.queryByRole('link')).toBeNull();
        // Nothing the viewer can act on, so nothing is said about it.
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('explains a debt in a currency Venmo cannot send', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2, { currency: 'EUR' })],
            participants,
        });
        open();

        await screen.findByText(/only sends US dollars/);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers nothing when the counterparty is a guest with no account', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 5, { to_is_guest: true })],
            participants,
        });
        open();

        await screen.findByText('Table 4');
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('keeps recording separate from the hand-off', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2)],
            participants,
        });
        open();

        await screen.findByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        // Opening Venmo tells us nothing about whether the money moved, so the
        // deliberate "mark as paid" stays alongside it.
        screen.getByRole('button', { name: 'Mark as paid' });
    });

    it('survives a response with no participants directory', async () => {
        simplifyDebts.mockResolvedValue({ transactions: [tx(1, 2)] });
        open();

        await waitFor(() => screen.getByText('Sam Okafor'));
        expect(screen.queryByRole('link')).toBeNull();
    });
});

describe('SimplifyDebtsModal custom amount', () => {
    const openWith = async (transactions: ReturnType<typeof tx>[]) => {
        simplifyDebts.mockResolvedValue({ transactions, participants });
        open();
        await screen.findAllByText('Sam Okafor');
    };

    const differentAmount = () =>
        fireEvent.click(screen.getByRole('button', { name: 'Different amount…' }));

    it('still marks the suggested figure paid in one tap', async () => {
        await openWith([tx(1, 2)]);
        fireEvent.click(screen.getByRole('button', { name: 'Mark as paid' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 4235,
            payer_id: 1,
            group_id: 7,
            is_settlement: true,
            notes: 'Created by Simplify Debts',
            splits: [{ user_id: 2, is_guest: false, amount_owed: 4235 }],
        });
        // Paid in full, the row goes.
        await screen.findByText('All settled up');
    });

    it('opens a sheet seeded with the suggested figure', async () => {
        await openWith([tx(1, 2)]);
        differentAmount();

        const dialog = screen.getByRole('dialog', { name: 'Record a payment' });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByLabelText('Amount paid')).toHaveValue('42.35');
        screen.getByText('You pay Sam Okafor');
        // The hand-off inside the sheet reaches the same person as the row's.
        expect(
            screen.getAllByRole('link', { name: 'Pay Sam Okafor with Venmo' })
        ).toHaveLength(2);
    });

    it('records a partial payment and keeps the row, smaller', async () => {
        await openWith([tx(1, 2)]);
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 3000,
            payer_id: 1,
            payer_is_guest: false,
            notes: 'Created by Simplify Debts · $30.00 against $42.35 suggested',
            splits: [{ user_id: 2, is_guest: false, amount_owed: 3000 }],
        });

        // The sheet closes and the plan is left standing, less what was paid.
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Record a payment' })).toBeNull()
        );
        // The row and the summary both carry the shrunk figure.
        expect(screen.getAllByText('$12.35').length).toBeGreaterThan(0);
        expect(screen.queryByText('$42.35')).toBeNull();
        screen.getByRole('button', { name: 'Mark as paid' });
    });

    it('records an overpayment and clears the row', async () => {
        await openWith([tx(1, 2)]);
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 5000,
            notes: 'Created by Simplify Debts · $50.00 against $42.35 suggested',
        });
        await screen.findByText('All settled up');
    });

    it('keeps the sheet on its own pair while another row is being recorded', async () => {
        // Rows are keyed by pair, not position: removing row 0 while the
        // sheet is open on row 1 must not re-target the sheet.
        let finishFirst!: (value: { ok: boolean }) => void;
        createExpense.mockReturnValueOnce(
            new Promise<{ ok: boolean }>((resolve) => {
                finishFirst = resolve;
            })
        );
        await openWith([tx(1, 2), tx(2, 3, { amount: 1000 })]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Mark as paid' })[0]);
        fireEvent.click(screen.getAllByRole('button', { name: 'Different amount…' })[1]);
        screen.getByText('Sam Okafor pays Dev Rao');
        expect(screen.getByLabelText('Amount paid')).toHaveValue('10.00');

        finishFirst({ ok: true });
        await waitFor(() =>
            expect(screen.queryByText('Maya Lin', { selector: 'p' })).toBeNull()
        );
        // Still Sam → Dev, still $10.00, and recording lands on that pair.
        screen.getByText('Sam Okafor pays Dev Rao');
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));
        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(2));
        expect(createExpense.mock.calls[1][0]).toMatchObject({
            amount: 400,
            payer_id: 2,
            splits: [{ user_id: 3, is_guest: false, amount_owed: 400 }],
        });
    });

    it("lets a member record somebody else's payment, without their Venmo", async () => {
        await openWith([tx(2, 3)]);
        differentAmount();

        screen.getByText('Sam Okafor pays Dev Rao');
        expect(screen.queryByRole('link')).toBeNull();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '40' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 4000,
            payer_id: 2,
            splits: [{ user_id: 3, is_guest: false, amount_owed: 4000 }],
        });
    });

    it('treats a rejected request as not recorded', async () => {
        // apiFetch does not throw on a 4xx/5xx, so a refused payment arrives
        // as a response with ok: false — and must not shrink the row.
        createExpense.mockResolvedValue({ ok: false });
        await openWith([tx(1, 2)]);
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await screen.findByText('Failed to record that payment. Please try again.');
        expect(screen.getByRole('dialog', { name: 'Record a payment' })).toBeInTheDocument();
        expect(screen.queryByText('$12.35')).toBeNull();
    });

    it('does not take a row off the list when the one-tap record is refused', async () => {
        createExpense.mockResolvedValue({ ok: false });
        await openWith([tx(1, 2)]);
        fireEvent.click(screen.getByRole('button', { name: 'Mark as paid' }));

        await screen.findByText('Failed to mark payment as paid. Please try again.');
        expect(createExpense).toHaveBeenCalledTimes(1);
    });

    it('keeps the sheet open, with the error, when recording fails', async () => {
        createExpense.mockRejectedValue(new Error('down'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await openWith([tx(1, 2)]);
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        // The error lands in the sheet, not on the list behind it — which
        // the modal replaces wholesale with its own error notice.
        await screen.findByText('Failed to record that payment. Please try again.');
        expect(screen.queryByText('Failed to mark payment as paid. Please try again.')).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Record a payment' })).toBeInTheDocument();
        // Nothing was recorded, so the row still says the full figure.
        expect(screen.getAllByText('$42.35').length).toBeGreaterThan(0);
        expect(screen.queryByText('$12.35')).toBeNull();
    });
});

describe('SimplifyDebtsModal payment to someone else', () => {
    const openSheet = async (transactions: ReturnType<typeof tx>[] = [tx(1, 2)]) => {
        simplifyDebts.mockResolvedValue({ transactions, participants });
        open();
        await screen.findByRole('button', { name: 'Someone else…' });
        fireEvent.click(screen.getByRole('button', { name: 'Someone else…' }));
        await waitFor(() => expect(screen.getByLabelText('Paid by')).toBeEnabled());
    };

    it('offers the whole roster, guests included', async () => {
        await openSheet();
        screen.getAllByRole('option', { name: 'Dev Rao' });
        screen.getAllByRole('option', { name: 'Table 4' });
        expect(screen.queryByLabelText('Group')).toBeNull();
    });

    it('is still offered once the plan is empty', async () => {
        // Being square today does not stop somebody paying ahead.
        await openSheet([]);
        screen.getByRole('dialog', { name: 'Record another payment' });
        screen.getByText('USD');
    });

    it('records the payment and re-plans the group', async () => {
        await openSheet();
        fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'u3' } });
        fireEvent.change(screen.getByLabelText('Paid to'), { target: { value: 'g5' } });
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            description: 'Payment (Dev Rao → Table 4)',
            amount: 700,
            group_id: 7,
            payer_id: 3,
            payer_is_guest: false,
            is_settlement: true,
            notes: 'Created by Simplify Debts · not one of the suggested payments',
            splits: [{ user_id: 5, is_guest: true, amount_owed: 700 }],
        });
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Record another payment' })).toBeNull()
        );
        // Off-plan is the one case that legitimately re-plans, so it refetches.
        expect(simplifyDebts).toHaveBeenCalledTimes(2);
    });

    it('keeps the sheet open when the request is refused', async () => {
        createExpense.mockResolvedValue({ ok: false });
        await openSheet();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await screen.findByText('Failed to record that payment. Please try again.');
        screen.getByRole('dialog', { name: 'Record another payment' });
        // Not re-planned: nothing was recorded.
        expect(simplifyDebts).toHaveBeenCalledTimes(1);
    });

    it('offers Venmo when you are paying somebody with a handle', async () => {
        await openSheet();
        fireEvent.change(screen.getByLabelText('Paid to'), { target: { value: 'u2' } });
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '7' } });
        // The row behind the sheet keeps its own link for the full figure;
        // the sheet's carries the typed one.
        const sheet = screen.getByRole('dialog', { name: 'Record another payment' });
        const link = within(sheet).getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        expect(new URL(link.getAttribute('href')!).searchParams.get('amount')).toBe('7.00');
    });
});
