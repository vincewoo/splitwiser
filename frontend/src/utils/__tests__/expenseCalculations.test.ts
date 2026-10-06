// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { Participant, ExpenseItem, ExpenseItemDetail } from '../../types/expense';
import {
    calculateEqualSplit,
    calculateExactSplit,
    calculatePercentSplit,
    calculateSharesSplit,
    calculateItemizedTotal,
    calculatePersonItemBreakdown,
    parseSplitValue,
} from '../expenseCalculations';

const user1: Participant = { id: 1, name: 'Alice', isGuest: false };
const user2: Participant = { id: 2, name: 'Bob', isGuest: false };
const user3: Participant = { id: 3, name: 'Charlie', isGuest: false };
const guest1: Participant = { id: 10, name: 'Guest', isGuest: true };

describe('calculateEqualSplit', () => {
    it('divides evenly among two participants', () => {
        const result = calculateEqualSplit(1000, [user1, user2]);
        expect(result).toEqual([
            { user_id: 1, is_guest: false, amount_owed: 500 },
            { user_id: 2, is_guest: false, amount_owed: 500 },
        ]);
    });

    it('assigns remainder to first participant for uneven division', () => {
        const result = calculateEqualSplit(1000, [user1, user2, user3]);
        // 1000 / 3 = 333 each, remainder 1 goes to first
        expect(result[0].amount_owed).toBe(334);
        expect(result[1].amount_owed).toBe(333);
        expect(result[2].amount_owed).toBe(333);
        expect(result.reduce((sum, s) => sum + s.amount_owed, 0)).toBe(1000);
    });

    it('gives full amount to a single participant', () => {
        const result = calculateEqualSplit(1000, [user1]);
        expect(result).toHaveLength(1);
        expect(result[0].amount_owed).toBe(1000);
    });

    it('preserves isGuest flag for guest participants', () => {
        const result = calculateEqualSplit(1000, [user1, guest1]);
        expect(result[0].is_guest).toBe(false);
        expect(result[1].is_guest).toBe(true);
        expect(result[0].amount_owed).toBe(500);
        expect(result[1].amount_owed).toBe(500);
    });
});

describe('calculateExactSplit', () => {
    it('returns no error when amounts sum to total', () => {
        const splitDetails = { user_1: 6, user_2: 4 }; // dollars
        const result = calculateExactSplit(1000, [user1, user2], splitDetails);
        expect(result.error).toBeUndefined();
        expect(result.splits[0].amount_owed).toBe(600);
        expect(result.splits[1].amount_owed).toBe(400);
    });

    it('returns error when amounts do not sum to total', () => {
        const splitDetails = { user_1: 3, user_2: 4 };
        const result = calculateExactSplit(1000, [user1, user2], splitDetails);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('do not sum to total');
    });

    it('tolerates a 1-cent discrepancy', () => {
        // Total is 999 cents. Split details: 5.00 + 4.99 = 9.99 = 999 cents.
        // But let's test the tolerance edge: total 1000, sum 999 => diff = 1, within tolerance
        const splitDetails = { user_1: 5, user_2: 4.99 };
        const result = calculateExactSplit(1000, [user1, user2], splitDetails);
        // 500 + 499 = 999, diff from 1000 is 1, which is <= 1
        expect(result.error).toBeUndefined();
    });

    it('defaults missing splitDetails keys to 0', () => {
        const splitDetails = { user_1: 7 }; // user_2 missing, defaults to 0
        const result = calculateExactSplit(1000, [user1, user2], splitDetails);
        expect(result.splits[1].amount_owed).toBe(0);
        // 700 != 1000, so error expected
        expect(result.error).toBeDefined();
    });

    it('handles missing key defaulting to 0 with correct total', () => {
        const splitDetails = { user_1: 10 }; // 10 dollars = 1000 cents, user_2 defaults to 0
        const result = calculateExactSplit(1000, [user1, user2], splitDetails);
        expect(result.splits[0].amount_owed).toBe(1000);
        expect(result.splits[1].amount_owed).toBe(0);
        // sum = 1000, total = 1000 => no error
        expect(result.error).toBeUndefined();
    });
});

