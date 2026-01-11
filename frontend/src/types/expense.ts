// Shared types for expense management
// Re-export types from centralized locations
export type { Friend } from './friend';
export type { Group, GroupMember, GuestMember } from './group';

export interface Participant {
    id: number;
    name: string;
    isGuest: boolean;
}

export interface ItemAssignment {
    user_id: number;
    is_guest: boolean;
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
    assignments: Array<ItemAssignment & { user_name: string }>;
}

export interface ExpenseWithSplits {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    group_id: number | null;
    created_by_id: number | null;
    splits: ExpenseSplit[];
    split_type: string;
    items?: ExpenseItemDetail[];
    icon?: string | null;
    receipt_image_path?: string | null;
    notes?: string | null;
    exchange_rate?: string | null;
}

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES' | 'ITEMIZED';
