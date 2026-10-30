import React, { useMemo } from 'react';
import { Receipt } from '@phosphor-icons/react';
import PageHeader from './PageHeader';
import ExpenseFeedRow from '../components/ExpenseFeedRow';
import OpenExpenseModal from '../components/OpenExpenseModal';
import { usePageTitle } from '../hooks/usePageTitle';
import { useExpenseFeed } from '../hooks/useExpenseFeed';
import { useExpenseLabels } from '../hooks/useExpenseLabels';
import { useOpenExpense } from '../hooks/useOpenExpense';

/**
 * Every expense you are on that belongs to no group: one split with friends
 * directly, a closed tab's, a direct payment.
 *
 * Reached from the bottom of Groups. Activity has these mixed in with
 * everything else, and a person's page has only the ones with that friend, so
 * a bill whose only other people are guests was otherwise only findable by
 * scrolling Activity.
 */
const GrouplessPage: React.FC = () => {
    usePageTitle('Group-less expenses');
    const { expenses, loading } = useExpenseFeed();
    const { payerName } = useExpenseLabels();
    const openExpense = useOpenExpense();

    const groupless = useMemo(
        () => expenses.filter((expense) => expense.group_id === null),
        [expenses]
    );

    return (
        <>
            <PageHeader
                title="Group-less expenses"
                caption="Split directly, not in a group"
                mobileInset
            />

            <div className="flex-1 overflow-auto px-4 lg:px-[22px] pb-4">
                {loading ? (
                    <p className="text-sm text-sw-dim py-8 text-center">Loading…</p>
                ) : groupless.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
                        <div className="w-16 h-16 rounded-full bg-sw-surface flex items-center justify-center text-sw-dim">
                            <Receipt size={30} />
                        </div>
                        <p className="text-sm text-sw-muted">No group-less expenses</p>
                        <p className="text-[12.5px] text-sw-dim">
                            Expenses split with people directly, outside a group, show up here.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col max-w-3xl">
                        {groupless.map((expense) => (
                            <ExpenseFeedRow
                                key={expense.id}
                                expense={expense}
                                payerName={payerName}
                                onClick={() => openExpense.open(expense)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <OpenExpenseModal openExpense={openExpense} />
        </>
    );
};

export default GrouplessPage;
