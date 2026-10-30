import type { Tab } from '../types/tab';

/**
 * What became of a closed tab.
 *
 * A tab closed to an off-app payer never had an expense (`payer_id` stays
 * null). One that did and has none now had its expense deleted — closing
 * records the payer, and deleting the expense clears only the link.
 */
export type ClosedTabFate = 'balances' | 'off-app' | 'deleted';

export function closedTabFate(tab: Tab): ClosedTabFate {
    if (tab.expense_id !== null) return 'balances';
    if (tab.payer_id === null) return 'off-app';
    return 'deleted';
}

/** A few words for a row in a list of tabs. */
export const closedTabFateLabel: Record<ClosedTabFate, string> = {
    balances: 'in your balances',
    'off-app': 'settled outside the app',
    deleted: 'expense deleted',
};

/** The line a closed tab's board ends on. */
export const closedTabNote: Record<ClosedTabFate, string> = {
    balances: 'Closed — this landed in everyone’s balances.',
    'off-app': 'Closed — everyone settles with whoever paid, outside the app.',
    deleted: 'Closed — the expense it became has since been deleted.',
};
