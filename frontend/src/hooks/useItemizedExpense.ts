import { useState } from 'react';
import type { Participant, ExpenseItem, ItemAssignment } from '../types/expense';
import {
    assignmentIsParticipant,
    itemDetailKeyForAssignment,
} from '../utils/expenseTransformations';

type ItemSplitType = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';
type SplitDetail = { amount?: number; percentage?: number; shares?: number };
type SplitDetails = Record<string, SplitDetail>;

/** The field a split type's details must carry to count as that type. */
const DETAIL_FIELD: Record<Exclude<ItemSplitType, 'EQUAL'>, keyof SplitDetail> = {
    EXACT: 'amount',
    PERCENT: 'percentage',
    SHARES: 'shares',
};

const hasKindCorrectDetail = (
    detail: SplitDetail | undefined,
    splitType: Exclude<ItemSplitType, 'EQUAL'>,
): boolean => detail != null && detail[DETAIL_FIELD[splitType]] != null;

/**
 * Default detail for assignee `index` of `count`, with the remainder folded
 * in so the seeded values always pass the backend's sum validation:
 * percentages total exactly 100 (first assignees get the extra point), and
 * exact amounts total the item price (first assignee absorbs the remainder,
 * mirroring calculateEqualSplit's convention).
 */
const seedDetail = (
    splitType: Exclude<ItemSplitType, 'EQUAL'>,
    index: number,
    count: number,
    priceCents: number,
): SplitDetail => {
    if (splitType === 'SHARES') return { shares: 1 };
    if (splitType === 'PERCENT') {
        const base = Math.floor(100 / count);
        const remainder = 100 - base * count;
        return { percentage: index < remainder ? base + 1 : base };
    }
    const base = Math.floor(priceCents / count);
    return { amount: index === 0 ? priceCents - base * (count - 1) : base };
};

/**
 * Bring an item's split_details back in line with its assignees after the
 * assignee set changed. Stale entries are pruned; without this, a hydrated
 * EXACT/PERCENT item whose assignees changed would send sums the backend
 * rejects with a 400.
 *
 * SHARES has no sum constraint, so existing values survive and newcomers get
 * one share. EXACT and PERCENT must sum to the price / to 100, which stale
 * hand-tuned values cannot once the people change — reseed evenly and let
 * the user re-adjust.
 */
const reconcileSplitDetails = (item: ExpenseItem): ExpenseItem => {
    const splitType = (item.split_type || 'EQUAL') as ItemSplitType;
    if (splitType === 'EQUAL') return item;

    if (item.assignments.length <= 1) {
        // One person "splitting" an item is just that person's item.
        return { ...item, split_type: 'EQUAL', split_details: undefined };
    }

    const keys = item.assignments.map(itemDetailKeyForAssignment);
    const details: SplitDetails = {};

    if (splitType === 'SHARES') {
        keys.forEach((key, index) => {
            const existing = item.split_details?.[key];
            details[key] = hasKindCorrectDetail(existing, splitType)
                ? { ...existing }
                : { ...existing, ...seedDetail(splitType, index, keys.length, item.price) };
        });
    } else {
        const sameAssignees =
            item.split_details &&
            keys.length === Object.keys(item.split_details).length &&
            keys.every((key) => hasKindCorrectDetail(item.split_details?.[key], splitType));
        if (sameAssignees) return item;
        keys.forEach((key, index) => {
            // Reseed the field this type sums over; other-kind fields ride
            // along so a later switch back can recover them.
            details[key] = {
                ...item.split_details?.[key],
                ...seedDetail(splitType, index, keys.length, item.price),
            };
        });
    }

    return { ...item, split_details: details };
};

