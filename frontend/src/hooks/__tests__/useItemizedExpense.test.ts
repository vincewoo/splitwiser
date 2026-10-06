import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useItemizedExpense } from '../useItemizedExpense';
import type { Participant } from '../../types/expense';

const alice: Participant = { id: 1, name: 'Alice', isGuest: false };
const bob: Participant = { id: 2, name: 'Bob', isGuest: false };
const groupGuest: Participant = { id: 10, name: 'GroupGuest', isGuest: true };
const expenseGuest: Participant = { id: 5, name: 'ExpGuest', isGuest: false, isExpenseGuest: true };

describe('useItemizedExpense', () => {
    it('initial state — empty items, empty tax/tip', () => {
        const { result } = renderHook(() => useItemizedExpense());
        expect(result.current.itemizedItems).toEqual([]);
        expect(result.current.taxAmount).toBe('');
        expect(result.current.tipAmount).toBe('');
    });

    it('addManualItem — adds item with correct defaults', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Burger', 1500);
        });

        expect(result.current.itemizedItems).toHaveLength(1);
        const item = result.current.itemizedItems[0];
        expect(item.description).toBe('Burger');
        expect(item.price).toBe(1500);
        expect(item.is_tax_tip).toBe(false);
        expect(item.assignments).toEqual([]);
        expect(item.split_type).toBe('EQUAL');
    });

    it('removeItem — removes by index, preserves others', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('A', 100);
            result.current.addManualItem('B', 200);
            result.current.addManualItem('C', 300);
        });

        act(() => {
            result.current.removeItem(1);
        });

        expect(result.current.itemizedItems).toHaveLength(2);
        expect(result.current.itemizedItems[0].description).toBe('A');
        expect(result.current.itemizedItems[1].description).toBe('C');
    });

    it('toggleItemAssignment — adds participant to item', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Burger', 1500);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
        });

        const assignments = result.current.itemizedItems[0].assignments;
        expect(assignments).toHaveLength(1);
        expect(assignments[0].user_id).toBe(1);
        expect(assignments[0].is_guest).toBe(false);
    });

    it('toggleItemAssignment — removes existing participant', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Burger', 1500);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
        });

        expect(result.current.itemizedItems[0].assignments).toHaveLength(0);
    });

    it('toggleItemAssignment — expense guest uses expense_guest_id matching', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Salad', 800);
        });

        act(() => {
            result.current.toggleItemAssignment(0, expenseGuest);
        });

        const assignments = result.current.itemizedItems[0].assignments;
        expect(assignments).toHaveLength(1);
        expect(assignments[0].expense_guest_id).toBe(5);
        expect(assignments[0].user_id).toBe(5);
        expect(assignments[0].is_guest).toBe(false);

        // Toggle again to remove
        act(() => {
            result.current.toggleItemAssignment(0, expenseGuest);
        });

        expect(result.current.itemizedItems[0].assignments).toHaveLength(0);
    });

    it('toggleItemAssignment — regular guest uses user_id + is_guest matching', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Soup', 600);
        });

        act(() => {
            result.current.toggleItemAssignment(0, groupGuest);
        });

        const assignments = result.current.itemizedItems[0].assignments;
        expect(assignments).toHaveLength(1);
        expect(assignments[0].user_id).toBe(10);
        expect(assignments[0].is_guest).toBe(true);
    });

    it('changeSplitType — EQUAL to SHARES initializes shares: 1', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Pizza', 2000);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
            result.current.toggleItemAssignment(0, bob);
        });

        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });

        const item = result.current.itemizedItems[0];
        expect(item.split_type).toBe('SHARES');
        expect(item.split_details).toBeDefined();
        expect(item.split_details!['user_1']).toEqual({ shares: 1 });
        expect(item.split_details!['user_2']).toEqual({ shares: 1 });
    });

    it('changeSplitType — EQUAL to PERCENT initializes equal percentages', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Pizza', 2000);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
            result.current.toggleItemAssignment(0, bob);
        });

        act(() => {
            result.current.changeSplitType(0, 'PERCENT');
        });

        const item = result.current.itemizedItems[0];
        expect(item.split_type).toBe('PERCENT');
        expect(item.split_details!['user_1']).toEqual({ percentage: 50 });
        expect(item.split_details!['user_2']).toEqual({ percentage: 50 });
    });

    it('changeSplitType — EQUAL to EXACT initializes equal amounts', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Pizza', 1000);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
            result.current.toggleItemAssignment(0, bob);
        });

        act(() => {
            result.current.changeSplitType(0, 'EXACT');
        });

        const item = result.current.itemizedItems[0];
        expect(item.split_type).toBe('EXACT');
        expect(item.split_details!['user_1']).toEqual({ amount: 500 });
        expect(item.split_details!['user_2']).toEqual({ amount: 500 });
    });

    it('changeSplitType — preserves existing split_details', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Pizza', 2000);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
            result.current.toggleItemAssignment(0, bob);
        });

        // Switch to SHARES and set custom values
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });

        act(() => {
            result.current.updateSplitDetail(0, 'user_1', { shares: 3 });
            result.current.updateSplitDetail(0, 'user_2', { shares: 7 });
        });

        // Switch to PERCENT (split_details for SHARES still stored)
        act(() => {
            result.current.changeSplitType(0, 'PERCENT');
        });

        // Switch back to SHARES — existing shares values should be preserved
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });

        const item = result.current.itemizedItems[0];
        expect(item.split_details!['user_1'].shares).toBe(3);
        expect(item.split_details!['user_2'].shares).toBe(7);
    });

    it('updateSplitDetail — updates specific participant detail', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Pizza', 2000);
        });

        act(() => {
            result.current.toggleItemAssignment(0, alice);
            result.current.toggleItemAssignment(0, bob);
        });

        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });

        act(() => {
            result.current.updateSplitDetail(0, 'user_1', { shares: 5 });
        });

        const item = result.current.itemizedItems[0];
        expect(item.split_details!['user_1'].shares).toBe(5);
        // Bob's shares should remain at default
        expect(item.split_details!['user_2'].shares).toBe(1);
    });

    it('setTipFromPercentage — 20% of $50 subtotal = $10.00', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('Item A', 3000);
            result.current.addManualItem('Item B', 2000);
        });

        act(() => {
            result.current.setTipFromPercentage(20);
        });

        expect(result.current.tipAmount).toBe('10.00');
    });

    it('getSubtotalCents — sums item prices', () => {
        const { result } = renderHook(() => useItemizedExpense());

        act(() => {
            result.current.addManualItem('A', 1000);
            result.current.addManualItem('B', 2000);
            result.current.addManualItem('C', 500);
        });

        expect(result.current.getSubtotalCents()).toBe(3500);
    });
});

