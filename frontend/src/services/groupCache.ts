import type { CachedGroup } from '../db/schema';

/** The shape `GET /groups` actually returns: no `members`, no `guests`. */
export type GroupListEntry = Omit<CachedGroup, 'cached_at' | 'is_temp' | 'members' | 'guests'>;

export interface GroupCacheMerge {
    /** Rows to write back, rosters preserved. */
    upserts: CachedGroup[];
    /** Cached groups the user is no longer a member of. */
    staleIds: (number | string)[];
}

/**
 * Fold a `GET /groups` response into the cached groups.
 *
 * The list endpoint omits `members` and `guests` — only `GET /groups/{id}`
 * returns them. So a refresh has to merge over what is already cached rather
 * than replace it: replacing strips the roster off every group, and the next
 * offline read then reports a full group as having nobody in it.
 *
 * `is_temp` rows are the caller's problem — pass only the non-temp ones, or
 * groups created offline will be treated as stale and deleted before they sync.
 */
export function mergeCachedGroups(
    existing: CachedGroup[],
    incoming: GroupListEntry[],
    now: number
): GroupCacheMerge {
    const cached = new Map(existing.map(g => [g.id, g]));
    const liveIds = new Set(incoming.map(g => g.id));

    return {
        upserts: incoming.map(g => ({
            // Roster first so the list payload can't overwrite it with
            // undefined — it carries no such keys, but a future field added to
            // one endpoint and not the other would land here.
            members: cached.get(g.id)?.members ?? [],
            guests: cached.get(g.id)?.guests ?? [],
            ...cached.get(g.id),
            ...g,
            cached_at: now,
            is_temp: false,
        })),
        staleIds: [...cached.keys()].filter(id => !liveIds.has(id)),
    };
}
