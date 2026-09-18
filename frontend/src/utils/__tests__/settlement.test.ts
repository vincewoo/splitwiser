import { describe, it, expect } from 'vitest';
import {
    participantDirectory,
    partyName,
    paymentKey,
    paymentsForUser,
    settlementForUser,
    settlementTotal,
} from '../settlement';
import type { GroupTransactions } from '../settlement';

const ME = 1;

const tx = (from: number, to: number, amount: number, currency = 'USD') => ({
    from_id: from,
    from_is_guest: false,
    to_id: to,
    to_is_guest: false,
    amount,
    currency,
});

const group = (
    groupId: number,
    groupName: string,
    transactions: GroupTransactions['transactions']
): GroupTransactions => ({ groupId, groupName, transactions });

describe('settlementForUser', () => {
    it('reads a debt owed to me as positive', () => {
        const result = settlementForUser(
            [group(1, 'Tahoe', [tx(2, ME, 8420)])],
            ME
        );
        expect(result).toHaveLength(1);
        expect(result[0].amount).toBe(8420);
        expect(result[0].userId).toBe(2);
    });

    it('reads a debt I owe as negative', () => {
        const result = settlementForUser(
            [group(1, 'Tahoe', [tx(ME, 4, 4215)])],
            ME
        );
        expect(result[0].amount).toBe(-4215);
        expect(result[0].userId).toBe(4);
    });

    it('ignores transactions between two other people', () => {
        const result = settlementForUser(
            [group(1, 'Tahoe', [tx(2, 3, 5000), tx(4, 3, 21628)])],
            ME
        );
        expect(result).toEqual([]);
    });

    it('merges the same person across groups', () => {
        const result = settlementForUser(
            [
                group(1, 'Tahoe', [tx(2, ME, 5000)]),
                group(2, 'Lunch', [tx(2, ME, 3420)]),
            ],
            ME
        );
        expect(result).toHaveLength(1);
        expect(result[0].amount).toBe(8420);
        expect(result[0].groups).toEqual(['Tahoe', 'Lunch']);
        // No single group identifies this figure any more.
        expect(result[0].groupId).toBeUndefined();
    });

    it('nets opposing debts with the same person and drops them when settled', () => {
        const result = settlementForUser(
            [
                group(1, 'Tahoe', [tx(2, ME, 5000)]),
                group(2, 'Lunch', [tx(ME, 2, 5000)]),
            ],
            ME
        );
        expect(result).toEqual([]);
    });

    it('keeps a residual when opposing debts do not cancel', () => {
        const result = settlementForUser(
            [
                group(1, 'Tahoe', [tx(2, ME, 5000)]),
                group(2, 'Lunch', [tx(ME, 2, 2000)]),
            ],
            ME
        );
        expect(result[0].amount).toBe(3000);
    });

    it('keeps currencies separate', () => {
        const result = settlementForUser(
            [
                group(1, 'Tahoe', [tx(2, ME, 5000, 'USD')]),
                group(3, 'Lisbon', [tx(2, ME, 9800, 'EUR')]),
            ],
            ME
        );
        expect(result).toHaveLength(2);
        expect(result.map((c) => c.currency).sort()).toEqual(['EUR', 'USD']);
    });

    it('treats the same guest id in different groups as different people', () => {
        const guestTx = (groupCurrency = 'USD') => ({
            from_id: 7,
            from_is_guest: true,
            to_id: ME,
            to_is_guest: false,
            amount: 1000,
            currency: groupCurrency,
        });
        const result = settlementForUser(
            [group(1, 'Tahoe', [guestTx()]), group(2, 'Lunch', [guestTx()])],
            ME
        );
        expect(result).toHaveLength(2);
    });

    it('records the single source group when there is only one', () => {
        const result = settlementForUser(
            [group(7, 'Tahoe', [tx(2, ME, 5000)])],
            ME
        );
        expect(result[0].groupId).toBe(7);
        expect(result[0].groups).toEqual(['Tahoe']);
    });
});

describe('settlementTotal', () => {
    it('totals a single-currency set', () => {
        const parties = settlementForUser(
            [group(1, 'Tahoe', [tx(2, ME, 8420), tx(ME, 4, 4215)])],
            ME
        );
        expect(settlementTotal(parties)).toEqual({
            amount: 8420 - 4215,
            currency: 'USD',
        });
    });

    it('refuses to total across currencies', () => {
        const parties = settlementForUser(
            [
                group(1, 'Tahoe', [tx(2, ME, 8420, 'USD')]),
                group(3, 'Lisbon', [tx(5, ME, 9800, 'EUR')]),
            ],
            ME
        );
        expect(settlementTotal(parties)).toBeNull();
    });

    it('returns null for an empty set', () => {
        expect(settlementTotal([])).toBeNull();
    });
});

