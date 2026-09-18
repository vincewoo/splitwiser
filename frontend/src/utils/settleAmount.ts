/**
 * Reading a settle-up amount somebody has typed against the figure the plan
 * suggested.
 *
 * The plan says "Sam pays you $54.35", but what actually arrived may be $50
 * (they rounded), $40 (they paid part) or $60 (they rounded the other way).
 * The ledger should record what happened, not what was suggested — so the
 * figure is editable, and this module says what the edited figure means so
 * the sheet can say it before anything is recorded.
 *
 * Kept apart from the component so the rules are testable on their own, in
 * the same way `amountInput.ts` is for the add-expense field.
 */

import { amountToCents, sanitizeAmountInput } from './amountInput';
import { formatMoney } from './formatters';
import type { ExpensePayload } from '../types/expense';

/** Cents to the two-decimal string the field starts from: 5435 → "54.35". */
export function centsToInput(cents: number): string {
    return (Math.round(cents) / 100).toFixed(2);
}

export type SettleAmountStatus =
    /** Nothing usable typed yet: empty, a lone ".", or zero. */
    | { kind: 'empty' }
    /** Exactly the suggested figure. */
    | { kind: 'full'; cents: number }
    /** Less than suggested; `remaining` is what stays outstanding. */
    | { kind: 'partial'; cents: number; remaining: number }
    /** More than suggested; `excess` is what the payer is then owed. */
    | { kind: 'over'; cents: number; excess: number };

/**
 * Classify a typed entry against the outstanding figure, both in whole cents.
 *
 * Overpaying is allowed rather than refused: somebody who rounded $54.35 up
 * to $60 really did send $60, and recording $54.35 would leave the ledger
 * wrong by the difference. What it costs is that the payer comes out owed the
 * excess and the group re-plans around that, which is the right answer for
 * that ledger — so the sheet warns, and lets it through.
 */
export function classifySettleAmount(
    entry: string,
    outstanding: number
): SettleAmountStatus {
    // The field sanitizes as it goes, so this is a no-op for anything typed
    // there; it lets a pasted or programmatic "54,35" read the same way.
    const cents = amountToCents(sanitizeAmountInput(entry));
    if (cents === null) return { kind: 'empty' };
    return classifySettleCents(cents, outstanding);
}

/** The same classification for a figure already in whole cents. */
export function classifySettleCents(
    cents: number,
    outstanding: number
): SettleAmountStatus {
    const paid = Math.round(cents);
    const target = Math.round(outstanding);
    if (paid <= 0) return { kind: 'empty' };
    if (paid === target) return { kind: 'full', cents: paid };
    if (paid < target) return { kind: 'partial', cents: paid, remaining: target - paid };
    return { kind: 'over', cents: paid, excess: paid - target };
}

export interface SettleAmountContext {
    currency: string;
    /** The two parties, by name. */
    payer: string;
    payee: string;
    /**
     * Which side the signed-in user is on, so the copy can say "you". Null
     * when they are neither — a group's plan lists payments between two other
     * people, and a member may record one of those on the group's behalf.
     */
    you: 'payer' | 'payee' | null;
}

/** "you", or the name, for one side of the payment. */
function side(ctx: SettleAmountContext, which: 'payer' | 'payee'): string {
    if (ctx.you === which) return 'you';
    return which === 'payer' ? ctx.payer : ctx.payee;
}

/** "you owe", "Sam owes". */
function owes(ctx: SettleAmountContext, which: 'payer' | 'payee'): string {
    const name = side(ctx, which);
    return name === 'you' ? 'you owe' : `${name} owes`;
}

/** "you'll be owed", "Sam will be owed". */
function willBeOwed(ctx: SettleAmountContext, which: 'payer' | 'payee'): string {
    const name = side(ctx, which);
    return name === 'you' ? "you'll be owed" : `${name} will be owed`;
}

/** The sheet's heading: who pays whom, from the signed-in user's seat. */
export function settleHeading(ctx: SettleAmountContext): string {
    if (ctx.you === 'payer') return `You pay ${ctx.payee}`;
    if (ctx.you === 'payee') return `${ctx.payer} pays you`;
    return `${ctx.payer} pays ${ctx.payee}`;
}

/**
 * The line under the field: what recording this figure would leave behind.
 *
 * Null when there is nothing to say yet. The direction matters most for the
 * overpayment case, and the wording is careful about what the ledger does:
 * balances are per person, not per pair, so the excess raises the payer's
 * balance by that much — "you'll be owed $5.65" — and whom the plan then has
 * pay it depends on the rest of the group. Promising "Sam will owe you" would
 * be wrong whenever it nets against something else.
 */
export function settleAmountNote(
    status: SettleAmountStatus,
    ctx: SettleAmountContext
): string | null {
    switch (status.kind) {
        case 'empty':
            return null;
        case 'full':
            return `Clears what ${owes(ctx, 'payer')} ${side(ctx, 'payee')}.`;
        case 'partial':
            return `Leaves ${formatMoney(status.remaining, ctx.currency)} outstanding.`;
        case 'over': {
            const excess = formatMoney(status.excess, ctx.currency);
            return `That's ${excess} more than ${owes(ctx, 'payer')} — ${willBeOwed(
                ctx,
                'payer'
            )} ${excess} instead.`;
        }
    }
}

/**
 * The note stored on a settlement recorded for other than the suggested
 * figure, so the feed row explains why the balance did not go to zero.
 * Null for a full payment, where the surface's usual note stands.
 */
export function partialPaymentNote(
    status: SettleAmountStatus,
    outstanding: number,
    currency: string
): string | null {
    if (status.kind !== 'partial' && status.kind !== 'over') return null;
    return `${formatMoney(status.cents, currency)} against ${formatMoney(
        outstanding,
        currency
    )} suggested`;
}

/** One side of a recorded payment. */
export interface PaymentParty {
    userId: number;
    isGuest: boolean;
}

/**
 * The expense a settlement is recorded as, wherever it is recorded from: the
 * payer covers the whole amount and the payee carries the whole split, so it
 * cancels that much of the debt between them. `is_settlement` keeps it out
 * of spending totals and under the Settlements filter.
 */
export function settlementExpense(payment: {
    description: string;
    notes: string;
    cents: number;
    currency: string;
    groupId: number;
    payer: PaymentParty;
    payee: PaymentParty;
    date: string;
}): ExpensePayload {
    return {
        description: payment.description,
        amount: payment.cents,
        currency: payment.currency,
        date: payment.date,
        group_id: payment.groupId,
        payer_id: payment.payer.userId,
        payer_is_guest: payment.payer.isGuest,
        split_type: 'EQUAL',
        icon: '🏦',
        notes: payment.notes,
        is_settlement: true,
        splits: [
            {
                user_id: payment.payee.userId,
                is_guest: payment.payee.isGuest,
                amount_owed: payment.cents,
            },
        ],
    };
}
