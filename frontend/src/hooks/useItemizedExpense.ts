import { useState } from 'react';
import type { Participant, ExpenseItem, ItemAssignment } from '../types/expense';

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

            // For expense guests, match by expense_guest_id
            const existingIdx = item.assignments.findIndex(a => {
                if (participant.isExpenseGuest) {
                    return a.expense_guest_id === participant.id;
                }
                return a.user_id === participant.id && a.is_guest === participant.isGuest;
            });

            if (existingIdx >= 0) {
                item.assignments = item.assignments.filter((_, i) => i !== existingIdx);
            } else {
                const newAssignment: ItemAssignment = participant.isExpenseGuest
                    ? {
                        user_id: participant.id,
                        is_guest: false,
                        expense_guest_id: participant.id
                    }
                    : {
                        user_id: participant.id,
                        is_guest: participant.isGuest
                    };
                item.assignments = [...item.assignments, newAssignment];
            }

            updated[itemIdx] = item;
            return updated;
        });
    };

    const updateItemAssignments = (itemIdx: number, assignments: ItemAssignment[]) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            updated[itemIdx] = { ...updated[itemIdx], assignments };
            return updated;
        });
    };

    const setItems = (items: ExpenseItem[]) => {
        setItemizedItems(items);
    };

    const changeSplitType = (itemIdx: number, splitType: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES') => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = updated[itemIdx];

            // Initialize split_details with defaults for all assignees when switching to non-EQUAL
            let newSplitDetails: Record<string, { amount?: number; percentage?: number; shares?: number }> | undefined = undefined;
            if (splitType !== 'EQUAL' && item.assignments) {
                const details: Record<string, { amount?: number; percentage?: number; shares?: number }> = {};
                item.assignments.forEach(assignment => {
                    const key = assignment.is_guest ? `guest_${assignment.user_id}` : `user_${assignment.user_id}`;
                    // Use existing value if present, otherwise set defaults
                    if (item.split_details && item.split_details[key]) {
                        details[key] = item.split_details[key];
                    } else {
                        // Set default values based on split type
                        if (splitType === 'SHARES') {
                            details[key] = { shares: 1 };
                        } else if (splitType === 'PERCENT') {
                            const equalPercent = Math.floor(100 / item.assignments.length);
                            details[key] = { percentage: equalPercent };
                        } else if (splitType === 'EXACT') {
                            const equalAmount = Math.floor(item.price / item.assignments.length);
                            details[key] = { amount: equalAmount };
                        }
                    }
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

    const updateSplitDetail = (itemIdx: number, participantKey: string, details: { amount?: number; percentage?: number; shares?: number }) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = { ...updated[itemIdx] };

            if (!item.split_details) {
                item.split_details = {};
            }

            item.split_details[participantKey] = {
                ...item.split_details[participantKey],
                ...details
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
