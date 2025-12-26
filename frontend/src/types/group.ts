// Shared types for groups and members

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
}

export interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
    members?: GroupMember[];
    guests?: GuestMember[];
}
