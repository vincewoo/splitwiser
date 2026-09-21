import React from 'react';
import { Receipt } from '@phosphor-icons/react';
import PageHeader from './PageHeader';
import ExpenseFeedRow from '../components/ExpenseFeedRow';
import ExpenseDetailModal from '../ExpenseDetailModal';
import OpenTabsList from '../components/tab/OpenTabsList';
import { useAuth } from '../AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAppData } from '../contexts/AppDataContext';
import { useExpenseFeed } from '../hooks/useExpenseFeed';
import { useExpenseLabels } from '../hooks/useExpenseLabels';
import { useOpenExpense } from '../hooks/useOpenExpense';
import { useOpenTabs } from '../hooks/useOpenTabs';

/**
 * Everything that has happened, newest first — the "Lately" feed at full
 * length.
 */
const ActivityPage: React.FC = () => {
    usePageTitle('Activity');
    const { user } = useAuth();
    const { refreshAll } = useAppData();
    const { expenses, loading } = useExpenseFeed();
    const { payerName, groupName } = useExpenseLabels();
    const openExpense = useOpenExpense();

    // Open tabs live here rather than under Groups — a tab is not a group.
    const { openTabs } = useOpenTabs();

    return (
        <>
            <PageHeader
                title="Activity"
                caption="Every expense you're part of"
                mobileInset
            />

            <div className="flex-1 overflow-auto px-4 lg:px-[22px] pb-4">
                {openTabs.length > 0 && (
                    <div className="max-w-3xl pt-3 pb-1">
                        <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim mb-2">
                            Open tabs
                        </div>
                        <div className="mb-4">
                            <OpenTabsList tabs={openTabs} />
                        </div>
                    </div>
                )}

                {loading ? (
                    <p className="text-sm text-sw-dim py-8 text-center">Loading…</p>
                ) : expenses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
                        <div className="w-16 h-16 rounded-full bg-sw-surface flex items-center justify-center text-sw-dim">
                            <Receipt size={30} />
                        </div>
                        <p className="text-sm text-sw-muted">Nothing yet</p>
                        <p className="text-[12.5px] text-sw-dim">
                            Expenses you add or get added to will show up here.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col max-w-3xl">
                        {expenses.map((expense) => (
                            <ExpenseFeedRow
                                key={expense.id}
                                expense={expense}
                                payerName={payerName}
                                groupName={groupName(expense)}
                                onClick={() => openExpense.open(expense)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {openExpense.expenseId !== null && (
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
                    currentUserId={user?.id ?? 0}
                />
            )}
        </>
    );
};

export default ActivityPage;
