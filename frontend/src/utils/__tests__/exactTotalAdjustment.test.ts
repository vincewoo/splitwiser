// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getExactTotalAdjustment } from '../exactTotalAdjustment';

/** A calculateExactSplit mismatch result, as assembleSplitsPayload hands it over. */
const mismatch = (exactSumCents: number) => ({
    error: 'Amounts do not sum to total. Total: 50, Sum: 45',
    exactSumCents,
});

describe('getExactTotalAdjustment', () => {
    it('offers the summed amount as the new total', () => {
        const adjustment = getExactTotalAdjustment('EXACT', mismatch(4500), 5000, 'USD');
        expect(adjustment).not.toBeNull();
        expect(adjustment!.newTotalCents).toBe(4500);
        expect(adjustment!.cancelText).toBe('Go back');
    });

    it('states the old total and the new total in the copy', () => {
        const adjustment = getExactTotalAdjustment('EXACT', mismatch(4500), 5000, 'USD')!;
        expect(adjustment.message).toContain('$45.00');
        expect(adjustment.message).toContain('$50.00');
        // The one-tap action names the figure it adopts.
        expect(adjustment.confirmText).toBe('Update total to $45.00');
    });

    it('formats in the expense currency', () => {
        const adjustment = getExactTotalAdjustment('EXACT', mismatch(4500), 5000, 'EUR')!;
        expect(adjustment.confirmText).toContain('€45.00');
    });

    it('offers an increase as readily as a decrease', () => {
        const adjustment = getExactTotalAdjustment('EXACT', mismatch(5500), 5000, 'USD')!;
        expect(adjustment.newTotalCents).toBe(5500);
        expect(adjustment.confirmText).toBe('Update total to $55.00');
    });

    it('offers nothing for other split types', () => {
        expect(
            getExactTotalAdjustment('PERCENT', { error: 'Percentages must sum to 100%' }, 5000, 'USD')
        ).toBeNull();
    });

    it('offers nothing when the split reconciled', () => {
        expect(getExactTotalAdjustment('EXACT', {}, 5000, 'USD')).toBeNull();
    });

    it('offers nothing for a zero sum', () => {
        // Nobody entered an amount; a zero total is not an expense.
        expect(getExactTotalAdjustment('EXACT', mismatch(0), 5000, 'USD')).toBeNull();
    });

    it('offers nothing for a negative sum', () => {
        expect(getExactTotalAdjustment('EXACT', mismatch(-200), 5000, 'USD')).toBeNull();
    });
});
