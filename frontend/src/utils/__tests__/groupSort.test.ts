import { describe, expect, it } from 'vitest';
import { byMostRecentActivity } from '../groupSort';
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
