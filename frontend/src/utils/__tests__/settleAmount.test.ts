import { describe, it, expect } from 'vitest';
import {
    centsToInput,
    classifySettleAmount,
    classifySettleCents,
    partialPaymentNote,
    settleAmountNote,
    settleHeading,
    settlementExpense,
} from '../settleAmount';
import type { SettleAmountContext } from '../settleAmount';

const OWED = 5435;

describe('centsToInput', () => {
    it('seeds the field with two decimals', () => {
        expect(centsToInput(5435)).toBe('54.35');
        expect(centsToInput(5400)).toBe('54.00');
        expect(centsToInput(5)).toBe('0.05');
    });

    it('rounds a fractional-cent figure rather than showing it', () => {
        // Plan amounts are whole cents, but a rate-converted figure may not be.
        expect(centsToInput(5434.6)).toBe('54.35');
    });
});

describe('classifySettleAmount', () => {
    it('treats nothing typed as nothing', () => {
        expect(classifySettleAmount('', OWED)).toEqual({ kind: 'empty' });
        expect(classifySettleAmount('.', OWED)).toEqual({ kind: 'empty' });
        expect(classifySettleAmount('0', OWED)).toEqual({ kind: 'empty' });
        expect(classifySettleAmount('0.00', OWED)).toEqual({ kind: 'empty' });
    });

    it('recognises the suggested figure', () => {
        expect(classifySettleAmount('54.35', OWED)).toEqual({ kind: 'full', cents: 5435 });
    });

    it('measures a partial payment by what it leaves', () => {
        expect(classifySettleAmount('40', OWED)).toEqual({
            kind: 'partial',
            cents: 4000,
            remaining: 1435,
        });
        // A cent under is still partial.
        expect(classifySettleAmount('54.34', OWED)).toMatchObject({
            kind: 'partial',
            remaining: 1,
        });
    });

    it('measures an overpayment by the excess', () => {
        expect(classifySettleAmount('60', OWED)).toEqual({
            kind: 'over',
            cents: 6000,
            excess: 565,
        });
    });

    it('reads a comma as the decimal separator, like the amount field', () => {
        expect(classifySettleAmount('54,35', OWED)).toEqual({ kind: 'full', cents: 5435 });
    });

    it('compares against the suggested figure in whole cents', () => {
        expect(classifySettleAmount('54.35', 5434.6)).toEqual({ kind: 'full', cents: 5435 });
    });
});

describe('classifySettleCents', () => {
    it('agrees with the string form', () => {
        expect(classifySettleCents(5435, OWED)).toEqual(classifySettleAmount('54.35', OWED));
        expect(classifySettleCents(4000, OWED)).toEqual(classifySettleAmount('40', OWED));
        expect(classifySettleCents(6000, OWED)).toEqual(classifySettleAmount('60', OWED));
        expect(classifySettleCents(0, OWED)).toEqual({ kind: 'empty' });
    });
});

const iPay: SettleAmountContext = {
    currency: 'USD',
    payer: 'You',
    payee: 'Sam',
    you: 'payer',
};
const theyPay: SettleAmountContext = {
    currency: 'USD',
    payer: 'Sam',
    payee: 'You',
    you: 'payee',
};
const othersPay: SettleAmountContext = {
    currency: 'USD',
    payer: 'Sam',
    payee: 'Dev',
    you: null,
};

describe('settleHeading', () => {
    it('speaks from the signed-in seat', () => {
        expect(settleHeading(iPay)).toBe('You pay Sam');
        expect(settleHeading(theyPay)).toBe('Sam pays you');
        expect(settleHeading(othersPay)).toBe('Sam pays Dev');
    });
});

describe('settleAmountNote', () => {
    it('says nothing until there is a figure', () => {
        expect(settleAmountNote({ kind: 'empty' }, iPay)).toBeNull();
    });

    it('confirms a full payment in the right direction', () => {
        const full = { kind: 'full' as const, cents: OWED };
        expect(settleAmountNote(full, iPay)).toBe('Clears what you owe Sam.');
        expect(settleAmountNote(full, theyPay)).toBe('Clears what Sam owes you.');
        expect(settleAmountNote(full, othersPay)).toBe('Clears what Sam owes Dev.');
    });

    it('says what a partial payment leaves outstanding', () => {
        expect(
            settleAmountNote({ kind: 'partial', cents: 4000, remaining: 1435 }, iPay)
        ).toBe('Leaves $14.35 outstanding.');
    });

    it('warns that an overpayment turns the payer into a creditor', () => {
        // Balances are per person, so the excess is owed *to the payer* —
        // by whom is for the plan to say, which is why this does not promise
        // "Sam will owe you".
        const over = { kind: 'over' as const, cents: 6000, excess: 565 };
        expect(settleAmountNote(over, iPay)).toBe(
            "That's $5.65 more than you owe — you'll be owed $5.65 instead."
        );
        expect(settleAmountNote(over, theyPay)).toBe(
            "That's $5.65 more than Sam owes — Sam will be owed $5.65 instead."
        );
        expect(settleAmountNote(over, othersPay)).toBe(
            "That's $5.65 more than Sam owes — Sam will be owed $5.65 instead."
        );
    });

    it('formats in the debt currency', () => {
        expect(
            settleAmountNote(
                { kind: 'partial', cents: 4000, remaining: 1435 },
                { ...iPay, currency: 'EUR' }
            )
        ).toBe('Leaves €14.35 outstanding.');
    });
});

describe('partialPaymentNote', () => {
    it('is silent for a full payment, where the usual note stands', () => {
        expect(partialPaymentNote({ kind: 'full', cents: OWED }, OWED, 'USD')).toBeNull();
        expect(partialPaymentNote({ kind: 'empty' }, OWED, 'USD')).toBeNull();
    });

    it('records what the figure was measured against', () => {
        expect(
            partialPaymentNote({ kind: 'partial', cents: 4000, remaining: 1435 }, OWED, 'USD')
        ).toBe('$40.00 against $54.35 suggested');
        expect(
            partialPaymentNote({ kind: 'over', cents: 6000, excess: 565 }, OWED, 'USD')
        ).toBe('$60.00 against $54.35 suggested');
    });
});

describe('settlementExpense', () => {
    it('marks the payload a settlement in both the enum and the alias', () => {
        const payload = settlementExpense({
            description: 'Sam pays you',
            notes: '',
            cents: 5435,
            currency: 'USD',
            groupId: 7,
            payer: { userId: 2, isGuest: false },
            payee: { userId: 1, isGuest: false },
            date: '2026-10-04',
        });

        // kind is what new servers read; is_settlement keeps older ones
        // filing it under Settlements rather than spending.
        expect(payload.kind).toBe('settlement');
        expect(payload.is_settlement).toBe(true);
        // The payer covers it all and the payee carries the whole split.
        expect(payload.amount).toBe(5435);
        expect(payload.splits).toEqual([
            { user_id: 1, is_guest: false, amount_owed: 5435 },
        ]);
    });
});