export const useItemizedExpense = () => {
    const [itemizedItems, setItemizedItems] = useState<ExpenseItem[]>([]);
    const [taxAmount, setTaxAmount] = useState<string>('');
    const [tipAmount, setTipAmount] = useState<string>('');
    const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
    const [showAddItemModal, setShowAddItemModal] = useState(false);

    // Calculate subtotal (before tax/tip) in cents
    const getSubtotalCents = () => {
        return itemizedItems.reduce((sum, item) => sum + item.price, 0);
    };

    // Set tip based on percentage of subtotal (before tax)
    const setTipFromPercentage = (percent: number) => {
        const subtotalCents = getSubtotalCents();
        const tipCents = Math.round(subtotalCents * (percent / 100));
        setTipAmount((tipCents / 100).toFixed(2));
    };

    const openAddItemModal = () => {
        setShowAddItemModal(true);
    };

    const closeAddItemModal = () => {
        setShowAddItemModal(false);
    };

    const addManualItem = (description: string, price: number) => {
        setItemizedItems(prev => [...prev, {
            description,
            price,
            is_tax_tip: false,
            assignments: [],
            split_type: 'EQUAL'
        }]);
    };

    const removeItem = (idx: number) => {
        setItemizedItems(prev => prev.filter((_, i) => i !== idx));
    };

    const toggleItemAssignment = (itemIdx: number, participant: Participant) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = { ...updated[itemIdx] };

            const existingIdx = item.assignments.findIndex(a =>
                assignmentIsParticipant(a, participant)
            );

            if (existingIdx >= 0) {
                item.assignments = item.assignments.filter((_, i) => i !== existingIdx);
            } else {
                // An expense guest is identified by its temp id before the
                // POST creates the guest row, and by the real guest id when
                // editing — never by user_id, which would collide with a
                // real user's id.
                const newAssignment: ItemAssignment = participant.isExpenseGuest
                    ? participant.tempId != null
                        ? { is_guest: false, temp_guest_id: participant.tempId }
                        : {
                            user_id: participant.id,
                            is_guest: false,
                            expense_guest_id: participant.id,
                        }
                    : {
                        user_id: participant.id,
                        is_guest: participant.isGuest
                    };
                item.assignments = [...item.assignments, newAssignment];
            }

            updated[itemIdx] = reconcileSplitDetails(item);
            return updated;
        });
    };

    const updateItemAssignments = (itemIdx: number, assignments: ItemAssignment[]) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            updated[itemIdx] = reconcileSplitDetails({ ...updated[itemIdx], assignments });
            return updated;
        });
    };

    const setItems = (items: ExpenseItem[]) => {
        setItemizedItems(items);
    };

    const changeSplitType = (itemIdx: number, splitType: ItemSplitType) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = updated[itemIdx];

            // Seed split_details for all assignees when switching to
            // non-EQUAL. The field the new type sums over is reused only
            // when every assignee already has a value of that kind — a
            // SHARES entry carries no amount, so reading it under EXACT
            // would be 0 and fail the backend's sum validation, and partial
            // reuse can't sum either. Other-kind fields are merged through
            // untouched, so hand-tuned shares survive a round trip via
            // PERCENT and back.
            let newSplitDetails: SplitDetails | undefined = undefined;
            if (splitType !== 'EQUAL' && item.assignments.length > 0) {
                const keys = item.assignments.map(itemDetailKeyForAssignment);
                const details: SplitDetails = {};
                const allReusable = keys.every((key) =>
                    hasKindCorrectDetail(item.split_details?.[key], splitType)
                );
                keys.forEach((key, index) => {
                    const existing = item.split_details?.[key];
                    const reusable = splitType === 'SHARES'
                        ? hasKindCorrectDetail(existing, splitType)
                        : allReusable;
                    details[key] = reusable
                        ? { ...existing }
                        : { ...existing, ...seedDetail(splitType, index, keys.length, item.price) };
                });
                newSplitDetails = details;
            }

            updated[itemIdx] = {
                ...item,
                split_type: splitType,
                split_details: newSplitDetails
            };
            return updated;
        });
    };

    const updateSplitDetail = (itemIdx: number, participantKey: string, details: SplitDetail) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = { ...updated[itemIdx] };

            // Immutable on purpose: the hydrated item may share nothing with
            // the fetched expense (it is deep-copied), but mutating inside a
            // state updater would still leave the previous render's objects
            // edited in place.
            item.split_details = {
                ...item.split_details,
                [participantKey]: {
                    ...item.split_details?.[participantKey],
                    ...details
                }
            };

            updated[itemIdx] = item;
            return updated;
        });
    };

    return {
        itemizedItems,
        taxAmount,
        tipAmount,
        editingItemIndex,
        showAddItemModal,
        setItemizedItems,
        setTaxAmount,
        setTipAmount,
        setTipFromPercentage,
        getSubtotalCents,
        setEditingItemIndex,
        openAddItemModal,
        closeAddItemModal,
        addManualItem,
        removeItem,
        toggleItemAssignment,
        updateItemAssignments,
        setItems,
        changeSplitType,
        updateSplitDetail
    };
};
