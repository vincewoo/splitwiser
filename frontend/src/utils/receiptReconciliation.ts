export interface ReceiptLine {
    price: number;
}

export type ReconciliationStatus = 'balanced' | 'under' | 'over' | 'unknown';

export interface Reconciliation {
    /** Sum of the line items, in cents. */
    itemsSum: number;
    /** Items + tax + tip, in cents — what we think the receipt should total. */
    computed: number;
    /**
     * Printed total minus computed, in cents. Positive means the receipt says
     * more than the lines account for (something was missed); negative means
     * the lines overshoot. Null when the receipt total was not read.
     */
    delta: number | null;
    status: ReconciliationStatus;
}

/**
 * A difference this small is rounding, not a misread line. The OCR returns
 * whole cents, so anything at or under a cent is noise.
 */
export const RECONCILE_TOLERANCE_CENTS = 1;

/**
 * Check the scanned lines against the printed total.
 *
 * The mismatch is stated up front with the amount, so the fix is one tap rather
 * than a proof-read of every line. The scanner's review step and the expense
 * form both call this on every render, so the figure follows each edit.
 */
export function reconcileReceipt(
    items: ReceiptLine[],
    tax: number | null,
    tip: number | null,
    total: number | null
): Reconciliation {
    const itemsSum = items.reduce((sum, item) => sum + item.price, 0);
    const computed = itemsSum + (tax ?? 0) + (tip ?? 0);

    if (total === null) {
        // Without a printed total there is nothing to reconcile against.
        return { itemsSum, computed, delta: null, status: 'unknown' };
    }

    const delta = total - computed;
    if (Math.abs(delta) <= RECONCILE_TOLERANCE_CENTS) {
        return { itemsSum, computed, delta, status: 'balanced' };
    }

    return {
        itemsSum,
        computed,
        delta,
        status: delta > 0 ? 'under' : 'over',
    };
}

/**
 * The mismatch as one sentence, for the expense form's warning. Null when there
 * is nothing to say: balanced, or no printed total to check against.
 */
export function reconciliationWarning(
    reconciliation: Reconciliation,
    formatMoney: (cents: number) => string
): string | null {
    if (reconciliation.status === 'balanced' || reconciliation.status === 'unknown') {
        return null;
    }
    const { delta } = reconciliation;
    if (delta === null) return null;

    return delta > 0
        ? `Items, tax and tip come to ${formatMoney(reconciliation.computed)}, which is ${formatMoney(Math.abs(delta))} under the receipt total.`
        : `Items, tax and tip come to ${formatMoney(reconciliation.computed)}, which is ${formatMoney(Math.abs(delta))} over the receipt total.`;
}
