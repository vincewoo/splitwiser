/**
 * Person-to-person settlement, assembled from the per-group debt simplification.
 *
 * Background on why this exists: `/balances` does NOT return a list of people.
 * It returns one aggregate row per group (with `user_id: 0` and the group's name
 * in `full_name`), plus per-person rows only for non-group IOUs. The per-person
 * view the design calls for — "Maya owes you $84.20 across Tahoe and 2 more" —
 * has to be built from `/simplify_debts/{group_id}`, which is the only endpoint
 * that returns who should pay whom.
 */

export interface SimplifiedTransaction {
    from_id: number;
    from_is_guest: boolean;
    to_id: number;
    to_is_guest: boolean;
    amount: number;
    currency: string;
}

/**
 * Who the ids in a group's transactions refer to. Returned alongside them by
 * `/simplify_debts/{group_id}`, so the settle screen can name — and offer a
 * Venmo hand-off to — people it is not friends with.
 */
export interface SettlementParticipant {
    user_id: number;
    is_guest: boolean;
    display_name: string;
    venmo_username: string | null;
}

export interface GroupTransactions {
    groupId: number;
    groupName: string;
    transactions: SimplifiedTransaction[];
    /** Optional so an older cached response still parses. */
    participants?: SettlementParticipant[];
}

/** Key a participant by group when they are a guest — guest ids repeat. */
export function participantKey(
    groupId: number,
    userId: number,
    isGuest: boolean
): string {
    return isGuest ? `guest-${groupId}-${userId}` : `user-${userId}`;
}

/**
 * Flatten every group's participants into one lookup.
 *
 * Registered people collapse across groups (the same account everywhere);
 * guests stay scoped to their group, because the same guest id in two groups
 * is two different people.
 */
export function participantDirectory(
    groups: GroupTransactions[]
): Map<string, SettlementParticipant> {
    const directory = new Map<string, SettlementParticipant>();
    for (const { groupId, participants } of groups) {
        for (const participant of participants ?? []) {
            directory.set(
                participantKey(groupId, participant.user_id, participant.is_guest),
                participant
            );
        }
    }
    return directory;
}

/** Anyone the settlement screens name: a counterparty or a single payment. */
export interface SettlementParty {
    userId: number;
    isGuest: boolean;
    /** Undefined once a counterparty spans several groups. */
    groupId?: number;
}

/**
 * What to call someone in a settlement figure.
 *
 * The directory answers first, because it covers everyone in your groups —
 * guests, and members you have never befriended. Friends are the fallback for
 * a response cached before the directory existed; the bare id is the last
 * resort, and should not be reachable in practice.
 *
 * Guests are only resolvable inside their group, so a guest with no `groupId`
 * cannot be looked up. That combination does not arise: guest ids are
 * group-scoped, so guest counterparties never merge across groups and always
 * keep theirs. Registered people do merge, and their key ignores the group.
 */
export function partyName(
    directory: Map<string, SettlementParticipant>,
    party: SettlementParty,
    friendNames: Map<number, string>
): string {
    const known =
        party.isGuest && party.groupId === undefined
            ? undefined
            : directory.get(
                  participantKey(party.groupId ?? 0, party.userId, party.isGuest)
              );
    if (known) return known.display_name;
    if (party.isGuest) return 'Guest';
    return friendNames.get(party.userId) ?? `Person ${party.userId}`;
}

export interface Counterparty {
    key: string;
    userId: number;
    isGuest: boolean;
    /** Positive: they pay you. Negative: you pay them. */
    amount: number;
    currency: string;
    /** Groups this figure came from, for the row's subtitle. */
    groups: string[];
    /** Set when the whole figure comes from one group. */
    groupId?: number;
}

/**
 * Reduce every group's simplified transactions to one figure per counterparty
 * per currency, from `currentUserId`'s point of view.
 *
 * Transactions between two other people are ignored — they are real, but they
 * are not this user's business and never appear in their totals.
 */
