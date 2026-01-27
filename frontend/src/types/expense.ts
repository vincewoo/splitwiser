// Shared types for expense management
// Re-export types from centralized locations
export type { Friend } from './friend';
export type { Group, GroupMember, GuestMember } from './group';

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
    is_settlement?: boolean;  // True if this is a payment/settlement
}

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES' | 'ITEMIZED';
