import { describe, expect, it } from 'vitest';
import { byMostRecentActivity, mostRecentActiveGroups } from '../groupSort';
import type { Group } from '../../types/group';

function group(overrides: Partial<Group> & { id: number; name: string }): Group {
    return {
        created_by_id: 1,
        default_currency: 'USD',
        ...overrides,
    };
}

describe('byMostRecentActivity', () => {
    it('puts the group with the newest expense first', () => {
        const stale = group({ id: 1, name: 'Alpha', latest_expense_id: 10 });
        const fresh = group({ id: 2, name: 'Zulu', latest_expense_id: 99 });
        expect([stale, fresh].sort(byMostRecentActivity)).toEqual([fresh, stale]);
    });

    it('sorts groups without expenses after active ones', () => {
        const empty = group({ id: 9, name: 'Aaa' });
        const active = group({ id: 1, name: 'Zzz', latest_expense_id: 3 });
        expect([empty, active].sort(byMostRecentActivity)).toEqual([active, empty]);
    });

    it('orders empty groups newest-created first', () => {
        const older = group({ id: 1, name: 'Aaa', latest_expense_id: null });
        const newer = group({ id: 2, name: 'Zzz', latest_expense_id: null });
        expect([older, newer].sort(byMostRecentActivity)).toEqual([newer, older]);
    });

    it('falls back to name on equal activity', () => {
        const b = group({ id: 1, name: 'Bravo', latest_expense_id: 5 });
        const a = group({ id: 1, name: 'Alpha', latest_expense_id: 5 });
        expect([b, a].sort(byMostRecentActivity)).toEqual([a, b]);
    });
});

describe('mostRecentActiveGroups', () => {
    it('picks the most recently used groups, not the biggest balances', () => {
        const dormant = group({ id: 1, name: 'Golfzoners', latest_expense_id: 3 });
        const recent = group({ id: 2, name: 'China 2025', latest_expense_id: 90 });
        const recentest = group({ id: 3, name: 'Eliz in NYC', latest_expense_id: 95 });
        expect(mostRecentActiveGroups([dormant, recent, recentest])).toEqual([
            recentest,
            recent,
        ]);
    });

    it('never includes a group with no activity', () => {
        const empty = group({ id: 9, name: 'La Romana 2026' });
        const active = group({ id: 1, name: 'Karaokers', latest_expense_id: 7 });
        expect(mostRecentActiveGroups([empty, active])).toEqual([active]);
    });

    it('returns nothing when no group has activity', () => {
        const a = group({ id: 1, name: 'Aaa' });
        const b = group({ id: 2, name: 'Bbb', latest_expense_id: null });
        expect(mostRecentActiveGroups([a, b])).toEqual([]);
    });

    it('does not mutate the input order', () => {
        const groups = [
            group({ id: 1, name: 'Aaa', latest_expense_id: 1 }),
            group({ id: 2, name: 'Bbb', latest_expense_id: 2 }),
        ];
        mostRecentActiveGroups(groups);
        expect(groups.map((g) => g.id)).toEqual([1, 2]);
    });
});
