import type {
    Participant,
    ExpenseItem,
    ExpenseWithSplits,
    ExpenseItemDetail,
} from '../types/expense';
import {
    calculateEqualSplit,
    calculateExactSplit,
    calculatePercentSplit,
    calculateSharesSplit,
} from './expenseCalculations';
import type { SplitResult } from './expenseCalculations';

// ── Key parsing / building ──────────────────────────────────────────

export interface ParticipantKeyParts {
    type: 'user' | 'guest' | 'expenseguest';
    id: number;
}

/**
 * Parse a participant key like "user_5", "guest_3", or "expenseguest_12".
 */
export const parseParticipantKey = (key: string): ParticipantKeyParts => {
    if (key.startsWith('expenseguest_')) {
        return { type: 'expenseguest', id: parseInt(key.slice('expenseguest_'.length), 10) };
    }
    const [type, idStr] = key.split('_');
    return { type: type as 'user' | 'guest', id: parseInt(idStr, 10) };
};

/**
 * Inverse of parseParticipantKey.
 */
export const buildParticipantKey = (
    type: 'user' | 'guest' | 'expenseguest',
    id: number,
): string => `${type}_${id}`;

// ── Per-item split_details keys ─────────────────────────────────────
//
// A DIFFERENT keyspace from buildParticipantKey above: that one keys the
// expense-level splitDetails form state ("expenseguest_3"), while item
// split_details are persisted and read back by the backend, whose
// get_assignment_key spells expense guests "expense_guest_{id}" — with a
// temp id taking precedence before the guest row exists. These two helpers
// must mirror backend/utils/splits.py::get_assignment_key exactly, or an
// expense guest's amounts are silently dropped (and "user_{expenseGuestId}"
// can collide with a real user's key on the same item).

type ItemAssignmentLike = {
    user_id?: number;
    is_guest?: boolean;
    expense_guest_id?: number;
    temp_guest_id?: string;
};

/** The split_details key for an item assignment, matching the backend. */
export const itemDetailKeyForAssignment = (a: ItemAssignmentLike): string => {
    if (a.temp_guest_id != null) return `expense_guest_${a.temp_guest_id}`;
    if (a.expense_guest_id != null) return `expense_guest_${a.expense_guest_id}`;
    return a.is_guest ? `guest_${a.user_id}` : `user_${a.user_id}`;
};

/** The split_details key for a participant, matching the backend. */
export const itemDetailKeyForParticipant = (p: Participant): string => {
    if (p.isExpenseGuest) return `expense_guest_${p.tempId ?? p.id}`;
    return p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
};

/**
 * Whether an item assignment is this participant's. Expense guests are
 * matched by temp or real guest id, never by user_id — a hydrated
 * expense-guest assignment carries user_id = the guest's id, which can
 * equal a real user's id on the same item.
 */
export const assignmentIsParticipant = (
    a: ItemAssignmentLike,
    p: Participant,
): boolean => {
    if (p.isExpenseGuest) {
        return (
            (a.temp_guest_id != null && a.temp_guest_id === p.tempId) ||
            (a.expense_guest_id != null && a.expense_guest_id === p.id)
        );
    }
    if (a.temp_guest_id != null || a.expense_guest_id != null) return false;
    return a.user_id === p.id && (a.is_guest ?? false) === (p.isGuest ?? false);
};

// ── Extract participant keys from an existing expense ───────────────

/**
 * Build participant key strings from an expense's splits and expense_guests.
 */
export const extractParticipantKeysFromExpense = (
    expense: ExpenseWithSplits,
): string[] => {
    return expense.splits.map(s => {
        if (expense.expense_guests) {
            const isExpenseGuest = expense.expense_guests.some(
                eg => eg.id === s.user_id && !s.is_guest,
            );
            if (isExpenseGuest) {
                return buildParticipantKey('expenseguest', s.user_id);
            }
        }
        return s.is_guest
            ? buildParticipantKey('guest', s.user_id)
            : buildParticipantKey('user', s.user_id);
    });
};

// ── Extract split details from an existing expense ──────────────────

/**
 * For PERCENTAGE / SHARES / EXACT split types, build a record of
 * participant-key → detail-value from the expense's splits.
 *
 * For EQUAL / ITEMIZED the returned object is empty.
 */
export const extractSplitDetailsFromExpense = (
    expense: ExpenseWithSplits,
): Record<string, number> => {
    if (expense.split_type === 'EQUAL' || expense.split_type === 'ITEMIZED') {
        return {};
    }

    const details: Record<string, number> = {};

    expense.splits.forEach(s => {
        let key: string;
        if (expense.expense_guests) {
            const isExpenseGuest = expense.expense_guests.some(
                eg => eg.id === s.user_id && !s.is_guest,
            );
            if (isExpenseGuest) {
                key = buildParticipantKey('expenseguest', s.user_id);
            } else {
                key = s.is_guest
                    ? buildParticipantKey('guest', s.user_id)
                    : buildParticipantKey('user', s.user_id);
            }
        } else {
            key = s.is_guest
                ? buildParticipantKey('guest', s.user_id)
                : buildParticipantKey('user', s.user_id);
        }

        if (expense.split_type === 'PERCENT' && s.percentage !== null) {
            details[key] = s.percentage;
        } else if (expense.split_type === 'SHARES' && s.shares !== null) {
            details[key] = s.shares;
        } else if (expense.split_type === 'EXACT') {
            details[key] = s.amount_owed / 100;
        }
    });

    return details;
};

