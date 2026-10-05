// Shared types for expense management
// Re-export types from centralized locations
export type { Friend } from './friend';
export type { Group, GroupMember, GuestMember } from './group';
import type { ExpenseKind } from '../utils/expenseKind';

export interface Participant {
    id: number;
    name: string;
    isGuest: boolean;
    isExpenseGuest?: boolean;  // True if this is an ad-hoc expense guest
    tempId?: string;  // Temporary ID for expense guests before creation
}

export interface ItemAssignment {
    user_id?: number;
    is_guest: boolean;
    temp_guest_id?: string;  // For ad-hoc expense guests
    expense_guest_id?: number;  // For expense guests in responses
}

// Expense guest types for non-group expenses
export interface ExpenseGuestCreate {
    temp_id: string;
    name: string;
}

export interface ExpenseGuest {
    id: number;
    expense_id: number;
    name: string;
    amount_owed: number;
    paid: boolean;
    paid_at: string | null;
}

export interface ExpenseItem {
    description: string;
    price: number;
    is_tax_tip: boolean;
    assignments: ItemAssignment[];
    split_type?: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES'; // How to split this item among assignees
    split_details?: { [key: string]: { amount?: number; percentage?: number; shares?: number } }; // Split details keyed by "user_{id}" or "guest_{id}"
}

export interface ExpenseSplit {
    id: number;
    expense_id: number;
    user_id: number;
    is_guest: boolean;
    amount_owed: number;
    percentage: number | null;
    shares: number | null;
    user_name: string;
}

export interface ExpenseItemDetail {
    id: number;
    expense_id: number;
    description: string;
    price: number;
    is_tax_tip: boolean;
    assignments: Array<ItemAssignment & { user_name: string; expense_guest_id?: number }>;
    split_type?: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES'; // How to split this item among assignees
    split_details?: { [key: string]: { amount?: number; percentage?: number; shares?: number } }; // Split details keyed by "user_{id}" or "guest_{id}"
}

export interface ExpenseWithSplits {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    payer_is_expense_guest?: boolean;  // True if payer is an expense guest
    group_id: number | null;
    created_by_id: number | null;
    splits: ExpenseSplit[];
    split_type: string;
    items?: ExpenseItemDetail[];
    expense_guests?: ExpenseGuest[];  // For non-group expenses with ad-hoc guests
    icon?: string | null;
    receipt_image_path?: string | null;
    notes?: string | null;
    exchange_rate?: string | null;
    exchange_rate_target_currency?: string | null;  // Currency that exchange_rate is relative to
    has_unknown_assignments?: boolean;  // True if expense has items assigned to Unknown
    is_settlement?: boolean;  // Compat alias for kind === 'settlement'
    /** Absent on rows from older server builds; derive via utils/expenseKind. */
    kind?: ExpenseKind;
    /**
     * The tab this expense came from, when it is what a closed tab resolved
     * into. Only sent to the tab's owner — nobody else can open the board.
     */
    tab_id?: number | null;
}

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES' | 'ITEMIZED';

/**
 * A split as sent to the server: no id, no expense_id, no resolved user_name.
 * Structurally compatible with `SplitResult` from utils/expenseCalculations,
 * declared here to keep types/ free of a dependency back on utils/.
 */
export interface ExpenseSplitInput {
    user_id: number;
    amount_owed: number;
    /** Defaults to false server-side when omitted. */
    is_guest?: boolean;
    percentage?: number;
    shares?: number;
}

/**
 * Request body sent to POST /expenses and PUT /expenses/{id}.
 *
 * This is the write shape, distinct from `ExpenseWithSplits` (the read shape):
 * splits carry no ids yet, and items are sent as `ExpenseItem` rather than the
 * server-assigned `ExpenseItemDetail`.
 */
export interface ExpensePayload {
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    split_type: SplitType;
    splits: ExpenseSplitInput[];
    // Present only for non-group expenses paid by an ad-hoc guest.
    payer_is_expense_guest?: boolean;
    payer_temp_guest_id?: string | null;
    group_id?: number | null;
    items?: ExpenseItem[];
    expense_guests?: ExpenseGuestCreate[];
    icon?: string | null;
    receipt_image_path?: string | null;
    notes?: string | null;
    /** Kept beside `kind` so stale servers still read the write correctly. */
    is_settlement?: boolean;
    kind?: ExpenseKind;
}
