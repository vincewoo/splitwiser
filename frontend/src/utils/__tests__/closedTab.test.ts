import { describe, it, expect } from 'vitest';
import { closedTabFate, closedTabFateLabel, closedTabNote } from '../closedTab';
import type { Tab } from '../../types/tab';

const tab = (over: Partial<Tab>): Tab => ({
    id: 1,
    name: 'Golfzon',
    currency: 'USD',
    status: 'closed',
    tax: 0,
    tip: 0,
    total: 1000,
    created_by_id: 18,
    payer_id: 18,
    expense_id: null,
    items: [],
    participants: [],
    ...over,
});

describe('closedTabFate', () => {
    it('is in balances while its expense exists', () => {
        expect(closedTabFate(tab({ expense_id: 334 }))).toBe('balances');
    });

    it('was settled outside the app when nobody with an account paid', () => {
        expect(closedTabFate(tab({ payer_id: null }))).toBe('off-app');
    });

    it('had its expense deleted when it had a payer but has no expense now', () => {
        expect(closedTabFate(tab({}))).toBe('deleted');
    });

    it('has words for every fate, in a row and on the board', () => {
        for (const fate of ['balances', 'off-app', 'deleted'] as const) {
            expect(closedTabFateLabel[fate]).toBeTruthy();
            expect(closedTabNote[fate]).toMatch(/^Closed — /);
        }
    });
});
