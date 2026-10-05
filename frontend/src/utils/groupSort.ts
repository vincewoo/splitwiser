import type { Group } from '../types/group';

/**
 * Most-recently-active groups first. Expense ids are effectively monotonic —
 * they follow creation order, though SQLite can reuse the max id after
 * deletes, and deleting a group's newest expense regresses its marker (fine
 * for ordering) — so `latest_expense_id` orders groups by when they last had
 * an expense added (settlements included). Groups with no expenses yet sort
 * after active ones, newest-created first; names break the remaining ties.
 *
 * Used by the Groups page and the FAB resume strip. DesktopRail/MobileTabBar
 * stay alphabetical as stable nav and Overview ranks by balance — intentional
 * divergence.
 */
export function byMostRecentActivity(a: Group, b: Group): number {
    const aLatest = a.latest_expense_id ?? null;
    const bLatest = b.latest_expense_id ?? null;
    if (aLatest !== null && bLatest !== null && aLatest !== bLatest) {
        return bLatest - aLatest;
    }
    if ((aLatest !== null) !== (bLatest !== null)) {
        return aLatest !== null ? -1 : 1;
    }
    if (aLatest === null && a.id !== b.id) {
        return b.id - a.id;
    }
    return a.name.localeCompare(b.name);
}

/**
 * The groups for the FAB sheet's "pick up where you left off" strip: the ones
 * most recently *used*, meaning an expense was actually added. Groups with no
 * activity never qualify — a brand-new empty group is not somewhere you left
 * off, and a dormant group with a large standing balance belongs to the
 * rail's "most at stake" strip (pinnedGroups), not here.
 */
export function mostRecentActiveGroups(groups: Group[], limit = 2): Group[] {
    return groups
        .filter((group) => group.latest_expense_id != null)
        .sort(byMostRecentActivity)
        .slice(0, limit);
}
