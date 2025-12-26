// Shared types for balances

export interface Balance {
    user_id: number;
    full_name: string;
    amount: number;
    currency: string;
    is_guest?: boolean;
    group_name?: string;
    group_id?: number;
}

export interface GroupBalance {
    user_id: number;
    is_guest: boolean;
    full_name: string;
    amount: number;
    currency: string;
}
