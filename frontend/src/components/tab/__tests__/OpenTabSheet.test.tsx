import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OpenTabSheet from '../OpenTabSheet';
import type { PendingTab } from '../OpenTabSheet';

/** $40.00 of food and $4.00 of tax, with no tip on the printed receipt. */
const pending: PendingTab = {
    items: [
        { description: 'Tacos', price: 2500 },
        { description: 'Horchata', price: 1500 },
    ],
    tax: 400,
    tip: 0,
    total: 4400,
};

const onOpen = vi.fn();

function open(overrides: Partial<PendingTab> = {}) {
    render(
        <OpenTabSheet
            pending={{ ...pending, ...overrides }}
            onClose={() => {}}
            onOpen={onOpen}
        />
    );
}

const nameIt = (name = 'Bar Sol') =>
    fireEvent.change(screen.getByLabelText('Venue name'), {
        target: { value: name },
    });

describe('OpenTabSheet', () => {
    beforeEach(() => onOpen.mockReset());

    it('opens the tab with the tip that was typed', () => {
        open();
        nameIt();
        fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '8' } });
        fireEvent.click(screen.getByRole('button', { name: 'Open the tab' }));

        expect(onOpen).toHaveBeenCalledWith({
            name: 'Bar Sol',
            tip: 800,
            // Tip written in, so the receipt total becomes what will be charged.
            total: 5200,
        });
    });

    it('tips a percentage of the items, not of the tax', () => {
        open();
        fireEvent.click(screen.getByRole('button', { name: '20%' }));

        // 20% of $40.00 of items — the $4.00 of tax is not tipped on.
        expect(screen.getByLabelText('Tip')).toHaveValue('8.00');
        expect(screen.getByRole('button', { name: '20%' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('shows the total the table will owe, tip included', () => {
        open();
        fireEvent.click(screen.getByRole('button', { name: '15%' }));

        // $40.00 items + $4.00 tax + $6.00 tip.
        expect(screen.getByText('$50.00')).toBeInTheDocument();
    });

    it('starts from the tip the scan found', () => {
        open({ tip: 700 });
        expect(screen.getByLabelText('Tip')).toHaveValue('7.00');
    });

    it('leaves the scanned total alone when the tip is untouched', () => {
        // A scan that missed a line should keep showing the discrepancy: the
        // items and tax here come to $44.00, but the receipt said $51.00.
        open({ total: 5100 });
        nameIt();
        fireEvent.click(screen.getByRole('button', { name: 'Open the tab' }));

        expect(onOpen).toHaveBeenCalledWith({
            name: 'Bar Sol',
            tip: 0,
            total: 5100,
        });
    });

    it('offers the shortfall as tip when the receipt says more than the lines', () => {
        // $44.00 of lines and tax against a $51.00 receipt: $7.00 unaccounted
        // for, which on a real bill is usually a service charge.
        open({ total: 5100 });

        expect(
            screen.getByRole('button', { name: 'Add $7.00 to the tip' })
        ).toBeInTheDocument();
    });

    it('puts the shortfall in the tip on one tap, and stops asking', () => {
        open({ total: 5100 });
        fireEvent.click(screen.getByRole('button', { name: 'Add $7.00 to the tip' }));

        expect(screen.getByLabelText('Tip')).toHaveValue('7.00');
        expect(screen.queryByText(/service charge/)).not.toBeInTheDocument();

        nameIt();
        fireEvent.click(screen.getByRole('button', { name: 'Open the tab' }));
        expect(onOpen).toHaveBeenCalledWith({
            name: 'Bar Sol',
            tip: 700,
            total: 5100,
        });
    });

    it('says nothing when the lines already match the receipt', () => {
        open();
        expect(screen.queryByText(/service charge/)).not.toBeInTheDocument();
    });

    it('does not treat a hand-written tip as overshooting the receipt', () => {
        // The printed total is the pre-tip bill, so tipping past it is normal.
        open();
        fireEvent.click(screen.getByRole('button', { name: '20%' }));

        expect(screen.queryByText(/service charge/)).not.toBeInTheDocument();
        expect(screen.queryByText(/read twice/)).not.toBeInTheDocument();
    });

    it('will not open a tab with no name', () => {
        open();
        fireEvent.click(screen.getByRole('button', { name: 'Open the tab' }));
        expect(onOpen).not.toHaveBeenCalled();
    });
});
