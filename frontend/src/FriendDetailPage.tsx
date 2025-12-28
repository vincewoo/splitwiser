import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { usePageTitle } from './hooks/usePageTitle';
import { getApiUrl } from './api';
import { friendsApi, groupsApi } from './services/api';
import AddExpenseModal from './AddExpenseModal';
import ExpenseDetailModal from './ExpenseDetailModal';
import SettleUpModal from './SettleUpModal';
import { formatMoney, formatDate } from './utils/formatters';
import type { Friend, FriendBalance, FriendExpenseWithSplits } from './types/friend';
import type { Group } from './types/group';

const FriendDetailPage: React.FC = () => {
    const { friendId } = useParams<{ friendId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [friend, setFriend] = useState<Friend | null>(null);
    const [expenses, setExpenses] = useState<FriendExpenseWithSplits[]>([]);
    const [balances, setBalances] = useState<FriendBalance[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [allFriends, setAllFriends] = useState<Friend[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isSettleUpModalOpen, setIsSettleUpModalOpen] = useState(false);
    const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
    const [isExpenseDetailOpen, setIsExpenseDetailOpen] = useState(false);

    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });
    const [showInUSD, setShowInUSD] = useState(false);
    const [isExpensesExpanded, setIsExpensesExpanded] = useState(false);
    const [filterType, setFilterType] = useState<'all' | 'direct' | 'group'>('all');

    usePageTitle(friend?.full_name || 'Friend');

    const fetchFriendData = async () => {
        if (!friendId) return;

        setIsLoading(true);
        setError(null);

        try {
            const friendIdNum = parseInt(friendId);
            const [friendData, expensesData, balanceData, groupsData, friendsData, ratesRes] = await Promise.all([
                friendsApi.getById(friendIdNum),
                friendsApi.getExpenses(friendIdNum),
                friendsApi.getBalance(friendIdNum),
                groupsApi.getAll(),
                friendsApi.getAll(),
                fetch(getApiUrl('exchange_rates'))
            ]);

            setFriend(friendData);
            setExpenses(expensesData);
            setBalances(balanceData);
            setGroups(groupsData);
            setAllFriends(friendsData);

            if (ratesRes.ok) {
                const rates = await ratesRes.json();
                setExchangeRates(rates);
            }
        } catch (err) {
            console.error('Failed to fetch friend data:', err);
            setError('Failed to load friend data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFriendData();
    }, [friendId]);

    const handleExpenseClick = (expenseId: number) => {
        setSelectedExpenseId(expenseId);
        setIsExpenseDetailOpen(true);
    };

    const getPayerName = (payerId: number, payerIsGuest: boolean): string => {
        if (payerIsGuest) return 'Guest';
        if (payerId === user?.id) return 'You';
        if (payerId === friend?.id) return friend?.full_name || 'Friend';
        return 'Someone';
    };

    const calculateTotalBalance = (): number => {
        if (balances.length === 0) return 0;

        let totalUSD = 0;
        balances.forEach(b => {
            const rate = exchangeRates[b.currency] || 1;
            totalUSD += b.amount / rate;
        });
        return totalUSD;
    };

    const getFilteredExpenses = () => {
        if (filterType === 'all') return expenses;
        if (filterType === 'direct') return expenses.filter(e => !e.group_id);
        if (filterType === 'group') return expenses.filter(e => !!e.group_id);
        return expenses;
    };

    const filteredExpenses = getFilteredExpenses();

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
                    <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
                </div>
            </div>
        );
    }

    if (error || !friend) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
                <div className="text-center">
                    <div className="text-red-500 dark:text-red-400 mb-4">{error || 'Friend not found'}</div>
                    <button
                        onClick={() => navigate('/')}
                        className="text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    const totalBalance = calculateTotalBalance();

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
            {/* Header */}
            <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/50">
                <div className="max-w-5xl mx-auto px-4 lg:px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 lg:gap-4 min-w-0">
                            <button
                                onClick={() => navigate('/')}
                                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
                            >
                                &larr;
                            </button>
                            <div className="min-w-0">
                                <h1 className="text-lg lg:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                                    {friend.full_name}
                                </h1>
                                <p className="text-xs lg:text-sm text-gray-500 dark:text-gray-400 truncate">
                                    {friend.email}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 lg:px-6 py-4 lg:py-6">
                {/* Quick Actions */}
                <div className="flex gap-2 mb-4">
                    <button
                        onClick={() => setIsExpenseModalOpen(true)}
                        className="flex-1 px-4 py-3 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 shadow-sm active:bg-orange-700"
                    >
                        Add Expense
                    </button>
                    <button
                        onClick={() => setIsSettleUpModalOpen(true)}
                        className="flex-1 px-4 py-3 bg-teal-500 text-white text-sm font-medium rounded-lg hover:bg-teal-600 shadow-sm active:bg-teal-700"
                    >
                        Settle Up
                    </button>
                </div>

                {/* Balance Summary */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50 p-4 lg:p-6 mb-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                            Balance
                        </h2>
                        {balances.length > 1 && (
                            <button
                                onClick={() => setShowInUSD(!showInUSD)}
                                className="text-xs px-2 lg:px-3 py-1 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded border border-gray-300 dark:border-gray-600"
                            >
                                {showInUSD ? 'Show by currency' : 'Show in USD'}
                            </button>
                        )}
                    </div>

                    {balances.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 italic text-sm">
                            You're all settled up!
                        </p>
                    ) : showInUSD ? (
                        <div className={`text-2xl lg:text-3xl font-bold ${totalBalance >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                            {totalBalance >= 0 ? (
                                <span>{friend.full_name} owes you {formatMoney(Math.abs(totalBalance) * 100, 'USD')}</span>
                            ) : (
                                <span>You owe {friend.full_name} {formatMoney(Math.abs(totalBalance) * 100, 'USD')}</span>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {balances.map((balance, index) => (
                                <div key={index} className={`text-lg lg:text-xl font-semibold ${balance.amount >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                                    {balance.amount >= 0 ? (
                                        <span>{friend.full_name} owes you {formatMoney(Math.abs(balance.amount) * 100, balance.currency)}</span>
                                    ) : (
                                        <span>You owe {friend.full_name} {formatMoney(Math.abs(balance.amount) * 100, balance.currency)}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Expenses Section */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50 p-4 lg:p-6">
                    <div className="flex items-center justify-between mb-3 lg:mb-4">
                        <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                            Expenses
                        </h2>
                        {expenses.length > 0 && (
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setFilterType('all')}
                                    className={`text-xs px-2 py-1 rounded ${filterType === 'all'
                                        ? 'bg-teal-500 text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                >
                                    All
                                </button>
                                <button
                                    onClick={() => setFilterType('direct')}
                                    className={`text-xs px-2 py-1 rounded ${filterType === 'direct'
                                        ? 'bg-teal-500 text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                >
                                    Direct
                                </button>
                                <button
                                    onClick={() => setFilterType('group')}
                                    className={`text-xs px-2 py-1 rounded ${filterType === 'group'
                                        ? 'bg-teal-500 text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                >
                                    Group
                                </button>
                            </div>
                        )}
                    </div>

                    {filteredExpenses.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 italic text-sm">
                            {expenses.length === 0
                                ? 'No shared expenses yet'
                                : 'No expenses match the filter'}
                        </p>
                    ) : (
                        <div className="divide-y dark:divide-gray-700">
                            {(isExpensesExpanded ? filteredExpenses : filteredExpenses.slice(0, 10)).map(expense => (
                                <div
                                    key={expense.id}
                                    className="py-3 flex items-start lg:items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 -mx-2 px-2 rounded gap-2"
                                    onClick={() => handleExpenseClick(expense.id)}
                                >
                                    <div className="flex items-start lg:items-center gap-2 lg:gap-4 min-w-0 flex-1">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 w-10 lg:w-12 flex-shrink-0">
                                            {formatDate(expense.date, { month: 'short', day: 'numeric' })}
                                        </div>
                                        {expense.icon && (
                                            <div className="text-xl flex-shrink-0">
                                                {expense.icon}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                                {expense.description}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                                <span>{getPayerName(expense.payer_id, expense.payer_is_guest)} paid</span>
                                                {expense.group_name && (
                                                    <>
                                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                                        <span
                                                            className="text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (expense.group_id) navigate(`/groups/${expense.group_id}`);
                                                            }}
                                                        >
                                                            {expense.group_name}
                                                        </span>
                                                    </>
                                                )}
                                                {!expense.group_id && (
                                                    <>
                                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                                        <span className="text-purple-600 dark:text-purple-400">Direct</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-xs lg:text-sm font-medium text-gray-900 dark:text-gray-100 flex-shrink-0">
                                        {formatMoney(expense.amount, expense.currency)}
                                    </div>
                                </div>
                            ))}
                            {filteredExpenses.length > 10 && (
                                <div className="pt-3 text-center">
                                    <button
                                        onClick={() => setIsExpensesExpanded(!isExpensesExpanded)}
                                        className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 font-medium cursor-pointer hover:underline"
                                    >
                                        {isExpensesExpanded
                                            ? 'Show less'
                                            : `+${filteredExpenses.length - 10} more expenses`}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>

            {/* Modals */}
            <AddExpenseModal
                isOpen={isExpenseModalOpen}
                onClose={() => setIsExpenseModalOpen(false)}
                onExpenseAdded={() => {
                    fetchFriendData();
                    setIsExpenseModalOpen(false);
                }}
                friends={allFriends}
                groups={groups}
                preselectedFriendId={friend.id}
            />

            <SettleUpModal
                isOpen={isSettleUpModalOpen}
                onClose={() => setIsSettleUpModalOpen(false)}
                onSettled={() => {
                    fetchFriendData();
                    setIsSettleUpModalOpen(false);
                }}
                friends={allFriends}
                preselectedFriendId={friend.id}
            />

            {selectedExpenseId && (
                <ExpenseDetailModal
                    isOpen={isExpenseDetailOpen}
                    onClose={() => {
                        setIsExpenseDetailOpen(false);
                        setSelectedExpenseId(null);
                    }}
                    expenseId={selectedExpenseId}
                    onExpenseUpdated={fetchFriendData}
                    onExpenseDeleted={fetchFriendData}
                    groupMembers={[]}
                    groupGuests={[]}
                    currentUserId={user?.id || 0}
                />
            )}
        </div>
    );
};

export default FriendDetailPage;