describe('calculatePercentSplit', () => {
    it('splits 50/50 correctly', () => {
        const splitDetails = { user_1: 50, user_2: 50 };
        const result = calculatePercentSplit(1000, [user1, user2], splitDetails);
        expect(result.error).toBeUndefined();
        expect(result.splits[0].amount_owed).toBe(500);
        expect(result.splits[1].amount_owed).toBe(500);
    });

    it('returns error when percentages do not sum to 100', () => {
        const splitDetails = { user_1: 40, user_2: 40 };
        const result = calculatePercentSplit(1000, [user1, user2], splitDetails);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('100%');
    });

    it('gives remainder to last participant when rounding causes discrepancy', () => {
        // 33.33 + 33.33 + 33.34 = 100
        const splitDetails = { user_1: 33.33, user_2: 33.33, user_3: 33.34 };
        const result = calculatePercentSplit(1000, [user1, user2, user3], splitDetails);
        expect(result.error).toBeUndefined();
        const total = result.splits.reduce((sum, s) => sum + s.amount_owed, 0);
        expect(total).toBe(1000);
        // Last participant gets the remainder
        expect(result.splits[2].amount_owed).toBe(1000 - result.splits[0].amount_owed - result.splits[1].amount_owed);
    });
});

describe('calculateSharesSplit', () => {
    it('splits equal shares (1:1)', () => {
        const splitDetails = { user_1: 1, user_2: 1 };
        const result = calculateSharesSplit(1000, [user1, user2], splitDetails);
        expect(result.error).toBeUndefined();
        expect(result.splits[0].amount_owed).toBe(500);
        expect(result.splits[1].amount_owed).toBe(500);
    });

    it('splits unequal shares (2:1)', () => {
        const splitDetails = { user_1: 2, user_2: 1 };
        const result = calculateSharesSplit(900, [user1, user2], splitDetails);
        expect(result.error).toBeUndefined();
        expect(result.splits[0].amount_owed).toBe(600);
        expect(result.splits[1].amount_owed).toBe(300);
    });

    it('returns error when total shares is zero', () => {
        const splitDetails = { user_1: 0, user_2: 0 };
        const result = calculateSharesSplit(1000, [user1, user2], splitDetails);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('zero');
    });

    it('gives remainder to last participant when rounding causes discrepancy', () => {
        // 1000 cents split 1:1:1 = 333 + 333 + remainder(334)
        const splitDetails = { user_1: 1, user_2: 1, user_3: 1 };
        const result = calculateSharesSplit(1000, [user1, user2, user3], splitDetails);
        expect(result.error).toBeUndefined();
        const total = result.splits.reduce((sum, s) => sum + s.amount_owed, 0);
        expect(total).toBe(1000);
        // Last participant gets remainder
        expect(result.splits[2].amount_owed).toBe(1000 - result.splits[0].amount_owed - result.splits[1].amount_owed);
    });
});

describe('calculateItemizedTotal', () => {
    it('sums items plus tax and tip', () => {
        const items: ExpenseItem[] = [
            { description: 'Burger', price: 1200, is_tax_tip: false, assignments: [] },
            { description: 'Fries', price: 500, is_tax_tip: false, assignments: [] },
        ];
        // tax = $2.00, tip = $3.00
        const result = calculateItemizedTotal(items, '2.00', '3.00');
        // items: 1700 cents, tax: 200 cents, tip: 300 cents = 2200 cents = $22.00
        expect(result).toBe('22.00');
    });

    it('treats empty tax/tip strings as 0', () => {
        const items: ExpenseItem[] = [
            { description: 'Coffee', price: 450, is_tax_tip: false, assignments: [] },
        ];
        const result = calculateItemizedTotal(items, '', '');
        expect(result).toBe('4.50');
    });

    it('handles zero items with tax/tip only', () => {
        const items: ExpenseItem[] = [];
        const result = calculateItemizedTotal(items, '1.50', '2.50');
        // 0 + 150 + 250 = 400 cents = $4.00
        expect(result).toBe('4.00');
    });
});

