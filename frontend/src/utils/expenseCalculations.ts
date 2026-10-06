import type { Participant, ExpenseItem, ExpenseItemDetail } from '../types/expense';

/**
 * Read one split-details entry as a number.
 *
 * The field holds raw text: the input is `type="text"` so a decimal can be
 * typed a character at a time, which means "12." and "" are legitimate
 * in-progress states — and so is "abc", because nothing stops it being typed.
 * A bare `parseFloat` turns that last one into NaN, which then rides all the
 * way into `amount_owed` and serialises as `null` in the request body. Under
 * SHARES a single bad entry poisons every participant's amount, not just its
 * own. Anything unparseable is worth exactly zero.
 */
export const parseSplitValue = (value: string | number | undefined): number => {
    const parsed = parseFloat(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
};

export interface SplitResult {
    user_id: number;
    is_guest: boolean;
    amount_owed: number;
    percentage?: number;
    shares?: number;
}

/**
 * Calculate equal splits
 */
export const calculateEqualSplit = (
    totalAmountCents: number,
    participants: Participant[]
): SplitResult[] => {
    const splitAmount = Math.floor(totalAmountCents / participants.length);
    const remainder = totalAmountCents - (splitAmount * participants.length);

    return participants.map((p, index) => ({
        user_id: p.id,
        is_guest: p.isGuest,
        amount_owed: splitAmount + (index === 0 ? remainder : 0)
    }));
};

/**
 * Calculate exact amount splits
 */
export const calculateExactSplit = (
    totalAmountCents: number,
    participants: Participant[],
    splitDetails: { [key: string]: string | number }
): { splits: SplitResult[]; error?: string } => {
    const splits = participants.map(p => {
        const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
        return {
            user_id: p.id,
            is_guest: p.isGuest,
            amount_owed: Math.round(parseSplitValue(splitDetails[key]) * 100)
        };
    });

    const sum = splits.reduce((acc, s) => acc + s.amount_owed, 0);
    if (Math.abs(sum - totalAmountCents) > 1) {
        return {
            splits,
            error: `Amounts do not sum to total. Total: ${totalAmountCents / 100}, Sum: ${sum / 100}`
        };
    }

    return { splits };
};

/**
 * Calculate percentage-based splits
 */
export const calculatePercentSplit = (
    totalAmountCents: number,
    participants: Participant[],
    splitDetails: { [key: string]: string | number }
): { splits: SplitResult[]; error?: string } => {
    const shares = participants.map(p => {
        const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
        return {
            participant: p,
            percent: parseSplitValue(splitDetails[key])
        };
    });

    const percentSum = shares.reduce((acc, s) => acc + s.percent, 0);
    if (Math.abs(percentSum - 100) > 0.1) {
        return {
            splits: [],
            error: `Percentages must sum to 100%. Current: ${percentSum}%`
        };
    }

    let runningTotal = 0;
    const splits = shares.map((s, index) => {
        if (index === shares.length - 1) {
            return {
                user_id: s.participant.id,
                is_guest: s.participant.isGuest,
                amount_owed: totalAmountCents - runningTotal,
                percentage: Math.round(s.percent)
            };
        }
        const share = Math.round(totalAmountCents * (s.percent / 100));
        runningTotal += share;
        return {
            user_id: s.participant.id,
            is_guest: s.participant.isGuest,
            amount_owed: share,
            percentage: Math.round(s.percent)
        };
    });

    return { splits };
};

/**
 * Calculate shares-based splits
 */
export const calculateSharesSplit = (
    totalAmountCents: number,
    participants: Participant[],
    splitDetails: { [key: string]: string | number }
): { splits: SplitResult[]; error?: string } => {
    const sharesMap = participants.map(p => {
        const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
        return {
            participant: p,
            shares: parseSplitValue(splitDetails[key])
        };
    });

    const totalShares = sharesMap.reduce((acc, s) => acc + s.shares, 0);
    if (totalShares === 0) {
        return {
            splits: [],
            error: "Total shares cannot be zero"
        };
    }

    let runningTotal = 0;
    const splits = sharesMap.map((s, index) => {
        if (index === sharesMap.length - 1) {
            return {
                user_id: s.participant.id,
                is_guest: s.participant.isGuest,
                amount_owed: totalAmountCents - runningTotal,
                shares: s.shares
            };
        }
        const shareAmount = Math.round(totalAmountCents * (s.shares / totalShares));
        runningTotal += shareAmount;
        return {
            user_id: s.participant.id,
            is_guest: s.participant.isGuest,
            amount_owed: shareAmount,
            shares: s.shares
        };
    });

    return { splits };
};

export interface PersonItemShare {
    description: string;
    shareAmount: number; // in cents
    percent: number;     // percentage (0-100) of the item this person has
    isShared: boolean;   // true when the item has more than one assignment
    sharedWith: number;  // number of OTHER assignees (0 for solo, >=1 for shared)
}

export interface PersonItemBreakdown {
    items: PersonItemShare[];   // regular (non-tax/tip) items assigned to this person, with their share
    subtotal: number;           // sum of shareAmount across items (cents)
    tax: number;                // this person's proportional tax (cents)
    tip: number;                // this person's proportional tip (cents)
    sharePercent: number;       // personSubtotal / totalSubtotal * 100
}

/**
 * Calculate the per-person breakdown of an itemized expense: which regular items
 * are assigned to the person (with their per-item share) plus their proportional
 * tax/tip. Ports the math previously inlined in ExpenseDetailModal verbatim.
 *
 * Note: this intentionally does NOT reuse the file's calculate*Split helpers. It
 * computes an independent per-item floor share with no remainder reconciliation,
 * because the headline owed total is sourced from split.amount_owed (authoritative)
 * rather than recomputed here.
 */
export const calculatePersonItemBreakdown = (
    person: { user_id: number; is_guest: boolean; expense_guest_id?: number },
    items: ExpenseItemDetail[]
): PersonItemBreakdown => {
    // An expense guest is matched by guest id, never user_id: a hydrated
    // expense-guest assignment carries user_id = the guest's id, which can
    // equal a real user's id on the same item. The detail key mirrors the
    // backend's get_assignment_key.
    const matchesPerson = (a: { user_id?: number; is_guest: boolean; expense_guest_id?: number }) => {
        if (person.expense_guest_id != null) {
            return a.expense_guest_id === person.expense_guest_id;
        }
        return a.expense_guest_id == null
            && a.user_id === person.user_id
            && a.is_guest === person.is_guest;
    };
    const detailKey = (a: { user_id?: number; is_guest: boolean; expense_guest_id?: number }) =>
        a.expense_guest_id != null
            ? `expense_guest_${a.expense_guest_id}`
            : a.is_guest ? `guest_${a.user_id}` : `user_${a.user_id}`;
    const personKey = person.expense_guest_id != null
        ? `expense_guest_${person.expense_guest_id}`
        : person.is_guest ? `guest_${person.user_id}` : `user_${person.user_id}`;
    // Partition items
    const regularItems = items.filter(i => !i.is_tax_tip);
    const taxItems = items.filter(i => i.is_tax_tip && i.description.toLowerCase().includes('tax') && !i.description.toLowerCase().includes('tip'));
    const tipItems = items.filter(i => i.is_tax_tip && i.description.toLowerCase().includes('tip') && !i.description.toLowerCase().includes('tax'));
    const combinedItems = items.filter(i => i.is_tax_tip && i.description.toLowerCase() === 'tax/tip');

    // Calculate this person's items and subtotal
    const personItems: PersonItemShare[] = [];
    let subtotal = 0;
    regularItems.forEach(item => {
        const isAssigned = item.assignments.some(matchesPerson);
        if (isAssigned) {
            // Check if item has custom split type
            const itemSplitType = item.split_type || 'EQUAL';
            const itemSplitDetails = item.split_details || {};

            const isShared = item.assignments.length > 1;
            const sharedWith = item.assignments.length - 1;

            let shareAmount = 0;
            let percent = 0;
            if (item.assignments.length === 1) {
                // Single assignee gets the whole item.
                shareAmount = item.price;
                percent = 100;
            } else if (itemSplitType === 'EQUAL') {
                // Equal split among assignees.
                const shareCount = item.assignments.length;
                shareAmount = Math.floor(item.price / shareCount);
                percent = 100 / shareCount;
            } else if (itemSplitType === 'EXACT') {
                // Use exact amount
                const detail = itemSplitDetails[personKey];
                const personAmount = detail?.amount || 0;
                shareAmount = personAmount;
                percent = item.price > 0 ? (personAmount / item.price) * 100 : 0;
            } else if (itemSplitType === 'PERCENT') {
                // Use percentage
                const detail = itemSplitDetails[personKey];
                const percentage = detail?.percentage || 0;
                shareAmount = Math.floor(item.price * (percentage / 100));
                percent = percentage;
            } else if (itemSplitType === 'SHARES') {
                // Calculate based on shares
                let totalShares = 0;
                item.assignments.forEach(a => {
                    const detail = itemSplitDetails[detailKey(a)];
                    totalShares += detail?.shares || 1;
                });

                const personShares = itemSplitDetails[personKey]?.shares || 1;
                if (totalShares > 0) {
                    shareAmount = Math.floor((item.price * personShares) / totalShares);
                    percent = (personShares / totalShares) * 100;
                }
            }

            personItems.push({ description: item.description, shareAmount, percent, isShared, sharedWith });
            subtotal += shareAmount;
        }
    });

    // Calculate total subtotal of all regular items
    const totalSubtotal = regularItems.reduce((sum, item) => sum + item.price, 0);

    // Calculate person's share percentage of the total
    const sharePercent = totalSubtotal > 0 ? (subtotal / totalSubtotal) * 100 : 0;

    // Calculate tax and tip amounts
    const totalTax = taxItems.reduce((sum, i) => sum + i.price, 0) + combinedItems.reduce((sum, i) => sum + i.price, 0);
    const totalTip = tipItems.reduce((sum, i) => sum + i.price, 0);

    const tax = totalSubtotal > 0 ? Math.round(totalTax * (subtotal / totalSubtotal)) : 0;
    const tip = totalSubtotal > 0 ? Math.round(totalTip * (subtotal / totalSubtotal)) : 0;

    return { items: personItems, subtotal, tax, tip, sharePercent };
};

/**
 * Calculate total for itemized expenses
 */
export const calculateItemizedTotal = (
    items: ExpenseItem[],
    taxAmount: string,
    tipAmount: string
): string => {
    const itemsTotal = items.reduce((sum, item) => sum + item.price, 0);
    const tax = Math.round(parseFloat(taxAmount || '0') * 100);
    const tip = Math.round(parseFloat(tipAmount || '0') * 100);
    return ((itemsTotal + tax + tip) / 100).toFixed(2);
};
