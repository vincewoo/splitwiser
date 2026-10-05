import { describe, it, expect } from 'vitest';
import { expenseImpact, impactLabel } from '../expenseImpact';

const ME = 1;

describe('expenseImpact', () => {
    it('reports what the payer lent, net of their own share', () => {
        // $124.80 split 4 ways; I paid.
        const impact = expenseImpact(
            {
                amount: 12480,
                payer_id: ME,
                splits: [
                    { user_id: ME, is_guest: false, amount_owed: 3120 },
                    { user_id: 2, is_guest: false, amount_owed: 3120 },
                    { user_id: 3, is_guest: false, amount_owed: 3120 },
                    { user_id: 4, is_guest: false, amount_owed: 3120 },
                ],
            },
            ME
        );
        expect(impact).toEqual({ amount: 12480 - 3120, involved: true });
        expect(impactLabel(impact)).toBe('lent');
    });

    it('reports what a non-payer owes', () => {
        const impact = expenseImpact(
            {
                amount: 21235,
                payer_id: 2,
                splits: [
                    { user_id: ME, is_guest: false, amount_owed: 5308 },
                    { user_id: 2, is_guest: false, amount_owed: 5309 },
                ],
            },
            ME
        );
        expect(impact).toEqual({ amount: -5308, involved: true });
        expect(impactLabel(impact)).toBe('owe');
    });

    it('gives the payer the full amount when they are not in the splits', () => {
        const impact = expenseImpact(
            {
                amount: 5000,
                payer_id: ME,
                splits: [{ user_id: 2, is_guest: false, amount_owed: 5000 }],
            },
            ME
        );
        expect(impact.amount).toBe(5000);
    });

    it('reports no involvement for an expense that is not mine', () => {
        const impact = expenseImpact(
            {
                amount: 5000,
                payer_id: 2,
                splits: [{ user_id: 3, is_guest: false, amount_owed: 5000 }],
            },
            ME
        );
        expect(impact).toEqual({ amount: 0, involved: false });
        expect(impactLabel(impact)).toBe('none');
    });

    it('does not mistake a guest split for the user', () => {
        // Guest id 1 collides with user id 1; is_guest must disambiguate.
        const impact = expenseImpact(
            {
                amount: 5000,
                payer_id: 9,
                splits: [{ user_id: ME, is_guest: true, amount_owed: 5000 }],
            },
            ME
        );
        expect(impact.involved).toBe(false);
    });

    it('does not credit a guest payer who shares the user id', () => {
        const impact = expenseImpact(
            {
                amount: 5000,
                payer_id: ME,
                payer_is_guest: true,
                splits: [{ user_id: 2, is_guest: false, amount_owed: 5000 }],
            },
            ME
        );
        expect(impact.involved).toBe(false);
    });

    it('nets to zero when the payer covers only their own share', () => {
        const impact = expenseImpact(
            {
                amount: 2500,
                payer_id: ME,
                splits: [{ user_id: ME, is_guest: false, amount_owed: 2500 }],
            },
            ME
        );
        expect(impact.amount).toBe(0);
        expect(impact.involved).toBe(true);
        expect(impactLabel(impact)).toBe('none');
    });

    it('reverses the sign when the receiver holds money for the group', () => {
        // Eliz (me) receives a $200 refund split equally among 4: I hold the
        // other three shares, so I am down $150 — the dual of having paid.
        const impact = expenseImpact(
            {
                amount: 20000,
                payer_id: ME,
                kind: 'income',
                splits: [
                    { user_id: ME, is_guest: false, amount_owed: 5000 },
                    { user_id: 2, is_guest: false, amount_owed: 5000 },
                    { user_id: 3, is_guest: false, amount_owed: 5000 },
                    { user_id: 4, is_guest: false, amount_owed: 5000 },
                ],
            },
            ME
        );
        expect(impact).toEqual({ amount: -15000, involved: true });
        expect(impactLabel(impact)).toBe('owe');
    });

    it('credits a participant their share of money received', () => {
        const impact = expenseImpact(
            {
                amount: 20000,
                payer_id: 2,
                kind: 'income',
                splits: [
                    { user_id: ME, is_guest: false, amount_owed: 5000 },
                    { user_id: 2, is_guest: false, amount_owed: 5000 },
                    { user_id: 3, is_guest: false, amount_owed: 10000 },
                ],
            },
            ME
        );
        expect(impact).toEqual({ amount: 5000, involved: true });
        expect(impactLabel(impact)).toBe('lent');
    });

    it('leaves the sign alone when only the compat alias is present', () => {
        // is_settlement never meant income; the fallback must not flip it.
        const impact = expenseImpact(
            {
                amount: 10000,
                payer_id: 2,
                is_settlement: true,
                splits: [{ user_id: ME, is_guest: false, amount_owed: 10000 }],
            },
            ME
        );
        expect(impact.amount).toBe(-10000);
    });

    it('handles a missing user and missing splits', () => {
        expect(expenseImpact({ amount: 100, payer_id: 1 }, undefined)).toEqual({
            amount: 0,
            involved: false,
        });
        expect(expenseImpact({ amount: 100, payer_id: ME }, ME)).toEqual({
            amount: 100,
            involved: true,
        });
    });
});
