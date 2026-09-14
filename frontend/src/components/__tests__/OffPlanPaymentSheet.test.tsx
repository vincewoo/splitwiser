import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OffPlanPaymentSheet from '../OffPlanPaymentSheet';
import type { OffPlanPaymentSheetProps, PaymentPerson } from '../OffPlanPaymentSheet';

const onRecord = vi.fn();
const onClose = vi.fn();

const ME = 1;

const tahoe: PaymentPerson[] = [
    { userId: 1, isGuest: false, name: 'Maya Lin', venmoUsername: null },
    { userId: 2, isGuest: false, name: 'Sam Okafor', venmoUsername: 'sam-ok' },
    { userId: 3, isGuest: false, name: 'Dev Rao', venmoUsername: null },
    { userId: 5, isGuest: true, name: 'Table 4' },
];
const lunch: PaymentPerson[] = [
    { userId: 1, isGuest: false, name: 'Maya Lin', venmoUsername: null },
    { userId: 4, isGuest: false, name: 'Ana Costa', venmoUsername: null },
];

const rosters: Record<number, PaymentPerson[]> = { 7: tahoe, 8: lunch };
const loadPeople = vi.fn(async (groupId: number) => {
    const people = rosters[groupId];
    if (!people) throw new Error('no such group');
    return people;
});

const groups = [
    { id: 7, name: 'Tahoe', currency: 'USD' },
    { id: 8, name: 'Lunch', currency: 'EUR' },
];

function open(over: Partial<OffPlanPaymentSheetProps> = {}) {
    return render(
        <OffPlanPaymentSheet
            groups={groups}
            loadPeople={loadPeople}
            youId={ME}
            onClose={onClose}
            onRecord={onRecord}
            {...over}
        />
    );
}

/** The pickers are enabled once the roster has landed. */
const ready = () =>
    waitFor(() => expect(screen.getByLabelText('Paid by')).toBeEnabled());

const pick = (label: string, option: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value: option } });
const typeAmount = (value: string) =>
    fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value } });
const record = () => screen.getByRole('button', { name: 'Record' });

beforeEach(() => {
    onRecord.mockReset();
    onClose.mockReset();
    loadPeople.mockClear();
});

describe('OffPlanPaymentSheet', () => {
    it('starts with you paying the first other person, amount blank', async () => {
        open();
        await ready();
        expect(screen.getByLabelText('Paid by')).toHaveValue('u1');
        expect(screen.getByLabelText('Paid to')).toHaveValue('u2');
        expect(screen.getByLabelText('Amount paid')).toHaveValue('');
        expect(record()).toBeDisabled();
    });

    it('names the signed-in user "You" in both pickers', async () => {
        open();
        await ready();
        const options = screen.getAllByRole('option', { name: 'You' });
        expect(options).toHaveLength(2);
        screen.getAllByRole('option', { name: 'Table 4' }); // guests are payable too
    });

    it('records who paid whom, in the group currency, in cents', async () => {
        open();
        await ready();
        pick('Paid to', 'u3');
        typeAmount('12.50');
        fireEvent.click(record());

        expect(onRecord).toHaveBeenCalledWith({
            groupId: 7,
            currency: 'USD',
            payer: tahoe[0],
            payee: tahoe[2],
            cents: 1250,
        });
    });

    it('lets somebody else be the payer', async () => {
        open();
        await ready();
        pick('Paid by', 'g5');
        pick('Paid to', 'u2');
        typeAmount('8');
        fireEvent.click(record());

        expect(onRecord).toHaveBeenCalledWith(
            expect.objectContaining({ payer: tahoe[3], payee: tahoe[1], cents: 800 })
        );
    });

    it('refuses the same person on both sides', async () => {
        open();
        await ready();
        pick('Paid to', 'u1');
        typeAmount('10');
        screen.getByText('Pick two different people.');
        expect(record()).toBeDisabled();
        fireEvent.submit(screen.getByLabelText('Amount paid'));
        expect(onRecord).not.toHaveBeenCalled();
    });

    it('says the payment is off the plan', async () => {
        open();
        await ready();
        screen.getByText(/Not one of the suggested payments/);
    });

    it('offers a group picker only when there is a choice', async () => {
        const { unmount } = open();
        await ready();
        screen.getByLabelText('Group');

        // One group: nothing to pick.
        unmount();
        open({ groups: [groups[0]] });
        await ready();
        expect(screen.queryByLabelText('Group')).toBeNull();
    });

    it('reloads the roster and the currency when the group changes', async () => {
        open();
        await ready();
        screen.getByText('USD');

        pick('Group', '8');
        // Each person appears once per picker.
        await waitFor(() =>
            expect(screen.getAllByRole('option', { name: 'Ana Costa' })).toHaveLength(2)
        );
        expect(loadPeople).toHaveBeenLastCalledWith(8);
        screen.getByText('EUR');
        // The Tahoe roster is gone — a stale id would name the wrong person.
        expect(screen.queryByRole('option', { name: 'Sam Okafor' })).toBeNull();
        expect(screen.getByLabelText('Paid to')).toHaveValue('u4');

        typeAmount('5');
        fireEvent.click(record());
        expect(onRecord).toHaveBeenCalledWith(
            expect.objectContaining({ groupId: 8, currency: 'EUR', payee: lunch[1] })
        );
    });

    it('hands the payment to Venmo only when you are the one paying', async () => {
        open();
        await ready();
        typeAmount('12.50');
        const link = screen.getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        const url = new URL(link.getAttribute('href')!);
        expect(url.searchParams.get('amount')).toBe('12.50');
        expect(url.searchParams.get('recipients')).toBe('sam-ok');
        expect(url.searchParams.get('note')).toBe('Settling up: Tahoe');

        // Dev paying Sam is not your Venmo to open.
        pick('Paid by', 'u3');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers no Venmo to somebody without a handle', async () => {
        open();
        await ready();
        pick('Paid to', 'u3');
        typeAmount('12.50');
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('explains a currency Venmo cannot send', async () => {
        open({
            groups: [{ id: 7, name: 'Tahoe', currency: 'EUR' }],
        });
        await ready();
        typeAmount('12.50');
        expect(screen.queryByRole('link')).toBeNull();
        screen.getByText(/only sends US dollars/);
    });

    it('says so when the roster cannot be loaded', async () => {
        open({ groups: [{ id: 99, name: 'Ghost', currency: 'USD' }] });
        await screen.findByText('Could not load who is in this group.');
        expect(screen.getByLabelText('Paid by')).toBeDisabled();
        expect(record()).toBeDisabled();
    });

    it('shows the caller’s error and holds still while busy', async () => {
        open({ error: 'Could not record that payment.', busy: true });
        await ready();
        screen.getByRole('alert');
        expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    });
});
