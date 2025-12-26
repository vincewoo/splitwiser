// Shared types for groups and members

export interface GroupBalance {
    user_id: number;
    is_guest: boolean;
    full_name: string;
    amount: number;
    currency: string;
    managed_guests: string[];
}

export interface GroupMember {
    id: number;
    user_id: number;
    full_name: string;
    email: string;
}

export interface GuestMember {
    id: number;
    group_id: number;
    name: string;
    created_by_id: number;
    claimed_by_id: number | null;
    managed_by_id: number | null;
    managed_by_type: string | null;  // 'user' | 'guest'
    managed_by_name: string | null;
}

export interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
    icon?: string | null;
    members?: GroupMember[];
    guests?: GuestMember[];
}
