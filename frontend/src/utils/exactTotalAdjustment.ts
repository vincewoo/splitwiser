import { formatMoney } from './formatters';

/**
 * Everything the adjust-total confirm dialog needs: the figure to adopt and
 * the copy offering it. Shaped here rather than in the modals so the add and
 * edit flows say exactly the same thing.
 */
export interface ExactTotalAdjustment {
    /** The sum of the entered exact amounts, integer cents. */
    newTotalCents: number;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
}

/**
 * When an EXACT split's amounts do not sum to the entered total, offer to
 * adopt the sum as the new total instead of dead-ending on "go back and fix
 * it". The amounts the user typed are usually the figures they trust; the
 * total is the one they estimated.
 *
 * Returns null when there is nothing sensible to offer: a different split
 * type's error, or a sum of zero or less, which is not a total an expense
 * can have — those keep the plain error dialog.
 *
 * `exactSumCents` arrives already rounded to integer cents by
 * calculateExactSplit, so the splits computed alongside it reconcile against
 * the adopted total to the cent; nothing here re-rounds.
 */
export const getExactTotalAdjustment = (
    splitType: string,
    splitResult: { error?: string; exactSumCents?: number },
    enteredTotalCents: number,
    currency: string,
): ExactTotalAdjustment | null => {
    if (splitType !== 'EXACT') return null;
    if (!splitResult.error || splitResult.exactSumCents == null) return null;

    const newTotalCents = splitResult.exactSumCents;
    if (newTotalCents <= 0) return null;

    const newTotal = formatMoney(newTotalCents, currency);
    const oldTotal = formatMoney(enteredTotalCents, currency);

    return {
        newTotalCents,
        title: "Amounts don't match the total",
        message:
            `The amounts you entered add up to ${newTotal}, but the total is ${oldTotal}.\n\n` +
            `Save with ${newTotal} as the new total, or go back and edit the amounts.`,
        confirmText: `Update total to ${newTotal}`,
        cancelText: 'Go back',
    };
};
