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
    /**
     * Ticked off by the host as people settle. Nothing can verify a payment —
     * the money moves outside the app — so this is the host's word for it.
     */
    paid?: boolean;
    /**
     * A handle for a seat with no account behind it, so an off-app payer can
     * still be paid. Someone with an account carries theirs on their profile
     * and this stays null.
     */
    venmo_username?: string | null;
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
    /** The payer as an account. Null when whoever paid has no Splitwiser. */
    payer_id: number | null;
    /** The seat that fronted the bill — nameable while the tab is open. */
    payer_participant_id?: number | null;
    /** Null on a tab closed to a plain record, i.e. an off-app payer. */
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
    /** Who the table owes — the payer once closed, the opener before that. */
    host_name?: string | null;
    /**
     * The host's Venmo handle, when they have published one. The only place a
     * handle reaches a link-holder, because a tab is the one place you can owe
     * somebody you have no other way to pay. Never another claimer's.
     */
    host_venmo_username?: string | null;
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
