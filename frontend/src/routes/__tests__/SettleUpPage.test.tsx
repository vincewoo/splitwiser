import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettleUpPage from '../SettleUpPage';

const simplifyDebts = vi.fn();
const createExpense = vi.fn();
const getGroup = vi.fn();
vi.mock('../../services/api', () => ({
    api: {
        expenses: { create: (...args: unknown[]) => createExpense(...args) },
        groups: { getById: (...args: unknown[]) => getGroup(...args) },
    },
    balancesApi: {
        simplifyDebts: (...args: unknown[]) => simplifyDebts(...args),
    },
}));

// Maya is the signed-in user throughout.
vi.mock('../../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin' }, loading: false }),
}));

const refreshAll = vi.fn().mockResolvedValue(undefined);
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({
        groups: [{ id: 7, name: 'Tahoe', default_currency: 'USD' }],
        friends: [],
        refreshAll,
    }),
}));

vi.mock('../../hooks/useMediaQuery', () => ({
    useIsDesktop: () => true,
}));

const participants = [
    { user_id: 1, is_guest: false, display_name: 'Maya Lin', venmo_username: null },
    { user_id: 2, is_guest: false, display_name: 'Sam Okafor', venmo_username: 'sam-ok' },
];

/** Maya owes Sam $54.35 in Tahoe. */
const iOweSam = {
    from_id: 1,
    from_is_guest: false,
    to_id: 2,
    to_is_guest: false,
    amount: 5435,
    currency: 'USD',
};

const open = () =>
    render(
        <MemoryRouter>
            <SettleUpPage />
        </MemoryRouter>
    );

const differentAmount = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Different amount…' }));

beforeEach(() => {
    simplifyDebts.mockReset();
    createExpense.mockReset();
    getGroup.mockReset();
    createExpense.mockResolvedValue({ ok: true });
    simplifyDebts.mockResolvedValue({ transactions: [iOweSam], participants });
    getGroup.mockResolvedValue({
        id: 7,
        name: 'Tahoe',
        default_currency: 'USD',
        members: [
            { id: 10, user_id: 1, full_name: 'Maya Lin' },
            { id: 11, user_id: 2, full_name: 'Sam Okafor' },
            { id: 12, user_id: 3, full_name: 'Dev Rao' },
        ],
        guests: [{ id: 5, name: 'Table 4', claimed_by_id: null }],
    });
});

describe('SettleUpPage custom amount', () => {
    it('still marks the suggested figure paid in one tap', async () => {
        open();
        fireEvent.click(await screen.findByRole('button', { name: 'Mark as paid' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            description: 'Payment (Maya Lin → Sam Okafor)',
            amount: 5435,
            group_id: 7,
            payer_id: 1,
            is_settlement: true,
            notes: 'Recorded from Settle up',
            splits: [{ user_id: 2, is_guest: false, amount_owed: 5435 }],
        });
    });

    it('opens a sheet seeded with the suggested figure and the same hand-off', async () => {
        open();
        await screen.findByText('You pay Sam Okafor');
        differentAmount();

        screen.getByRole('dialog', { name: 'Record a payment' });
        expect(screen.getByLabelText('Amount paid')).toHaveValue('54.35');
        // Both the row and the sheet reach Sam's Venmo.
        expect(
            screen.getAllByRole('link', { name: 'Pay Sam Okafor with Venmo' })
        ).toHaveLength(2);
    });

    it('records a partial payment against the right group and pair', async () => {
        open();
        await screen.findByText('You pay Sam Okafor');
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '40' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 4000,
            currency: 'USD',
            group_id: 7,
            payer_id: 1,
            payer_is_guest: false,
            is_settlement: true,
            notes: 'Recorded from Settle up · $40.00 against $54.35 suggested',
            splits: [{ user_id: 2, is_guest: false, amount_owed: 4000 }],
        });
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Record a payment' })).toBeNull()
        );
    });

    it('keeps a partially paid row on screen once the plan reloads', async () => {
        open();
        await screen.findByText('You pay Sam Okafor');

        // The reload after recording brings the same pair back, smaller.
        simplifyDebts.mockResolvedValue({
            transactions: [{ ...iOweSam, amount: 1435 }],
            participants,
        });
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '40' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        // The row, and "Where you stand" beneath it, both carry the remainder.
        await screen.findAllByText('$14.35');
        screen.getByText('You pay Sam Okafor');
        expect(screen.queryByText('$54.35')).toBeNull();
    });

    it('takes a fully paid row off screen', async () => {
        open();
        await screen.findByText('You pay Sam Okafor');
        simplifyDebts.mockResolvedValue({ transactions: [], participants });

        differentAmount();
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await screen.findByText(/all square|All settled/);
        expect(screen.queryByText('You pay Sam Okafor')).toBeNull();
    });

    it('records the other direction with them as the payer', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [{ ...iOweSam, from_id: 2, to_id: 1 }],
            participants,
        });
        open();
        await screen.findByText('Sam Okafor pays you');
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 5000,
            payer_id: 2,
            description: 'Payment (Sam Okafor → Maya Lin)',
            splits: [{ user_id: 1, is_guest: false, amount_owed: 5000 }],
        });
    });

    it('keeps the sheet open, with the error, when recording fails', async () => {
        createExpense.mockResolvedValue({ ok: false });
        open();
        await screen.findByText('You pay Sam Okafor');
        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '40' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await screen.findByRole('alert');
        screen.getByRole('dialog', { name: 'Record a payment' });
        // The page's own error line stays quiet; the sheet is showing it.
        expect(screen.getAllByText('Could not record that payment. Please try again.')).toHaveLength(1);
    });
});

