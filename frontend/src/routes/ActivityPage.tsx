import React from 'react';
import { CaretRight, Receipt } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import PageHeader from './PageHeader';
import ExpenseFeedRow from '../components/ExpenseFeedRow';
import ExpenseDetailModal from '../ExpenseDetailModal';
import TabList from '../components/tab/TabList';
import { useAuth } from '../AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAppData } from '../contexts/AppDataContext';
import { useExpenseFeed } from '../hooks/useExpenseFeed';
import { useExpenseLabels } from '../hooks/useExpenseLabels';
import { useOpenExpense } from '../hooks/useOpenExpense';
import { useTabs } from '../hooks/useTabs';

/**
 * Everything that has happened, newest first — the "Lately" feed at full
 * length.
 */
const ActivityPage: React.FC = () => {
    usePageTitle('Activity');
    const { user } = useAuth();
    const { refreshAll, friends } = useAppData();
    const { expenses, loading } = useExpenseFeed();
    const { payerName, groupName } = useExpenseLabels();
    const openExpense = useOpenExpense();

    // Tabs live here rather than under Groups — a tab is not a group.
    const { openTabs, closedTabs } = useTabs();

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
                            <TabList tabs={openTabs} />
                        </div>
                    </div>
                )}

                {/*
                  * A closed tab's expense is already in the feed below, but a
                  * tab settled outside the app, or whose expense was deleted,
                  * has nothing else to show for it.
                  */}
                {closedTabs.length > 0 && (
                    <div className="max-w-3xl pt-3 pb-1">
                        <Link
                            to="/tabs"
                            className="flex items-center gap-2 text-[12.5px] text-sw-muted hover:text-sw-text mb-3"
                        >
                            Past tabs
                            <span className="text-sw-dim">{closedTabs.length}</span>
                            <CaretRight size={14} className="text-sw-dim" />
                        </Link>
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
                    friends={friends}
                    currentUserId={user?.id ?? 0}
                />
            )}
        </>
    );
};

export default ActivityPage;
