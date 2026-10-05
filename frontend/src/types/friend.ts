// Shared types for friends and users

export interface Friend {
    id: number;
    full_name: string;
    email: string;
    /**
     * Their Venmo handle, without the @, when they have published one. Only
     * returned to friends, so settling up can hand over a pre-filled payment.
     */
    venmo_username?: string | null;
}

export interface User {
    id: number;
    full_name: string;
    email: string;
}

export interface FriendBalance {
    amount: number;  // Positive = friend owes you, negative = you owe friend
    currency: string;
}

export interface FriendExpenseWithSplits {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    group_id: number | null;
    created_by_id: number | null;
    splits: Array<{
        id: number;
        expense_id: number;
        user_id: number;
        is_guest: boolean;
        amount_owed: number;
        percentage: number | null;
        shares: number | null;
        user_name: string;
    }>;
    split_type: string;
    items?: Array<{
        id: number;
        expense_id: number;
        description: string;
        price: number;
        is_tax_tip: boolean;
        assignments: Array<{
            user_id: number;
            is_guest: boolean;
            user_name: string;
        }>;
    }>;
    icon?: string | null;
    receipt_image_path?: string | null;
    notes?: string | null;
    is_settlement?: boolean;  // Compat alias for kind === 'settlement'
    kind?: 'expense' | 'settlement' | 'income';
    group_name?: string | null;  // Name of the group if expense is part of a group
    balance_impact?: number | null;  // Balance impact in cents: positive = friend owes you, negative = you owe friend
}