describe('useItemizedExpense — split detail reconciliation', () => {
    const carol: Participant = { id: 3, name: 'Carol', isGuest: false };
    const freshGuest: Participant = { id: 0, name: 'Fresh', isGuest: false, isExpenseGuest: true, tempId: 'g1' };

    const setupItem = (hook: { current: ReturnType<typeof useItemizedExpense> }) => {
        act(() => {
            hook.current.addManualItem('Platter', 3000);
        });
        act(() => {
            hook.current.toggleItemAssignment(0, alice);
        });
        act(() => {
            hook.current.toggleItemAssignment(0, bob);
        });
        act(() => {
            hook.current.toggleItemAssignment(0, carol);
        });
    };

    it('seeds PERCENT to exactly 100 across three people', () => {
        const { result } = renderHook(() => useItemizedExpense());
        setupItem(result);
        act(() => {
            result.current.changeSplitType(0, 'PERCENT');
        });
        const details = result.current.itemizedItems[0].split_details!;
        const values = Object.values(details).map(d => d.percentage!);
        expect(values.reduce((a, b) => a + b, 0)).toBe(100);
        expect(values.sort()).toEqual([33, 33, 34]);
    });

    it('seeds EXACT to exactly the item price', () => {
        const { result } = renderHook(() => useItemizedExpense());
        setupItem(result);
        act(() => {
            result.current.changeSplitType(0, 'EXACT');
        });
        const details = result.current.itemizedItems[0].split_details!;
        const values = Object.values(details).map(d => d.amount!);
        expect(values.reduce((a, b) => a + b, 0)).toBe(3000);
    });

    it('reseeds PERCENT to a valid sum when an assignee is removed', () => {
        const { result } = renderHook(() => useItemizedExpense());
        setupItem(result);
        act(() => {
            result.current.changeSplitType(0, 'PERCENT');
        });
        act(() => {
            result.current.toggleItemAssignment(0, carol); // remove
        });
        const item = result.current.itemizedItems[0];
        const details = item.split_details!;
        expect(Object.keys(details).sort()).toEqual(['user_1', 'user_2']);
        const total = Object.values(details).reduce((a, d) => a + d.percentage!, 0);
        expect(total).toBe(100);
    });

    it('keeps existing shares and defaults a newcomer to 1', () => {
        const { result: r } = renderHook(() => useItemizedExpense());
        act(() => {
            r.current.addManualItem('Platter', 3000);
        });
        act(() => {
            r.current.toggleItemAssignment(0, alice);
        });
        act(() => {
            r.current.toggleItemAssignment(0, bob);
        });
        act(() => {
            r.current.changeSplitType(0, 'SHARES');
        });
        act(() => {
            r.current.updateSplitDetail(0, 'user_1', { shares: 4 });
        });
        act(() => {
            r.current.toggleItemAssignment(0, carol); // add
        });
        const details = r.current.itemizedItems[0].split_details!;
        expect(details.user_1.shares).toBe(4);
        expect(details.user_3.shares).toBe(1);
    });

    it('prunes a removed assignee from SHARES details', () => {
        const { result } = renderHook(() => useItemizedExpense());
        setupItem(result);
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });
        act(() => {
            result.current.toggleItemAssignment(0, bob); // remove
        });
        const details = result.current.itemizedItems[0].split_details!;
        expect(Object.keys(details).sort()).toEqual(['user_1', 'user_3']);
    });

    it('never reuses a wrong-kind detail when switching split type', () => {
        const { result } = renderHook(() => useItemizedExpense());
        setupItem(result);
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });
        act(() => {
            result.current.updateSplitDetail(0, 'user_1', { shares: 5 });
        });
        act(() => {
            result.current.changeSplitType(0, 'EXACT');
        });
        const details = result.current.itemizedItems[0].split_details!;
        // A {shares: 5} entry must not survive as an EXACT entry with no amount.
        const amounts = Object.values(details).map(d => d.amount!);
        expect(amounts.every(a => typeof a === 'number')).toBe(true);
        expect(amounts.reduce((a, b) => a + b, 0)).toBe(3000);
    });

    it('drops back to EQUAL when only one assignee remains', () => {
        const { result } = renderHook(() => useItemizedExpense());
        act(() => {
            result.current.addManualItem('Platter', 3000);
        });
        act(() => {
            result.current.toggleItemAssignment(0, alice);
        });
        act(() => {
            result.current.toggleItemAssignment(0, bob);
        });
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });
        act(() => {
            result.current.toggleItemAssignment(0, bob); // remove → one left
        });
        const item = result.current.itemizedItems[0];
        expect(item.split_type).toBe('EQUAL');
        expect(item.split_details).toBeUndefined();
    });

    it('keys an unsaved expense guest by temp id end to end', () => {
        const { result } = renderHook(() => useItemizedExpense());
        act(() => {
            result.current.addManualItem('Platter', 3000);
        });
        act(() => {
            result.current.toggleItemAssignment(0, alice);
        });
        act(() => {
            result.current.toggleItemAssignment(0, freshGuest);
        });
        const assignments = result.current.itemizedItems[0].assignments;
        expect(assignments[1]).toEqual({ is_guest: false, temp_guest_id: 'g1' });
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });
        const details = result.current.itemizedItems[0].split_details!;
        expect(Object.keys(details).sort()).toEqual(['expense_guest_g1', 'user_1']);
        // Toggling again removes the guest, not everyone with id 0.
        act(() => {
            result.current.toggleItemAssignment(0, freshGuest);
        });
        expect(result.current.itemizedItems[0].assignments).toHaveLength(1);
    });

    it('updateSplitDetail does not mutate the previous render state', () => {
        const { result } = renderHook(() => useItemizedExpense());
        act(() => {
            result.current.addManualItem('Platter', 3000);
        });
        act(() => {
            result.current.toggleItemAssignment(0, alice);
        });
        act(() => {
            result.current.toggleItemAssignment(0, bob);
        });
        act(() => {
            result.current.changeSplitType(0, 'SHARES');
        });
        const before = result.current.itemizedItems;
        const beforeDetails = before[0].split_details;
        act(() => {
            result.current.updateSplitDetail(0, 'user_1', { shares: 9 });
        });
        expect(beforeDetails!.user_1.shares).toBe(1);
        expect(result.current.itemizedItems[0].split_details!.user_1.shares).toBe(9);
    });
});
