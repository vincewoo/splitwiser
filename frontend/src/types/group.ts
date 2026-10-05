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
    managed_by_id: number | null;
    managed_by_type: string | null;  // 'user' | 'guest'
    managed_by_name: string | null;
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
    /** Highest expense id in the group — a most-recent-activity marker.
     *  Effectively creation order: SQLite can reuse the max id after deletes,
     *  and deleting a group's newest expense regresses its marker — fine for
     *  ordering. Only present on the group-list response (null for empty
     *  groups there); absent from every other group-shaped response. */
    latest_expense_id?: number | null;
    members?: GroupMember[];
    guests?: GuestMember[];
}
