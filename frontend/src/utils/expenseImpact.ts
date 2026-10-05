import { isIncome } from './expenseKind';

export interface ImpactSplit {
    user_id: number;
    is_guest: boolean;
    amount_owed: number;
}

export interface ImpactExpense {
    amount: number;
    payer_id: number;
    payer_is_guest?: boolean;
    splits?: ImpactSplit[];
    kind?: string | null;
    is_settlement?: boolean;
}

export interface ExpenseImpact {
    /**
     * Signed cents. Positive: you are up on this expense (you paid more than
     * your share). Negative: you owe. Zero: it does not touch you, or it nets
     * out exactly.
     */
    amount: number;
    /** True when the expense involves the user at all — as payer or in a split. */
    involved: boolean;
}

/**
 * What one expense did to the current user's balance.
 *
 * The redesign shows this under every expense row ("you lent $99.84" / "you owe
 * $53.08"), which is the number people actually look for — not the bill total.
 *
 * A payer who is also in the splits is up by everything except their own share;
 * a non-payer is down by exactly their share.
 */
export function expenseImpact(
    expense: ImpactExpense,
    userId: number | undefined
): ExpenseImpact {
    if (userId === undefined) return { amount: 0, involved: false };

    const splits = expense.splits ?? [];
    // Guest splits are keyed by guest id in the same user_id column, so
    // is_guest must be checked or a guest can be mistaken for the user.
    const myShare = splits
        .filter((split) => !split.is_guest && split.user_id === userId)
        .reduce((sum, split) => sum + split.amount_owed, 0);

    const iPaid = !expense.payer_is_guest && expense.payer_id === userId;
    const inSplits = splits.some(
        (split) => !split.is_guest && split.user_id === userId
    );

    if (!iPaid && !inSplits) return { amount: 0, involved: false };

    // Paid the bill: up by the whole amount less your own share. Otherwise down
    // by your share. Money received is the exact dual — the "payer" is holding
    // the group's money and the splits say whose it is — so its impact is the
    // same figure with the sign reversed.
    const sign = isIncome(expense) ? -1 : 1;
    return {
        amount: sign * (iPaid ? expense.amount - myShare : -myShare),
        involved: true,
    };
}

/** Human phrasing for an impact, as the mockup words it. */
export function impactLabel(impact: ExpenseImpact): 'lent' | 'owe' | 'none' {
    if (!impact.involved || impact.amount === 0) return 'none';
    return impact.amount > 0 ? 'lent' : 'owe';
}
