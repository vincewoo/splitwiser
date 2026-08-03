import { describe, it, expect } from 'vitest';
import { mergeCachedGroups } from '../groupCache';
import type { CachedGroup } from '../../db/schema';

const NOW = 1_700_000_000_000;

/** A group previously cached in full by GET /groups/{id}. */
const cached = (overrides: Partial<CachedGroup> = {}): CachedGroup => ({
    id: 10,
    name: 'Repro Trip',
    created_by_id: 1,
    default_currency: 'USD',
    is_public: false,
    members: [{
        id: 1,
        user_id: 1,
        full_name: 'You',
        email: 'you@example.com',
        managed_by_id: null,
        managed_by_type: null,
        managed_by_name: null,
    }],
    guests: [{ id: 1000, group_id: 10, name: 'Alice', created_by_id: 1 }],
    cached_at: 1,
    is_temp: false,
    ...overrides,
});

/** What GET /groups actually sends: no members, no guests. */
const listEntry = (overrides = {}) => ({
    id: 10,
    name: 'Repro Trip',
    created_by_id: 1,
    default_currency: 'USD',
    is_public: false,
    ...overrides,
});

describe('mergeCachedGroups', () => {
    it('keeps a roster the list payload knows nothing about', () => {
        const { upserts } = mergeCachedGroups([cached()], [listEntry()], NOW);

        expect(upserts).toHaveLength(1);
        expect(upserts[0].guests.map(g => g.name)).toEqual(['Alice']);
        expect(upserts[0].members).toHaveLength(1);
    });

    it('takes fresh values from the list payload where the two overlap', () => {
        const { upserts } = mergeCachedGroups(
            [cached({ name: 'Old Name', default_currency: 'USD' })],
            [listEntry({ name: 'Repro Trip', default_currency: 'EUR' })],
            NOW
        );

        expect(upserts[0].name).toBe('Repro Trip');
        expect(upserts[0].default_currency).toBe('EUR');
        expect(upserts[0].cached_at).toBe(NOW);
        expect(upserts[0].is_temp).toBe(false);
        // ...without losing the roster in the process.
        expect(upserts[0].guests).toHaveLength(1);
    });

    it('gives a group it has never cached an empty roster rather than no roster', () => {
        // CachedGroup declares members/guests as required, so a first-time
        // sync must not write a row that violates its own type.
        const { upserts } = mergeCachedGroups([], [listEntry({ id: 20 })], NOW);

        expect(upserts[0].members).toEqual([]);
        expect(upserts[0].guests).toEqual([]);
    });

    it('reports groups the user is no longer a member of as stale', () => {
        const { upserts, staleIds } = mergeCachedGroups(
            [cached({ id: 10 }), cached({ id: 20, name: 'Ski Cabin' })],
            [listEntry({ id: 10 })],
            NOW
        );

        expect(staleIds).toEqual([20]);
        expect(upserts.map(g => g.id)).toEqual([10]);
    });

    it('reports nothing stale when every cached group is still live', () => {
        const { staleIds } = mergeCachedGroups(
            [cached({ id: 10 })],
            [listEntry({ id: 10 }), listEntry({ id: 20 })],
            NOW
        );

        expect(staleIds).toEqual([]);
    });

    it('leaves offline-created groups alone when the caller excludes them', () => {
        // Temp groups are filtered out by the caller; passing only non-temp
        // rows must not make an unsynced group look stale.
        const { staleIds } = mergeCachedGroups([], [listEntry()], NOW);

        expect(staleIds).toEqual([]);
    });
});
