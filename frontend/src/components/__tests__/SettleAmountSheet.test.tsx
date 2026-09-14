import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettleAmountSheet from '../SettleAmountSheet';
import type { SettleAmountSheetProps } from '../SettleAmountSheet';

const onRecord = vi.fn();
const onClose = vi.fn();

/** Maya (signed in) owes Sam $54.35 from Tahoe, and Sam takes Venmo. */
function open(over: Partial<SettleAmountSheetProps> = {}) {
    render(
        <SettleAmountSheet
            outstanding={5435}
            currency="USD"
            payer="You"
            payee="Sam Okafor"
            you="payer"
            groupName="Tahoe"
            venmoUsername="sam-ok"
            onClose={onClose}
            onRecord={onRecord}
            {...over}
        />
    );
}

const amount = () => screen.getByLabelText('Amount paid');
const typeAmount = (value: string) => fireEvent.change(amount(), { target: { value } });
const record = () => screen.getByRole('button', { name: 'Record' });

beforeEach(() => {
    onRecord.mockReset();
    onClose.mockReset();
});

describe('SettleAmountSheet', () => {
    it('starts from the suggested figure, so paying in full is a tap', () => {
        open();
        expect(amount()).toHaveValue('54.35');
        expect(record()).toBeEnabled();
        screen.getByText('Clears what you owe Sam Okafor.');
    });

    it('names who pays whom from the signed-in seat', () => {
        open();
        screen.getByText('You pay Sam Okafor');
    });

    it('records the typed figure in cents', () => {
        open();
        typeAmount('40');
        fireEvent.click(record());
        expect(onRecord).toHaveBeenCalledWith(4000);
    });

    it('submits on enter as well', () => {
        open();
        typeAmount('40');
        fireEvent.submit(amount());
        expect(onRecord).toHaveBeenCalledWith(4000);
    });

    it('says what a partial payment leaves outstanding', () => {
        open();
        typeAmount('40');
        screen.getByText('Leaves $14.35 outstanding.');
    });

    it('lets an overpayment through, but says the payer comes out owed', () => {
        open();
        typeAmount('60');
        screen.getByRole('status'); // the firmer notice, not the quiet line
        screen.getByText("That's $5.65 more than you owe — you'll be owed $5.65 instead.");
        expect(record()).toBeEnabled();
        fireEvent.click(record());
        expect(onRecord).toHaveBeenCalledWith(6000);
    });

    it('refuses to record nothing', () => {
        open();
        typeAmount('');
        expect(record()).toBeDisabled();
        fireEvent.submit(amount());
        expect(onRecord).not.toHaveBeenCalled();

        typeAmount('0');
        expect(record()).toBeDisabled();
    });

    it('filters the entry like the add-expense field', () => {
        open();
        typeAmount('12.345');
        expect(amount()).toHaveValue('12.34');
        typeAmount('abc');
        expect(amount()).toHaveValue('');
    });

    it('keeps the currency fixed to the debt', () => {
        open({ currency: 'EUR' });
        screen.getByText('EUR');
        expect(screen.queryByRole('combobox')).toBeNull();
        typeAmount('40');
        screen.getByText('Leaves €14.35 outstanding.');
    });

    it('hands the typed figure to Venmo, not the suggested one', () => {
        open();
        typeAmount('40');
        const link = screen.getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        const url = new URL(link.getAttribute('href')!);
        expect(url.searchParams.get('txn')).toBe('pay');
        expect(url.searchParams.get('recipients')).toBe('sam-ok');
        expect(url.searchParams.get('amount')).toBe('40.00');
        expect(url.searchParams.get('note')).toBe('Settling up: Tahoe');
    });

    it('asks rather than pays when they owe you', () => {
        open({ payer: 'Sam Okafor', payee: 'You', you: 'payee' });
        screen.getByText('Sam Okafor pays you');
        const link = screen.getByRole('link', { name: 'Ask Sam Okafor on Venmo' });
        expect(new URL(link.getAttribute('href')!).searchParams.get('txn')).toBe('charge');
        screen.getByText('Clears what Sam Okafor owes you.');
    });

    it('drops the Venmo link while there is no figure to hand over', () => {
        open();
        typeAmount('');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers no Venmo hand-off without a handle', () => {
        open({ venmoUsername: null });
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('explains a currency Venmo cannot send', () => {
        open({ currency: 'EUR' });
        expect(screen.queryByRole('link')).toBeNull();
        screen.getByText(/only sends US dollars/);
    });

    it("records somebody else's payment without offering their Venmo", () => {
        // A group's plan lists payments between two other people; a member may
        // record one, but charging it to anyone's Venmo is not theirs to do.
        open({ payer: 'Sam Okafor', payee: 'Dev Rao', you: null });
        screen.getByText('Sam Okafor pays Dev Rao');
        screen.getByText('Clears what Sam Okafor owes Dev Rao.');
        expect(screen.queryByRole('link')).toBeNull();
        typeAmount('60');
        screen.getByText(
            "That's $5.65 more than Sam Okafor owes — Sam Okafor will be owed $5.65 instead."
        );
    });

    it('shows the caller’s error and stays open', () => {
        open({ error: 'Could not record that payment.' });
        screen.getByRole('alert');
        screen.getByText('Could not record that payment.');
    });

    it('holds still while recording', () => {
        open({ busy: true });
        expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    });

    it('closes on Escape', () => {
        open();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