describe('SettleUpPage payment to someone else', () => {
    const openSheet = async () => {
        open();
        await screen.findByText('You pay Sam Okafor');
        fireEvent.click(
            screen.getByRole('button', { name: 'Record a payment to someone else…' })
        );
        await waitFor(() => expect(screen.getByLabelText('Paid by')).toBeEnabled());
    };

    it('lists the whole group, not just the plan', async () => {
        await openSheet();
        expect(getGroup).toHaveBeenCalledWith(7);
        // Dev is in the group but not in the plan; Table 4 is a guest.
        screen.getAllByRole('option', { name: 'Dev Rao' });
        screen.getAllByRole('option', { name: 'Table 4' });
        // One group: no picker.
        expect(screen.queryByLabelText('Group')).toBeNull();
    });

    it('records a payment to somebody the plan never named', async () => {
        await openSheet();
        fireEvent.change(screen.getByLabelText('Paid to'), { target: { value: 'u3' } });
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '12.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            description: 'Payment (Maya Lin → Dev Rao)',
            amount: 1250,
            currency: 'USD',
            group_id: 7,
            payer_id: 1,
            payer_is_guest: false,
            is_settlement: true,
            notes: 'Recorded from Settle up · not one of the suggested payments',
            splits: [{ user_id: 3, is_guest: false, amount_owed: 1250 }],
        });
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Record another payment' })).toBeNull()
        );
        // Everything reloads: an off-plan payment legitimately re-plans.
        expect(simplifyDebts).toHaveBeenCalledTimes(2);
    });

    it('carries the Venmo handle over from the plan directory', async () => {
        await openSheet();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '5' } });
        const sheet = screen.getByRole('dialog', { name: 'Record another payment' });
        const link = within(sheet).getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        expect(new URL(link.getAttribute('href')!).searchParams.get('amount')).toBe('5.00');
    });

    it('keeps the sheet open, with the error, when recording fails', async () => {
        createExpense.mockResolvedValue({ ok: false });
        await openSheet();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await screen.findByRole('alert');
        screen.getByRole('dialog', { name: 'Record another payment' });
    });
});

describe('SettleUpPage row identity', () => {
    /** Maya also owes Dev $9.00 — a second row below Sam's. */
    const iOweDev = { ...iOweSam, to_id: 3, amount: 900 };
    const withDev = [
        ...participants,
        { user_id: 3, is_guest: false, display_name: 'Dev Rao', venmo_username: null },
    ];

    it('paying the first row in full leaves the second one standing', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [iOweSam, iOweDev],
            participants: withDev,
        });
        // Hold the reload so the hidden set is what decides what shows.
        let finishReload!: (value: unknown) => void;
        open();
        await screen.findByText('You pay Dev Rao');
        simplifyDebts.mockReturnValueOnce(new Promise((resolve) => (finishReload = resolve)));

        fireEvent.click(screen.getAllByRole('button', { name: 'Mark as paid' })[0]);
        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));

        // Before the reload lands: Sam's row is gone, Dev's is not — the
        // positional key this replaced would have hidden Dev's instead.
        await waitFor(() => expect(screen.queryByText('You pay Sam Okafor')).toBeNull());
        finishReload({ transactions: [iOweDev], participants: withDev });
        await screen.findByText('You pay Dev Rao');
        expect(screen.queryByText('You pay Sam Okafor')).toBeNull();
    });

    it('does not keep hiding a pair the re-plan brings back', async () => {
        simplifyDebts.mockResolvedValue({ transactions: [iOweSam], participants });
        open();
        await screen.findByText('You pay Sam Okafor');

        // Paid in full — then the group re-plans (say an off-plan payment
        // elsewhere) and the same pair is a fresh, real debt again.
        simplifyDebts.mockResolvedValue({
            transactions: [{ ...iOweSam, amount: 2000 }],
            participants,
        });
        fireEvent.click(screen.getByRole('button', { name: 'Mark as paid' }));

        // The row, the header net and "Where you stand" all carry it.
        await screen.findAllByText('$20.00');
        screen.getByText('You pay Sam Okafor');
    });

    it('records an overpayment and takes the row off', async () => {
        simplifyDebts.mockResolvedValue({ transactions: [iOweSam], participants });
        open();
        await screen.findByText('You pay Sam Okafor');
        simplifyDebts.mockResolvedValue({ transactions: [], participants });

        differentAmount();
        fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '60' } });
        fireEvent.click(screen.getByRole('button', { name: 'Record' }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense.mock.calls[0][0]).toMatchObject({
            amount: 6000,
            notes: 'Recorded from Settle up · $60.00 against $54.35 suggested',
        });
        await screen.findByText(/all square|All settled/);
    });
});
