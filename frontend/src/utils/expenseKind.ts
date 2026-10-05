/**
 * The three kinds an expense row can be: an ordinary expense, a settlement
 * (a payment that clears debt), or money received (the dual of an expense —
 * one person holds money that belongs to the group, and the per-person
 * impact reverses sign).
 *
 * The server sends `kind` on new responses and keeps `is_settlement` as a
 * compat alias; rows cached by a stale PWA bundle may carry only the alias.
 * This module is the one place that fallback lives, typed structurally so
 * every expense shape (FeedExpense, GroupExpense, ExpenseWithSplits, …) can
 * pass through it without depending on the others.
 */

export type ExpenseKind = 'expense' | 'settlement' | 'income';

/** The minimal shape the derivation needs — any expense-like object fits. */
export interface ExpenseKindSource {
    kind?: string | null;
    is_settlement?: boolean;
}

/** The expense's kind, deriving it from `is_settlement` when `kind` is absent. */
export function expenseKind(expense: ExpenseKindSource): ExpenseKind {
    const kind = expense.kind;
    if (kind === 'expense' || kind === 'settlement' || kind === 'income') {
        return kind;
    }
    return expense.is_settlement ? 'settlement' : 'expense';
}

export function isIncome(expense: ExpenseKindSource): boolean {
    return expenseKind(expense) === 'income';
}

export function isSettlement(expense: ExpenseKindSource): boolean {
    return expenseKind(expense) === 'settlement';
}

/**
 * The verb for the row's payer line: income rows say "X received" wherever
 * expenses say "X paid". Shared so every surface phrases it the same way.
 */
export function payerVerb(expense: ExpenseKindSource): 'paid' | 'received' {
    return isIncome(expense) ? 'received' : 'paid';
}

/** The icon an expense falls back to when it has none of its own. */
export function fallbackIcon(expense: ExpenseKindSource): string {
    switch (expenseKind(expense)) {
        case 'settlement':
            return '🏦';
        case 'income':
            return '💸';
        default:
            return '🧾';
    }
}
