import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabAmountsSheet from '../TabAmountsSheet';

const onSave = vi.fn();

function open(over: { tax?: number; tip?: number } = {}) {
    render(
        <TabAmountsSheet
            subtotal={4000}
            tax={over.tax ?? 400}
            tip={over.tip ?? 800}
            currency="USD"
            onClose={() => {}}
            onSave={onSave}
        />
    );
}

describe('TabAmountsSheet', () => {
    beforeEach(() => onSave.mockReset());

    it('starts from what the tab currently holds', () => {
        open();
        expect(screen.getByLabelText('Tax')).toHaveValue('4.00');
        expect(screen.getByLabelText('Tip')).toHaveValue('8.00');
    });

    it('saves both amounts in cents', () => {
        open();
        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '7.50' } });
        fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ tax: 750, tip: 1200 });
    });

    it('saves a cleared field as zero rather than leaving it be', () => {
        // Clearing the tip is how you say the scan invented one.
        open();
        fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledWith({ tax: 400, tip: 0 });
    });

    it('tips a percentage of the items', () => {
        open();
        fireEvent.click(screen.getByRole('button', { name: '18%' }));

        expect(screen.getByLabelText('Tip')).toHaveValue('7.20');
    });

    it('shows the total the amounts add up to', () => {
        open({ tax: 400, tip: 800 });
        // $40.00 of items + $4.00 + $8.00.
        expect(screen.getByText('$52.00')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '0' } });
        expect(screen.getByText('$48.00')).toBeInTheDocument();
    });
});
