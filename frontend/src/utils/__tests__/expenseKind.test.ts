import { describe, it, expect } from 'vitest';
import {
    expenseKind,
    fallbackIcon,
    isIncome,
    isSettlement,
    payerVerb,
} from '../expenseKind';

describe('expenseKind', () => {
    it('trusts kind when the server sends it', () => {
        expect(expenseKind({ kind: 'expense' })).toBe('expense');
        expect(expenseKind({ kind: 'settlement' })).toBe('settlement');
        expect(expenseKind({ kind: 'income' })).toBe('income');
    });

    it('wins over a stale is_settlement alias', () => {
        // The alias is derived server-side; kind is the source of truth.
        expect(expenseKind({ kind: 'income', is_settlement: false })).toBe('income');
        expect(expenseKind({ kind: 'expense', is_settlement: true })).toBe('expense');
    });

    it('falls back to is_settlement on rows from older servers', () => {
        expect(expenseKind({ is_settlement: true })).toBe('settlement');
        expect(expenseKind({ is_settlement: false })).toBe('expense');
        expect(expenseKind({})).toBe('expense');
    });

    it('treats an unknown kind as the fallback would', () => {
        // A future enum value should degrade like a missing one, not crash
        // the row into some third state.
        expect(expenseKind({ kind: 'adjustment', is_settlement: true })).toBe('settlement');
        expect(expenseKind({ kind: null })).toBe('expense');
    });

    it('answers the two common questions directly', () => {
        expect(isIncome({ kind: 'income' })).toBe(true);
        expect(isIncome({ is_settlement: true })).toBe(false);
        expect(isSettlement({ is_settlement: true })).toBe(true);
        expect(isSettlement({ kind: 'income' })).toBe(false);
    });

    it('phrases the payer line per kind', () => {
        expect(payerVerb({ kind: 'income' })).toBe('received');
        expect(payerVerb({ kind: 'settlement' })).toBe('paid');
        expect(payerVerb({})).toBe('paid');
    });

    it('picks the fallback icon per kind', () => {
        expect(fallbackIcon({})).toBe('🧾');
        expect(fallbackIcon({ is_settlement: true })).toBe('🏦');
        expect(fallbackIcon({ kind: 'income' })).toBe('💸');
    });
});