export function settlementForUser(
    groups: GroupTransactions[],
    currentUserId: number
): Counterparty[] {
    const byKey = new Map<string, Counterparty>();

    for (const { groupId, groupName, transactions } of groups) {
        for (const tx of transactions) {
            const iAmPayer = !tx.from_is_guest && tx.from_id === currentUserId;
            const iAmPayee = !tx.to_is_guest && tx.to_id === currentUserId;
            if (iAmPayer === iAmPayee) continue; // not mine, or self-referential

            const otherId = iAmPayer ? tx.to_id : tx.from_id;
            const otherIsGuest = iAmPayer ? tx.to_is_guest : tx.from_is_guest;
            // I pay them → negative; they pay me → positive.
            const signed = iAmPayer ? -tx.amount : tx.amount;

            // Guests are scoped to their group: the same guest id in two groups
            // is two different people.
            const key = otherIsGuest
                ? `guest-${groupId}-${otherId}-${tx.currency}`
                : `user-${otherId}-${tx.currency}`;

            const existing = byKey.get(key);
            if (existing) {
                existing.amount += signed;
                if (!existing.groups.includes(groupName)) {
                    existing.groups.push(groupName);
                    existing.groupId = undefined;
                }
            } else {
                byKey.set(key, {
                    key,
                    userId: otherId,
                    isGuest: otherIsGuest,
                    amount: signed,
                    currency: tx.currency,
                    groups: [groupName],
                    groupId,
                });
            }
        }
    }

    // A counterparty can net to zero across groups — they owe you in one and you
    // owe them in another. Those are settled, so drop them.
    return [...byKey.values()].filter((c) => Math.round(c.amount) !== 0);
}

export interface SuggestedPayment {
    key: string;
    /** The other party. */
    userId: number;
    isGuest: boolean;
    /** True when the current user is the one paying. */
    iPay: boolean;
    /** Always positive — the direction is carried by `iPay`. */
    amount: number;
    currency: string;
    groupId: number;
    groupName: string;
}

/**
 * One payment's identity within a plan: the group and the two parties.
 *
 * Keyed by the pair rather than the position, because the key has to survive
 * a reload. After a partial payment the same transaction comes back smaller
 * at the same slot; after a full one the rows below it move up a slot. A
 * positional key would hide the wrong row in both cases. A pair appears at
 * most once in a plan, so this is unique.
 */
export function paymentKey(
    groupId: number,
    tx: Pick<SimplifiedTransaction, 'from_id' | 'from_is_guest' | 'to_id' | 'to_is_guest'>
): string {
    const party = (id: number, isGuest: boolean) => `${isGuest ? 'g' : 'u'}${id}`;
    return `${groupId}:${party(tx.from_id, tx.from_is_guest)}>${party(
        tx.to_id,
        tx.to_is_guest
    )}`;
}

/**
 * The individual payments the current user is party to, kept per group rather
 * than merged.
 *
 * `settlementForUser` folds a person's debts across groups into one figure,
 * which is what the overview should show — but a merged figure cannot be
 * *recorded*, because a settlement is an expense and an expense belongs to one
 * group. Anything that writes a settlement needs this list instead.
 */
export function paymentsForUser(
    groups: GroupTransactions[],
    currentUserId: number
): SuggestedPayment[] {
    const payments: SuggestedPayment[] = [];

    for (const { groupId, groupName, transactions } of groups) {
        for (const tx of transactions) {
            const iAmPayer = !tx.from_is_guest && tx.from_id === currentUserId;
            const iAmPayee = !tx.to_is_guest && tx.to_id === currentUserId;
            if (iAmPayer === iAmPayee) continue;

            payments.push({
                key: paymentKey(groupId, tx),
                userId: iAmPayer ? tx.to_id : tx.from_id,
                isGuest: iAmPayer ? tx.to_is_guest : tx.from_is_guest,
                iPay: iAmPayer,
                amount: tx.amount,
                currency: tx.currency,
                groupId,
                groupName,
            });
        }
    }

    return payments.sort((a, b) => b.amount - a.amount);
}

/**
 * Total across counterparties, when they share a currency. Null otherwise —
 * summing across currencies without a rate would invent a number.
 */
export function settlementTotal(
    counterparties: Counterparty[]
): { amount: number; currency: string } | null {
    if (counterparties.length === 0) return null;
    const currencies = new Set(counterparties.map((c) => c.currency));
    if (currencies.size !== 1) return null;
    return {
        amount: counterparties.reduce((sum, c) => sum + c.amount, 0),
        currency: [...currencies][0],
    };
}
