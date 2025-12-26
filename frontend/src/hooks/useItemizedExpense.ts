import { useState } from 'react';
import type { Participant, ExpenseItem, ItemAssignment } from '../types/expense';

export const useItemizedExpense = () => {
    const [itemizedItems, setItemizedItems] = useState<ExpenseItem[]>([]);
    const [taxTipAmount, setTaxTipAmount] = useState<string>('');
    const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);

    const addManualItem = () => {
        const description = prompt("Item description:");
        if (!description) return;

        const priceStr = prompt("Price (in dollars, e.g., 12.99):");
        if (!priceStr) return;

        const price = Math.round(parseFloat(priceStr) * 100);
        if (isNaN(price) || price <= 0) {
            alert("Invalid price");
            return;
        }

        setItemizedItems(prev => [...prev, {
            description,
            price,
            is_tax_tip: false,
            assignments: []
        }]);
    };

    const removeItem = (idx: number) => {
        setItemizedItems(prev => prev.filter((_, i) => i !== idx));
    };

    const toggleItemAssignment = (itemIdx: number, participant: Participant) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = { ...updated[itemIdx] };

            const existingIdx = item.assignments.findIndex(
                a => a.user_id === participant.id && a.is_guest === participant.isGuest
            );

            if (existingIdx >= 0) {
                item.assignments = item.assignments.filter((_, i) => i !== existingIdx);
            } else {
                item.assignments = [...item.assignments, {
                    user_id: participant.id,
                    is_guest: participant.isGuest
                }];
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

    return {
        itemizedItems,
        taxTipAmount,
        editingItemIndex,
        setItemizedItems,
        setTaxTipAmount,
        setEditingItemIndex,
        addManualItem,
        removeItem,
        toggleItemAssignment,
        updateItemAssignments,
        setItems
    };
};