// ── Extract itemized data from an existing expense ──────────────────

export interface ExtractedItemizedData {
    items: ExpenseItem[];
    taxAmount: string;
    tipAmount: string;
}

/**
 * Separate an expense's items into regular items vs tax/tip, converting
 * the response `ExpenseItemDetail` shapes into editable `ExpenseItem` shapes.
 */
export const extractItemizedDataFromExpense = (
    items: ExpenseItemDetail[],
): ExtractedItemizedData => {
    const regularItems = items.filter(i => !i.is_tax_tip);
    const taxTipItems = items.filter(i => i.is_tax_tip);

    const editableItems: ExpenseItem[] = regularItems.map(item => ({
        description: item.description,
        price: item.price,
        is_tax_tip: false,
        // Carry the stored per-item split through, or a save from edit mode
        // silently flattens every SHARES/PERCENT/EXACT item back to EQUAL —
        // the PUT path recreates items from exactly what we hand it. (Splits
        // already flattened by edits made before this existed stay flattened;
        // the data was rewritten server-side at that save.) Deep-copied so the
        // editable form never shares the map with the fetched expense —
        // updateSplitDetail writes would otherwise survive Cancel.
        split_type: item.split_type || 'EQUAL',
        split_details: item.split_details ? structuredClone(item.split_details) : undefined,
        assignments: item.assignments.map(a => {
            if (a.expense_guest_id != null) {
                return {
                    user_id: a.expense_guest_id,
                    is_guest: false,
                    expense_guest_id: a.expense_guest_id,
                };
            }
            return {
                user_id: a.user_id,
                is_guest: a.is_guest,
            };
        }),
    }));

    // Separate Tax and Tip amounts.
    // For backward compatibility, if there's an old "Tax/Tip" item, put it all in tax.
    const taxItems = taxTipItems.filter(
        i => i.description.toLowerCase().includes('tax') && !i.description.toLowerCase().includes('tip'),
    );
    const tipItems = taxTipItems.filter(
        i => i.description.toLowerCase().includes('tip') && !i.description.toLowerCase().includes('tax'),
    );
    const combinedItems = taxTipItems.filter(
        i => i.description.toLowerCase() === 'tax/tip',
    );

    const taxTotal =
        taxItems.reduce((sum, item) => sum + item.price, 0) +
        combinedItems.reduce((sum, item) => sum + item.price, 0);
    const tipTotal = tipItems.reduce((sum, item) => sum + item.price, 0);

    return {
        items: editableItems,
        taxAmount: taxTotal > 0 ? centsToDisplayAmount(taxTotal) : '',
        tipAmount: tipTotal > 0 ? centsToDisplayAmount(tipTotal) : '',
    };
};

// ── Assemble itemized payload ───────────────────────────────────────

export interface AssembledItemizedPayload {
    items: ExpenseItem[];
    totalCents: number;
}

/**
 * Take the regular items array, append Tax / Tip items when the amounts
 * are > 0, and compute the total in cents.
 */
export const assembleItemizedPayload = (
    items: ExpenseItem[],
    taxAmount: string,
    tipAmount: string,
): AssembledItemizedPayload => {
    const allItems: ExpenseItem[] = [...items];
    const tax = amountToCents(taxAmount || '0');
    const tip = amountToCents(tipAmount || '0');

    if (tax > 0) {
        allItems.push({
            description: 'Tax',
            price: tax,
            is_tax_tip: true,
            assignments: [],
        });
    }

    if (tip > 0) {
        allItems.push({
            description: 'Tip',
            price: tip,
            is_tax_tip: true,
            assignments: [],
        });
    }

    const totalCents = allItems.reduce((sum, item) => sum + item.price, 0);
    return { items: allItems, totalCents };
};

// ── Assemble splits payload ─────────────────────────────────────────

/**
 * Calculate splits for the given split type, filtering out expense-guest
 * participants. For ITEMIZED, returns all (non-expense-guest) participants
 * with amount_owed: 0.
 */
export const assembleSplitsPayload = (
    splitType: string,
    participants: Participant[],
    splitDetails: Record<string, string | number>,
    totalAmountCents: number,
): { splits: SplitResult[]; error?: string; exactSumCents?: number } => {
    // Filter out expense guests — they're handled separately on the backend
    const regularParticipants = participants.filter(p => !p.isExpenseGuest);

    if (splitType === 'ITEMIZED') {
        return {
            splits: regularParticipants.map(p => ({
                user_id: p.id,
                is_guest: p.isGuest,
                amount_owed: 0,
            })),
        };
    }

    if (splitType === 'EQUAL') {
        return { splits: calculateEqualSplit(totalAmountCents, regularParticipants) };
    }

    if (splitType === 'EXACT') {
        return calculateExactSplit(totalAmountCents, regularParticipants, splitDetails);
    }

    if (splitType === 'PERCENT') {
        return calculatePercentSplit(totalAmountCents, regularParticipants, splitDetails);
    }

    if (splitType === 'SHARES') {
        return calculateSharesSplit(totalAmountCents, regularParticipants, splitDetails);
    }

    return { splits: [] };
};

// ── Amount helpers ──────────────────────────────────────────────────

/**
 * Convert a display-amount string (e.g. "12.50") to integer cents.
 */
export const amountToCents = (amount: string): number =>
    Math.round(parseFloat(amount || '0') * 100);

/**
 * Convert integer cents to a display string with two decimals.
 */
export const centsToDisplayAmount = (cents: number): string =>
    (cents / 100).toFixed(2);
