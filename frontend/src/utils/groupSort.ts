import type { Group } from '../types/group';

/**
 * Most-recently-active groups first. Expense ids are effectively monotonic —
 * they follow creation order, though SQLite can reuse the max id after
 * deletes, and deleting a group's newest expense regresses its marker (fine
 * for ordering) — so `latest_expense_id` orders groups by when they last had
 * an expense added (settlements included). Groups with no expenses yet sort
 * after active ones, newest-created first; names break the remaining ties.
 *
 * Groups page only: DesktopRail/MobileTabBar stay alphabetical as stable nav
 * and Overview ranks by balance — intentional divergence.
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