describe('calculatePersonItemBreakdown', () => {
    // Helper to build a minimal ExpenseItemDetail.
    let nextId = 1;
    const makeItem = (
        description: string,
        price: number,
        assignments: Array<{ user_id: number; is_guest: boolean; user_name?: string }>,
        opts: {
            is_tax_tip?: boolean;
            split_type?: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';
            split_details?: { [key: string]: { amount?: number; percentage?: number; shares?: number } };
        } = {}
    ): ExpenseItemDetail => ({
        id: nextId++,
        expense_id: 100,
        description,
        price,
        is_tax_tip: opts.is_tax_tip ?? false,
        assignments: assignments.map(a => ({
            user_id: a.user_id,
            is_guest: a.is_guest,
            user_name: a.user_name ?? `User ${a.user_id}`,
        })),
        ...(opts.split_type ? { split_type: opts.split_type } : {}),
        ...(opts.split_details ? { split_details: opts.split_details } : {}),
    });

    const alice = { user_id: 1, is_guest: false };
    const bob = { user_id: 2, is_guest: false };

    it('gives a single assignee the full item price as their share', () => {
        const items = [makeItem('Pizza', 1000, [alice])];
        const result = calculatePersonItemBreakdown(alice, items);
        expect(result.items).toEqual([
            { description: 'Pizza', shareAmount: 1000, percent: 100, isShared: false, sharedWith: 0 },
        ]);
        expect(result.subtotal).toBe(1000);
        expect(result.tax).toBe(0);
        expect(result.tip).toBe(0);
        // Single assignee => 100%, not shared.
        expect(result.items[0].percent).toBe(100);
        expect(result.items[0].isShared).toBe(false);
        // Solo assignee => no other assignees.
        expect(result.items[0].sharedWith).toBe(0);
    });

    it('splits one item EQUALLY between two people (floor)', () => {
        const items = [makeItem('Pizza', 1000, [alice, bob])];
        // floor(1000 / 2) = 500 for each
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);
        expect(aliceResult.items).toEqual([
            { description: 'Pizza', shareAmount: 500, percent: 50, isShared: true, sharedWith: 1 },
        ]);
        expect(aliceResult.subtotal).toBe(500);
        expect(bobResult.items).toEqual([
            { description: 'Pizza', shareAmount: 500, percent: 50, isShared: true, sharedWith: 1 },
        ]);
        expect(bobResult.subtotal).toBe(500);
        // EQUAL 2-way => 50% each, shared.
        expect(aliceResult.items[0].percent).toBe(50);
        expect(aliceResult.items[0].isShared).toBe(true);
        expect(bobResult.items[0].percent).toBe(50);
        expect(bobResult.items[0].isShared).toBe(true);
        // 2-way split => 1 other assignee each.
        expect(aliceResult.items[0].sharedWith).toBe(1);
        expect(bobResult.items[0].sharedWith).toBe(1);
    });

    it('splits one item EQUALLY among three people with a fractional percent', () => {
        const items = [makeItem('Pizza', 999, [alice, bob, { user_id: 3, is_guest: false }])];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        // EQUAL 3-way => 100/3 % each, shared.
        expect(aliceResult.items[0].percent).toBeCloseTo(100 / 3, 5);
        expect(aliceResult.items[0].isShared).toBe(true);
        // 3-way split => 2 other assignees.
        expect(aliceResult.items[0].sharedWith).toBe(2);
    });

    it('uses split_details.amount for an EXACT per-item split', () => {
        const items = [
            makeItem('Shared Platter', 1000, [alice, bob], {
                split_type: 'EXACT',
                split_details: { user_1: { amount: 700 }, user_2: { amount: 300 } },
            }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);
        expect(aliceResult.items).toEqual([
            { description: 'Shared Platter', shareAmount: 700, percent: 70, isShared: true, sharedWith: 1 },
        ]);
        expect(aliceResult.subtotal).toBe(700);
        expect(bobResult.items).toEqual([
            { description: 'Shared Platter', shareAmount: 300, percent: 30, isShared: true, sharedWith: 1 },
        ]);
        expect(bobResult.subtotal).toBe(300);
        // EXACT => personAmount / price * 100.
        expect(aliceResult.items[0].percent).toBe((700 / 1000) * 100);
        expect(bobResult.items[0].percent).toBe((300 / 1000) * 100);
        expect(aliceResult.items[0].isShared).toBe(true);
    });

    it('uses floor(price * pct/100) for a PERCENT per-item split', () => {
        const items = [
            makeItem('Combo', 1000, [alice, bob], {
                split_type: 'PERCENT',
                split_details: { user_1: { percentage: 33 }, user_2: { percentage: 67 } },
            }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);
        // floor(1000 * 33/100) = 330, floor(1000 * 67/100) = 670
        expect(aliceResult.items).toEqual([
            { description: 'Combo', shareAmount: 330, percent: 33, isShared: true, sharedWith: 1 },
        ]);
        expect(bobResult.items).toEqual([
            { description: 'Combo', shareAmount: 670, percent: 67, isShared: true, sharedWith: 1 },
        ]);
        // PERCENT => the configured percentage.
        expect(aliceResult.items[0].percent).toBe(33);
        expect(bobResult.items[0].percent).toBe(67);
        expect(aliceResult.items[0].isShared).toBe(true);
    });

    it('uses floor(price * personShares / totalShares) for a SHARES per-item split', () => {
        const items = [
            makeItem('Bottle', 1000, [alice, bob], {
                split_type: 'SHARES',
                split_details: { user_1: { shares: 2 }, user_2: { shares: 1 } },
            }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);
        // totalShares = 3. Alice: floor(1000 * 2/3) = 666, Bob: floor(1000 * 1/3) = 333
        expect(aliceResult.items).toEqual([
            { description: 'Bottle', shareAmount: 666, percent: (2 / 3) * 100, isShared: true, sharedWith: 1 },
        ]);
        expect(bobResult.items).toEqual([
            { description: 'Bottle', shareAmount: 333, percent: (1 / 3) * 100, isShared: true, sharedWith: 1 },
        ]);
        // SHARES => personShares / totalShares * 100.
        expect(aliceResult.items[0].percent).toBe((2 / 3) * 100);
        expect(bobResult.items[0].percent).toBe((1 / 3) * 100);
        expect(aliceResult.items[0].isShared).toBe(true);
    });

    it('returns empty items and zero subtotal when person is assigned nothing', () => {
        const items = [makeItem('Pizza', 1000, [alice])];
        const result = calculatePersonItemBreakdown(bob, items);
        expect(result.items).toEqual([]);
        expect(result.subtotal).toBe(0);
        expect(result.tax).toBe(0);
        expect(result.tip).toBe(0);
        expect(result.sharePercent).toBe(0);
    });

    it('excludes tax/tip items from items but distributes them proportionally', () => {
        // Regular items: Alice $3.00, Bob $1.00 => totalSubtotal 400.
        // Tax $0.50 (50), Tip $0.80 (80).
        const items = [
            makeItem('Steak', 300, [alice]),
            makeItem('Salad', 100, [bob]),
            makeItem('Tax', 50, [], { is_tax_tip: true }),
            makeItem('Tip', 80, [], { is_tax_tip: true }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);

        // Item list excludes tax/tip.
        expect(aliceResult.items).toEqual([
            { description: 'Steak', shareAmount: 300, percent: 100, isShared: false, sharedWith: 0 },
        ]);
        expect(bobResult.items).toEqual([
            { description: 'Salad', shareAmount: 100, percent: 100, isShared: false, sharedWith: 0 },
        ]);

        // Tax: round(50 * 300/400) = round(37.5) = 38; round(50 * 100/400) = round(12.5) = 13
        expect(aliceResult.tax).toBe(38);
        expect(bobResult.tax).toBe(13);
        // Tip: round(80 * 300/400) = round(60) = 60; round(80 * 100/400) = round(20) = 20
        expect(aliceResult.tip).toBe(60);
        expect(bobResult.tip).toBe(20);
        // sharePercent: 300/400 = 75%, 100/400 = 25%
        expect(aliceResult.sharePercent).toBe(75);
        expect(bobResult.sharePercent).toBe(25);
    });

    it('distinguishes a group guest from a registered user with the same numeric id', () => {
        const registered = { user_id: 1, is_guest: false };
        const guest = { user_id: 1, is_guest: true };
        const items = [
            makeItem('Item A', 500, [{ user_id: 1, is_guest: false }]),
            makeItem('Item B', 700, [{ user_id: 1, is_guest: true }]),
        ];
        const registeredResult = calculatePersonItemBreakdown(registered, items);
        const guestResult = calculatePersonItemBreakdown(guest, items);

        expect(registeredResult.items).toEqual([
            { description: 'Item A', shareAmount: 500, percent: 100, isShared: false, sharedWith: 0 },
        ]);
        expect(registeredResult.subtotal).toBe(500);
        expect(guestResult.items).toEqual([
            { description: 'Item B', shareAmount: 700, percent: 100, isShared: false, sharedWith: 0 },
        ]);
        expect(guestResult.subtotal).toBe(700);
    });

    it('treats a combined "tax/tip" line as tax, distributed proportionally', () => {
        // Regular items: Alice $3.00, Bob $1.00 => totalSubtotal 400.
        // Combined tax/tip line of $1.00 (100).
        const items = [
            makeItem('Steak', 300, [alice]),
            makeItem('Salad', 100, [bob]),
            makeItem('tax/tip', 100, [], { is_tax_tip: true }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);

        // Combined line is excluded from the item list.
        expect(aliceResult.items).toEqual([
            { description: 'Steak', shareAmount: 300, percent: 100, isShared: false, sharedWith: 0 },
        ]);
        expect(bobResult.items).toEqual([
            { description: 'Salad', shareAmount: 100, percent: 100, isShared: false, sharedWith: 0 },
        ]);

        // Combined "tax/tip" contributes to tax: round(100 * 300/400) = 75; round(100 * 100/400) = 25.
        expect(aliceResult.tax).toBe(Math.round(100 * (300 / 400)));
        expect(bobResult.tax).toBe(Math.round(100 * (100 / 400)));
        // It is NOT counted as tip.
        expect(aliceResult.tip).toBe(0);
        expect(bobResult.tip).toBe(0);
    });

    it('accumulates subtotal across multiple items assigned to one person', () => {
        const items = [
            makeItem('Appetizer', 500, [alice]),
            makeItem('Entree', 1200, [alice]),
            makeItem('Dessert', 300, [bob]),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);

        // Two regular items for Alice, preserving order.
        expect(aliceResult.items).toHaveLength(2);
        expect(aliceResult.items.map(i => i.description)).toEqual(['Appetizer', 'Entree']);
        // subtotal equals the sum of her per-item shareAmounts.
        expect(aliceResult.subtotal).toBe(
            aliceResult.items.reduce((sum, i) => sum + i.shareAmount, 0)
        );
        expect(aliceResult.subtotal).toBe(1700);
    });

    it('defaults a missing EXACT split_details entry to amount 0', () => {
        // Only Alice has a detail; Bob's amount defaults to 0.
        const items = [
            makeItem('Shared Plate', 1000, [alice, bob], {
                split_type: 'EXACT',
                split_details: { user_1: { amount: 700 } },
            }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);

        expect(aliceResult.items[0].shareAmount).toBe(700);
        expect(bobResult.items[0].shareAmount).toBe(0);
        expect(bobResult.items[0].percent).toBe(0);
    });

    it('defaults a missing SHARES split_details entry to 1 share (counted in total)', () => {
        // Alice has 2 shares; Bob has no detail => defaults to 1. totalShares = 3.
        const items = [
            makeItem('Bottle', 1000, [alice, bob], {
                split_type: 'SHARES',
                split_details: { user_1: { shares: 2 } },
            }),
        ];
        const aliceResult = calculatePersonItemBreakdown(alice, items);
        const bobResult = calculatePersonItemBreakdown(bob, items);

        // floor(1000 * 2/3) = 666, floor(1000 * 1/3) = 333.
        expect(aliceResult.items[0].shareAmount).toBe(666);
        expect(bobResult.items[0].shareAmount).toBe(333);
        expect(aliceResult.items[0].percent).toBe((2 / 3) * 100);
        expect(bobResult.items[0].percent).toBe((1 / 3) * 100);
    });

    it('guards against zero totalSubtotal (only tax/tip or zero-priced items)', () => {
        const items = [
            makeItem('Free Sample', 0, [alice]),
            makeItem('Tax', 50, [], { is_tax_tip: true }),
            makeItem('Tip', 80, [], { is_tax_tip: true }),
        ];
        const result = calculatePersonItemBreakdown(alice, items);

        expect(result.subtotal).toBe(0);
        expect(result.tax).toBe(0);
        expect(result.tip).toBe(0);
        expect(result.sharePercent).toBe(0);
        // No NaN values anywhere.
        expect(Number.isNaN(result.subtotal)).toBe(false);
        expect(Number.isNaN(result.tax)).toBe(false);
        expect(Number.isNaN(result.tip)).toBe(false);
        expect(Number.isNaN(result.sharePercent)).toBe(false);
        result.items.forEach(i => {
            expect(Number.isNaN(i.shareAmount)).toBe(false);
            expect(Number.isNaN(i.percent)).toBe(false);
        });
    });
});

/*
 * The split-details field holds raw text — the input is type="text" so a
 * decimal can be typed a character at a time. Everything unparseable that can
 * reach these functions has to land on 0, because a NaN here rides into
 * `amount_owed` and serialises as `null` in the request body.
 */
describe('parseSplitValue', () => {
    it('reads a plain number', () => {
        expect(parseSplitValue('12.50')).toBe(12.5);
        expect(parseSplitValue('0.5')).toBe(0.5);
    });

    it('accepts a number as well as a string', () => {
        expect(parseSplitValue(42)).toBe(42);
    });

    it('reads the leading number of a half-typed decimal', () => {
        expect(parseSplitValue('12.')).toBe(12);
        expect(parseSplitValue('.5')).toBe(0.5);
    });

    it('treats an empty or missing field as zero', () => {
        expect(parseSplitValue('')).toBe(0);
        expect(parseSplitValue('   ')).toBe(0);
        expect(parseSplitValue(undefined)).toBe(0);
    });

    it('treats unparseable text as zero rather than NaN', () => {
        expect(parseSplitValue('abc')).toBe(0);
        expect(parseSplitValue('-')).toBe(0);
    });
});

describe('non-numeric text never reaches an amount', () => {
    // Regression: the field stopped coercing on keystroke, so 'abc' now
    // arrives here verbatim. Every amount must still be a real number.
    const participants = [user1, user2];
    const finite = (splits: { amount_owed: number }[]) =>
        splits.every((s) => Number.isFinite(s.amount_owed));

    it('exact split', () => {
        const { splits } = calculateExactSplit(10000, participants, {
            user_1: 'abc',
            user_2: '100',
        });
        expect(finite(splits)).toBe(true);
        expect(splits[0].amount_owed).toBe(0);
    });

    it('percent split', () => {
        const { splits } = calculatePercentSplit(10000, participants, {
            user_1: 'abc',
            user_2: '100',
        });
        expect(finite(splits)).toBe(true);
    });

    it('shares split — one bad entry must not poison the others', () => {
        const { splits } = calculateSharesSplit(10000, participants, {
            user_1: 'abc',
            user_2: '2',
        });
        expect(finite(splits)).toBe(true);
        // All the shares belong to the only participant who entered one.
        expect(splits[1].amount_owed).toBe(10000);
    });
});

describe('calculatePersonItemBreakdown — expense guests', () => {
    // Expense guest #1's id deliberately collides with user #1's id: the
    // hydrated guest assignment carries user_id = 1 too, so only the
    // expense_guest_id may be used to tell them apart.
    const sharedItem: ExpenseItemDetail = {
        id: 1,
        expense_id: 100,
        description: 'Pasta',
        price: 1000,
        is_tax_tip: false,
        assignments: [
            { user_id: 1, is_guest: false, user_name: 'User One' },
            { user_id: 1, is_guest: false, expense_guest_id: 1, user_name: 'Walk-in' },
        ],
        split_type: 'SHARES',
        split_details: {
            user_1: { shares: 1 },
            expense_guest_1: { shares: 3 },
        },
    };

    it('attributes an expense guest their SHARES entry by guest key', () => {
        const guest = calculatePersonItemBreakdown(
            { user_id: 1, is_guest: false, expense_guest_id: 1 },
            [sharedItem]
        );
        expect(guest.items[0].shareAmount).toBe(750);
    });

    it('does not hand the colliding real user the guest entry', () => {
        const user = calculatePersonItemBreakdown({ user_id: 1, is_guest: false }, [sharedItem]);
        expect(user.items[0].shareAmount).toBe(250);
    });

    it('excludes an unassigned user even when a guest assignment carries their user_id', () => {
        const guestOnlyItem: ExpenseItemDetail = {
            ...sharedItem,
            id: 2,
            assignments: [
                { user_id: 1, is_guest: false, expense_guest_id: 1, user_name: 'Walk-in' },
            ],
        };
        const user = calculatePersonItemBreakdown({ user_id: 1, is_guest: false }, [guestOnlyItem]);
        expect(user.items).toHaveLength(0);
    });
});
