import React from 'react';
import ExpenseDetailModal from '../ExpenseDetailModal';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth } from '../AuthContext';
import type { useOpenExpense } from '../hooks/useOpenExpense';

interface OpenExpenseModalProps {
    openExpense: ReturnType<typeof useOpenExpense>;
}

/**
 * The expense a feed row opened, if any. Pairs with `useOpenExpense`: the page
 * owns the hook so its rows can call `open`, and renders this once — in every
 * layout it returns, which is the part a hand-rolled copy once forgot.
 */
const OpenExpenseModal: React.FC<OpenExpenseModalProps> = ({ openExpense }) => {
    const { friends, refreshAll } = useAppData();
    const { user } = useAuth();

    if (openExpense.expenseId === null) return null;

    return (
        <ExpenseDetailModal
            isOpen
            expenseId={openExpense.expenseId}
            onClose={openExpense.close}
            // Balances and groups move with an edit, not just the feed.
            onExpenseUpdated={refreshAll}
            onExpenseDeleted={() => {
                openExpense.close();
                refreshAll();
            }}
            groupMembers={openExpense.members}
            groupGuests={openExpense.guests}
            friends={friends}
            currentUserId={user?.id ?? 0}
        />
    );
};

export default OpenExpenseModal;