describe('partyName', () => {
    const participant = (
        userId: number,
        isGuest: boolean,
        displayName: string
    ) => ({
        user_id: userId,
        is_guest: isGuest,
        display_name: displayName,
        venmo_username: null,
    });

    const directory = participantDirectory([
        {
            groupId: 7,
            groupName: 'Tahoe',
            transactions: [],
            participants: [
                participant(3, true, 'Maya (guest)'),
                participant(2, false, 'Sam Okafor'),
            ],
        },
        {
            groupId: 9,
            groupName: 'Lisbon',
            transactions: [],
            participants: [participant(3, true, 'Theo (guest)')],
        },
    ]);

    const noFriends = new Map<number, string>();

    it('names a guest from the directory rather than their id', () => {
        expect(
            partyName(directory, { userId: 3, isGuest: true, groupId: 7 }, noFriends)
        ).toBe('Maya (guest)');
    });

    it('keeps guests scoped to their group, since guest ids repeat', () => {
        expect(
            partyName(directory, { userId: 3, isGuest: true, groupId: 9 }, noFriends)
        ).toBe('Theo (guest)');
    });

    it('names a group member you have not befriended', () => {
        expect(
            partyName(directory, { userId: 2, isGuest: false, groupId: 7 }, noFriends)
        ).toBe('Sam Okafor');
    });

    it('resolves a registered person merged across groups, which drops groupId', () => {
        expect(partyName(directory, { userId: 2, isGuest: false }, noFriends)).toBe(
            'Sam Okafor'
        );
    });

    it('falls back to the friends list when the directory is missing', () => {
        const empty = participantDirectory([]);
        expect(
            partyName(
                empty,
                { userId: 2, isGuest: false, groupId: 7 },
                new Map([[2, 'Sam Okafor']])
            )
        ).toBe('Sam Okafor');
    });

    it('falls back to "Guest" rather than an id for an unknown guest', () => {
        expect(
            partyName(
                participantDirectory([]),
                { userId: 3, isGuest: true, groupId: 7 },
                noFriends
            )
        ).toBe('Guest');
    });

    it('falls back to the id only for an unknown registered person', () => {
        expect(
            partyName(
                participantDirectory([]),
                { userId: 42, isGuest: false, groupId: 7 },
                noFriends
            )
        ).toBe('Person 42');
    });
});

describe('paymentsForUser', () => {
    it('keeps a person separate per group, unlike the merged view', () => {
        const groups = [
            group(1, 'Tahoe', [tx(2, ME, 5000)]),
            group(2, 'Lunch', [tx(2, ME, 3420)]),
        ];

        // Merged: one counterparty at 8420.
        expect(settlementForUser(groups, ME)).toHaveLength(1);
        // Recordable: two payments, each carrying its own group.
        const payments = paymentsForUser(groups, ME);
        expect(payments).toHaveLength(2);
        expect(payments.map((p) => p.groupId).sort()).toEqual([1, 2]);
    });

    it('marks direction without losing the magnitude', () => {
        const payments = paymentsForUser(
            [group(1, 'Tahoe', [tx(ME, 4, 4215), tx(2, ME, 8420)])],
            ME
        );
        const iPay = payments.find((p) => p.iPay);
        const theyPay = payments.find((p) => !p.iPay);

        expect(iPay).toMatchObject({ userId: 4, amount: 4215 });
        expect(theyPay).toMatchObject({ userId: 2, amount: 8420 });
        // Amounts stay positive; `iPay` carries the sign.
        expect(payments.every((p) => p.amount > 0)).toBe(true);
    });

    it('ignores transactions between two other people', () => {
        expect(
            paymentsForUser([group(1, 'Tahoe', [tx(2, 3, 5000)])], ME)
        ).toEqual([]);
    });

    it('orders by size so the biggest payment leads', () => {
        const payments = paymentsForUser(
            [group(1, 'A', [tx(ME, 2, 100)]), group(2, 'B', [tx(ME, 3, 900)])],
            ME
        );
        expect(payments.map((p) => p.amount)).toEqual([900, 100]);
    });

    it('keys a payment by its pair, so the key survives a reload', () => {
        // After a partial payment the same transaction comes back smaller;
        // after a full one the rows below it move up. Neither may change a
        // surviving row's key, or the screen would hide the wrong row.
        const before = paymentsForUser(
            [group(1, 'Tahoe', [tx(ME, 2, 5000), tx(ME, 3, 900)])],
            ME
        );
        const afterPartial = paymentsForUser(
            [group(1, 'Tahoe', [tx(ME, 2, 1000), tx(ME, 3, 900)])],
            ME
        );
        const afterFull = paymentsForUser([group(1, 'Tahoe', [tx(ME, 3, 900)])], ME);

        const keyOf = (list: typeof before, userId: number) =>
            list.find((p) => p.userId === userId)!.key;
        expect(keyOf(afterPartial, 2)).toBe(keyOf(before, 2));
        expect(keyOf(afterFull, 3)).toBe(keyOf(before, 3));
        expect(keyOf(before, 2)).not.toBe(keyOf(before, 3));
    });

    it('keeps a guest and a member with the same id apart in the key', () => {
        expect(paymentKey(1, tx(ME, 2, 100))).not.toBe(
            paymentKey(1, { ...tx(ME, 2, 100), to_is_guest: true })
        );
        // And the same pair in another group is another payment.
        expect(paymentKey(1, tx(ME, 2, 100))).not.toBe(paymentKey(2, tx(ME, 2, 100)));
    });
});
