// Shared types for tabs — a one-off bill people claim items from via a link.

export interface TabItem {
    id: number;
    description: string;
    price: number; // cents
    added_manually: boolean;
    /** Participant ids on this line; more than one means it is shared. */
    claimed_by: number[];
}

export interface TabParticipant {
    id: number;
    display_name: string;
    /** Set only for participants who were signed in when they claimed. */
    user_id: number | null;
}

export interface Tab {
    id: number;
    name: string;
    currency: string;
    status: 'open' | 'closed';
    tax: number;
    tip: number;
    total: number | null;
    created_by_id: number;
    payer_id: number | null;
    expense_id: number | null;
    items: TabItem[];
    participants: TabParticipant[];
    /** The scanned bill. Owner view only, like the token below. */
    receipt_image_path?: string | null;
    /** Owner view only. */
    share_token?: string | null;
    token_expires_at?: string | null;
}

/** What a link-holder sees — deliberately narrower than Tab. */
export interface PublicTab {
    name: string;
    currency: string;
    status: 'open' | 'closed';
    tax: number;
    tip: number;
    total: number | null;
    items: TabItem[];
    participants: TabParticipant[];
}

export interface TabJoinResponse {
    participant: TabParticipant;
    /** The only handle an account-less claimer has on their own claims. */
    claim_token: string;
    tab: PublicTab;
}

/** A rename result. No claim token — the caller already holds theirs. */
export interface TabIdentityResponse {
    participant: TabParticipant;
    tab: PublicTab;
}
