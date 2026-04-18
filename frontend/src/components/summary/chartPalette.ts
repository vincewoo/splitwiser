import type { GroupSummaryMember } from '../../types/summary';

/**
 * Size of the per-member color palette. The 9th+ member is folded into a
 * single "Others" overflow segment in both chart stacks and the legend.
 */
export const CHART_PALETTE_SIZE = 8;

/**
 * One assigned chart series — either a specific member (slots 1..8) or the
 * "Others" aggregate that collects every member beyond slot 8.
 *
 * `colorVar` is a CSS `var(...)` reference so the value swaps automatically
 * when the `.dark` class toggles on `<html>` (see index.css definitions).
 */
export interface AssignedSeries {
    /** For overflow rows, this is a synthetic negative sentinel; real members use their user_id. */
    user_id: number;
    is_guest: boolean;
    display_name: string;
    /** CSS variable reference, e.g. "var(--chart-color-1)" or "var(--chart-overflow)". */
    colorVar: string;
    /** True for the single "Others" aggregate slot, if present. */
    isOverflow: boolean;
    /**
     * For a named member: the single (user_id, is_guest) key this series represents.
     * For the overflow row: every (user_id, is_guest) pair that folds into "Others".
     */
    memberKeys: ReadonlyArray<{ user_id: number; is_guest: boolean }>;
}

/**
 * Assigns each member a CSS-variable color slot from a fixed 8-color palette,
 * in the order the server returned them (server sorts by total descending, so
 * the highest-spending member always gets slot 1). Members beyond slot 8 are
 * collapsed into one aggregate "Others" series using the overflow gray var.
 *
 * The returned array length is min(members.length, 9) — up to 8 named slots
 * plus (at most) one overflow slot.
 */
export function assignSeriesColors(members: GroupSummaryMember[]): AssignedSeries[] {
    const named: AssignedSeries[] = members.slice(0, CHART_PALETTE_SIZE).map((m, idx) => ({
        user_id: m.user_id,
        is_guest: m.is_guest,
        display_name: m.display_name,
        colorVar: `var(--chart-color-${idx + 1})`,
        isOverflow: false,
        memberKeys: [{ user_id: m.user_id, is_guest: m.is_guest }],
    }));

    if (members.length <= CHART_PALETTE_SIZE) {
        return named;
    }

    const overflow = members.slice(CHART_PALETTE_SIZE);
    const overflowSeries: AssignedSeries = {
        user_id: -1,
        is_guest: false,
        display_name: 'Others',
        colorVar: 'var(--chart-overflow)',
        isOverflow: true,
        memberKeys: overflow.map((m) => ({ user_id: m.user_id, is_guest: m.is_guest })),
    };

    return [...named, overflowSeries];
}
