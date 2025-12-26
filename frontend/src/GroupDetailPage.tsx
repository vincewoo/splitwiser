import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { usePageTitle } from './hooks/usePageTitle';
import EditGroupModal from './EditGroupModal';
import DeleteGroupConfirm from './DeleteGroupConfirm';
import AddExpenseModal from './AddExpenseModal';
import ExpenseDetailModal from './ExpenseDetailModal';
import AddMemberModal from './AddMemberModal';
import AddGuestModal from './AddGuestModal';
import ManageGuestModal from './ManageGuestModal';

interface GroupMember {
    id: number;
    user_id: number;
    full_name: string;
    email: string;
}

interface GuestMember {
    id: number;
    group_id: number;
    name: string;
    created_by_id: number;
    claimed_by_id: number | null;
    managed_by_id: number | null;
    managed_by_type: string | null;  // 'user' | 'guest'
    managed_by_name: string | null;
}

interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
    icon?: string | null;
    members: GroupMember[];
    guests: GuestMember[];
}

interface ExpenseSplit {
    id: number;
    expense_id: number;
    user_id: number;
    is_guest: boolean;
    amount_owed: number;
    percentage?: number;
    shares?: number;
    user_name: string;
}

interface Expense {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    group_id: number | null;
    splits: ExpenseSplit[];
    icon?: string | null;
}

interface GroupBalance {
    user_id: number;
    is_guest: boolean;
    full_name: string;
    amount: number;
    currency: string;
    managed_guests: string[];
}

interface Friend {
    id: number;
    full_name: string;
    email: string;
}

const GroupDetailPage: React.FC = () => {
    const { groupId } = useParams<{ groupId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [group, setGroup] = useState<Group | null>(null);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [balances, setBalances] = useState<GroupBalance[]>([]);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
    const [isAddGuestModalOpen, setIsAddGuestModalOpen] = useState(false);
    const [isManageGuestModalOpen, setIsManageGuestModalOpen] = useState(false);
    const [selectedGuest, setSelectedGuest] = useState<GuestMember | null>(null);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
    const [isExpenseDetailOpen, setIsExpenseDetailOpen] = useState(false);

    const [showInGroupCurrency, setShowInGroupCurrency] = useState(true);
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });
    const [isMembersExpanded, setIsMembersExpanded] = useState(false);
    const [isBalancesExpanded, setIsBalancesExpanded] = useState(true);
    const [isExpensesExpanded, setIsExpensesExpanded] = useState(false);
    const [showOnlyMyExpenses, setShowOnlyMyExpenses] = useState(false);

    // Set dynamic page title with group name
    usePageTitle(group?.name || 'Loading...');

    const fetchGroupData = async () => {
        const token = localStorage.getItem('token');
        setIsLoading(true);
        setError(null);

        try {
            const [groupRes, expensesRes, balancesRes, friendsRes] = await Promise.all([
                fetch(`http://localhost:8000/groups/${groupId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(`http://localhost:8000/groups/${groupId}/expenses`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(`http://localhost:8000/groups/${groupId}/balances`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch('http://localhost:8000/friends', {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);

            if (!groupRes.ok) {
                if (groupRes.status === 404) {
                    setError('Group not found');
                } else if (groupRes.status === 403) {
                    setError('You are not a member of this group');
                } else {
                    setError('Failed to load group');
                }
                setIsLoading(false);
                return;
            }

            const [groupData, expensesData, balancesData, friendsData] = await Promise.all([
                groupRes.json(),
                expensesRes.json(),
                balancesRes.json(),
                friendsRes.json()
            ]);

            setGroup(groupData);
            setExpenses(expensesData);
            setBalances(balancesData);
            setFriends(friendsData);
        } catch (err) {
            setError('Failed to load group data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchGroupData();
        // Fetch exchange rates
        fetch('http://localhost:8000/exchange_rates')
            .then(res => res.json())
            .then(data => setExchangeRates(data))
            .catch(err => console.error('Failed to fetch exchange rates:', err));
    }, [groupId]);

    const handleAddMember = () => {
        fetchGroupData();
    };

    const handleRemoveMember = async (userId: number) => {
        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/groups/${groupId}/members/${userId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.ok) {
            // If user removed themselves, navigate back to dashboard
            if (userId === user?.id) {
                navigate('/');
            } else {
                fetchGroupData();
            }
        } else {
            const err = await response.json();
            alert(err.detail || 'Failed to remove member');
        }
    };

    const handleAddGuest = () => {
        fetchGroupData();
    };

    const handleRemoveGuest = async (guestId: number) => {
        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/groups/${groupId}/guests/${guestId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.ok) {
            fetchGroupData();
        } else {
            const err = await response.json();
            alert(err.detail || 'Failed to remove guest');
        }
    };

    const handleClaimGuest = async (guestId: number) => {
        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/groups/${groupId}/guests/${guestId}/claim`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.ok) {
            fetchGroupData();
        } else {
            const err = await response.json();
            alert(err.detail || 'Failed to claim guest');
        }
    };

    const handleGroupUpdated = (updatedGroup: { id: number; name: string; created_by_id: number }) => {
        if (group) {
            setGroup({ ...group, ...updatedGroup });
        }
        setIsEditModalOpen(false);
    };

    const handleGroupDeleted = () => {
        navigate('/');
    };

    const handleExpenseClick = (expenseId: number) => {
        setSelectedExpenseId(expenseId);
        setIsExpenseDetailOpen(true);
    };

    const handleExpenseUpdated = () => {
        fetchGroupData();
        setIsExpenseDetailOpen(false);
    };

    const handleExpenseDeleted = () => {
        fetchGroupData();
        setIsExpenseDetailOpen(false);
    };

    const formatMoney = (amount: number, currency: string) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    };

    const getPayerName = (payerId: number, isGuest: boolean = false) => {
        if (!isGuest && payerId === user?.id) return 'You';
        if (isGuest) {
            const guest = group?.guests?.find(g => g.id === payerId);
            return guest?.name || 'Unknown Guest';
        }
        const member = group?.members.find(m => m.user_id === payerId);
        return member?.full_name || 'Unknown';
    };

    const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string): number => {
        if (fromCurrency === toCurrency) return amount;
        if (!exchangeRates[fromCurrency] || !exchangeRates[toCurrency]) return amount;

        // Convert to USD first, then to target currency
        const amountInUSD = amount / exchangeRates[fromCurrency];
        return amountInUSD * exchangeRates[toCurrency];
    };

    const getProcessedBalances = () => {
        if (showInGroupCurrency && group?.default_currency) {
            // Convert all balances to group's default currency
            const converted = balances.map(balance => {
                // Convert the main balance amount
                const convertedAmount = convertCurrency(balance.amount, balance.currency, group.default_currency);

                // Convert managed_guests amounts if they exist
                let convertedManagedGuests = balance.managed_guests;
                if (balance.managed_guests && balance.managed_guests.length > 0 && balance.currency !== group.default_currency) {
                    convertedManagedGuests = balance.managed_guests.map(guestStr => {
                        // Parse "Guest Name ($12.34)" or "Guest Name (-$12.34)" format
                        const match = guestStr.match(/^(.+?)\s*\(([+-]?[^\d]*)([\d.]+)\)$/);
                        if (match) {
                            const guestName = match[1];
                            const sign = match[2].includes('-') ? -1 : 1;
                            const amount = parseFloat(match[3]) * 100 * sign; // Convert to cents
                            const convertedGuestAmount = convertCurrency(amount, balance.currency, group.default_currency);
                            return `${guestName} (${formatMoney(convertedGuestAmount, group.default_currency)})`;
                        }
                        return guestStr; // Return unchanged if parsing fails
                    });
                }

                return {
                    ...balance,
                    amount: convertedAmount,
                    currency: group.default_currency,
                    managed_guests: convertedManagedGuests
                };
            });

            // Aggregate by user (combine amounts now in same currency)
            const aggregated: Record<string, GroupBalance> = {};
            converted.forEach(balance => {
                const key = `${balance.user_id}_${balance.is_guest}`;
                if (aggregated[key]) {
                    aggregated[key].amount += balance.amount;
                    // Merge and consolidate managed_guests arrays
                    if (balance.managed_guests && balance.managed_guests.length > 0) {
                        const existingGuests = aggregated[key].managed_guests || [];
                        const allGuests = [...existingGuests, ...balance.managed_guests];

                        // Parse, group by guest name, and sum amounts
                        const guestMap: Record<string, number> = {};
                        allGuests.forEach(guestStr => {
                            // Parse "Guest Name ($12.34)" or "Guest Name (-$12.34)" format
                            const match = guestStr.match(/^(.+?)\s*\(([+-]?[^\d]*)([\d.]+)\)$/);
                            if (match) {
                                const guestName = match[1];
                                const sign = match[2].includes('-') ? -1 : 1;
                                const amount = parseFloat(match[3]) * sign;
                                guestMap[guestName] = (guestMap[guestName] || 0) + amount;
                            }
                        });

                        // Re-format consolidated guests with currency symbols
                        const currency = group.default_currency;
                        aggregated[key].managed_guests = Object.entries(guestMap).map(
                            ([name, amount]) => `${name} (${formatMoney(amount * 100, currency)})`
                        );
                    }
                } else {
                    aggregated[key] = { ...balance };
                }
            });

            return Object.values(aggregated).filter(b => Math.abs(b.amount) > 0.01);
        } else {
            // Group by currency - sort so same currency appears together
            return [...balances].sort((a, b) => {
                if (a.currency !== b.currency) {
                    return a.currency.localeCompare(b.currency);
                }
                return a.full_name.localeCompare(b.full_name);
            });
        }
    };

    const renderBalancesByCurrency = () => {
        const processedBalances = getProcessedBalances();

        // Group balances by currency for display
        const byCurrency: Record<string, GroupBalance[]> = {};
        processedBalances.forEach(balance => {
            if (!byCurrency[balance.currency]) {
                byCurrency[balance.currency] = [];
            }
            byCurrency[balance.currency].push(balance);
        });

        return (
            <div className="space-y-4">
                {Object.entries(byCurrency).map(([currency, balanceList]) => {
                    // Sort: "You" first, then alphabetically
                    const sortedList = [...balanceList].sort((a, b) => {
                        if (a.full_name === 'You') return -1;
                        if (b.full_name === 'You') return 1;
                        return a.full_name.localeCompare(b.full_name);
                    });

                    return (
                    <div key={currency}>
                        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">
                            {currency}
                        </h3>
                        <ul className="space-y-2">
                            {sortedList.map((balance, idx) => (
                                <li key={`${balance.user_id}_${balance.is_guest}_${idx}`}
                                    className="flex items-center justify-between py-2">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                            {balance.full_name}
                                        </span>
                                        {balance.managed_guests && balance.managed_guests.length > 0 && (
                                            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                Includes: {balance.managed_guests.join(', ')}
                                            </span>
                                        )}
                                    </div>
                                    <span className={`text-sm font-semibold ${balance.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {balance.amount >= 0 ? '+' : ''}
                                        {formatMoney(balance.amount, balance.currency)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    );
                })}
            </div>
        );
    };

    const renderBalancesConverted = () => {
        const processedBalances = getProcessedBalances();

        // Sort: "You" first, then alphabetically
        const sortedBalances = [...processedBalances].sort((a, b) => {
            if (a.full_name === 'You') return -1;
            if (b.full_name === 'You') return 1;
            return a.full_name.localeCompare(b.full_name);
        });

        return (
            <ul className="space-y-2">
                {sortedBalances.map((balance, index) => (
                    <li key={index} className="flex items-center justify-between py-2">
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {balance.full_name}
                            </span>
                            {balance.managed_guests && balance.managed_guests.length > 0 && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Includes: {balance.managed_guests.join(', ')}
                                </span>
                            )}
                        </div>
                        <span className={`text-sm font-semibold ${balance.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {balance.amount >= 0 ? '+' : ''}
                            {formatMoney(balance.amount, balance.currency)}
                        </span>
                    </li>
                ))}
            </ul>
        );
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
                <div className="text-gray-500 dark:text-gray-400">Loading...</div>
            </div>
        );
    }

    if (error || !group) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
                <div className="text-center">
                    <div className="text-red-500 dark:text-red-400 mb-4">{error || 'Group not found'}</div>
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

    const isOwner = group.created_by_id === user?.id;

    const getFilteredExpenses = () => {
        if (!showOnlyMyExpenses || !user) return expenses;

        return expenses.filter(expense => {
            // Include if user is the payer
            if (expense.payer_id === user.id && !expense.payer_is_guest) {
                return true;
            }

            // Include if user is in the splits
            return expense.splits?.some(split =>
                split.user_id === user.id && !split.is_guest
            );
        });
    };

    const filteredExpenses = getFilteredExpenses();

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
                            <h1 className="text-lg lg:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                                {group.icon && <span>{group.icon}</span>}
                                <span>{group.name}</span>
                            </h1>
                        </div>
                        {isOwner && (
                            <div className="flex gap-1 lg:gap-2 flex-shrink-0">
                                <button
                                    onClick={() => setIsEditModalOpen(true)}
                                    className="px-2 lg:px-3 py-1 text-xs lg:text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => setIsDeleteConfirmOpen(true)}
                                    className="px-2 lg:px-3 py-1 text-xs lg:text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                                >
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 lg:px-6 py-4 lg:py-6">
                {/* Quick Action - Add Expense */}
                <div className="mb-4">
                    <button
                        onClick={() => setIsExpenseModalOpen(true)}
                        className="w-full px-4 py-3 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 shadow-sm active:bg-orange-700"
                    >
                        Add Expense
                    </button>
                </div>

                {/* Expenses Section - Priority #1 */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50 p-4 lg:p-6 mb-4">
                    <div className="flex items-center justify-between mb-3 lg:mb-4">
                        <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                            Recent Expenses
                        </h2>
                        {expenses.length > 0 && (
                            <button
                                onClick={() => setShowOnlyMyExpenses(!showOnlyMyExpenses)}
                                className="text-xs px-2 lg:px-3 py-1 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded border border-gray-300 dark:border-gray-600 whitespace-nowrap"
                            >
                                {showOnlyMyExpenses ? 'Show all' : 'Only mine'}
                            </button>
                        )}
                    </div>

                    {filteredExpenses.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 italic text-sm">
                            {showOnlyMyExpenses ? 'No expenses where you participated' : 'No expenses yet'}
                        </p>
                    ) : (
                        <div className="divide-y">
                            {(isExpensesExpanded ? filteredExpenses : filteredExpenses.slice(0, 5)).map(expense => (
                                <div
                                    key={expense.id}
                                    className="py-3 flex items-start lg:items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 -mx-2 px-2 rounded gap-2"
                                    onClick={() => handleExpenseClick(expense.id)}
                                >
                                    <div className="flex items-start lg:items-center gap-2 lg:gap-4 min-w-0 flex-1">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 w-10 lg:w-12 flex-shrink-0">
                                            {formatDate(expense.date)}
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
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                {getPayerName(expense.payer_id, expense.payer_is_guest)} paid
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-xs lg:text-sm font-medium text-gray-900 dark:text-gray-100 flex-shrink-0">
                                        {formatMoney(expense.amount, expense.currency)}
                                    </div>
                                </div>
                            ))}
                            {filteredExpenses.length > 5 && (
                                <div className="pt-3 text-center">
                                    <button
                                        onClick={() => setIsExpensesExpanded(!isExpensesExpanded)}
                                        className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 font-medium cursor-pointer hover:underline"
                                    >
                                        {isExpensesExpanded
                                            ? 'Show less'
                                            : `+${filteredExpenses.length - 5} more expenses`}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Balances Section - Collapsible */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50 mb-4">
                    <div
                        className="w-full p-4 lg:p-6 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                        <div
                            onClick={() => setIsBalancesExpanded(!isBalancesExpanded)}
                            className="flex-1 cursor-pointer"
                        >
                            <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                                Group Balances
                            </h2>
                            {isBalancesExpanded && group?.default_currency && balances.length > 0 && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {showInGroupCurrency
                                        ? `Displaying in ${group.default_currency}`
                                        : `Grouped by currency`}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {isBalancesExpanded && group?.default_currency && balances.length > 0 && (
                                <button
                                    onClick={() => setShowInGroupCurrency(!showInGroupCurrency)}
                                    className="text-xs px-2 lg:px-3 py-1 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded border border-gray-300 dark:border-gray-600 whitespace-nowrap"
                                >
                                    {showInGroupCurrency
                                        ? `By currency`
                                        : `In ${group.default_currency}`}
                                </button>
                            )}
                            <span
                                onClick={() => setIsBalancesExpanded(!isBalancesExpanded)}
                                className="text-gray-400 dark:text-gray-500 text-xl cursor-pointer"
                            >
                                {isBalancesExpanded ? '−' : '+'}
                            </span>
                        </div>
                    </div>

                    {isBalancesExpanded && (
                        <div className="px-4 lg:px-6 pb-4 lg:pb-6 border-t dark:border-gray-700">
                            {balances.length === 0 ? (
                                <p className="text-gray-500 dark:text-gray-400 italic text-sm mt-4">No balances yet</p>
                            ) : (
                                <div className="mt-4">
                                    {!showInGroupCurrency && renderBalancesByCurrency()}
                                    {showInGroupCurrency && renderBalancesConverted()}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Members Section - Collapsible */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50">
                    <button
                        onClick={() => setIsMembersExpanded(!isMembersExpanded)}
                        className="w-full p-4 lg:p-6 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                        <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                            Members ({group.members.length + (group.guests?.length || 0)})
                        </h2>
                        <span className="text-gray-400 dark:text-gray-500 text-xl">
                            {isMembersExpanded ? '−' : '+'}
                        </span>
                    </button>

                    {isMembersExpanded && (
                        <div className="px-4 lg:px-6 pb-4 lg:pb-6 border-t dark:border-gray-700">
                            <ul className="space-y-2 lg:space-y-3 mb-4 mt-4">
                                {[...group.members].sort((a, b) => a.full_name.localeCompare(b.full_name)).map(member => (
                                    <li key={member.id} className="flex items-center justify-between">
                                        <div>
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                {member.full_name}
                                                {member.user_id === group.created_by_id && (
                                                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">(owner)</span>
                                                )}
                                                {member.user_id === user?.id && (
                                                    <span className="ml-2 text-xs text-teal-600 dark:text-teal-400">(you)</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{member.email}</div>
                                        </div>
                                        {member.user_id !== group.created_by_id && (isOwner || member.user_id === user?.id) && (
                                            <button
                                                onClick={() => handleRemoveMember(member.user_id)}
                                                className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                                            >
                                                {member.user_id === user?.id ? 'Leave' : 'Remove'}
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <ul className="space-y-2">
                                {group.guests?.sort((a, b) => a.name.localeCompare(b.name)).map(guest => (
                                    <li key={guest.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700 rounded">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-900 dark:text-gray-100">{guest.name}</span>
                                                <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs rounded">
                                                    guest
                                                </span>
                                            </div>
                                            {guest.managed_by_name && (
                                                <span className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                                    Managed by {guest.managed_by_name}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleClaimGuest(guest.id)}
                                                className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                                title="Claim this guest"
                                            >
                                                Claim
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setSelectedGuest(guest);
                                                    setIsManageGuestModalOpen(true);
                                                }}
                                                className="text-xs px-2 py-1 text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded"
                                                title={guest.managed_by_id ? "Change manager" : "Set manager"}
                                            >
                                                {guest.managed_by_id ? 'Change' : 'Manage'}
                                            </button>
                                            {user?.id === group.created_by_id && (
                                                <button
                                                    onClick={() => handleRemoveGuest(guest.id)}
                                                    className="text-xs px-2 py-1 text-red-600 darktext-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>

                            {/* Action buttons */}
                            <div className="flex flex-col sm:flex-row gap-2 mt-4">
                                <button
                                    onClick={() => setIsAddMemberModalOpen(true)}
                                    className="flex-1 px-4 py-3 bg-teal-500 text-white text-sm font-medium rounded-lg hover:bg-teal-600 transition-colors min-h-[44px]"
                                >
                                    Add Member
                                </button>
                                <button
                                    onClick={() => setIsAddGuestModalOpen(true)}
                                    className="flex-1 px-4 py-3 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors min-h-[44px]"
                                >
                                    Add Guest
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Modals */}
            <EditGroupModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                group={group}
                onGroupUpdated={handleGroupUpdated}
            />

            <DeleteGroupConfirm
                isOpen={isDeleteConfirmOpen}
                onClose={() => setIsDeleteConfirmOpen(false)}
                group={group}
                onDeleted={handleGroupDeleted}
            />

            <AddExpenseModal
                isOpen={isExpenseModalOpen}
                onClose={() => setIsExpenseModalOpen(false)}
                onExpenseAdded={fetchGroupData}
                friends={friends}
                groups={[group]}
                preselectedGroupId={group.id}
            />

            <ExpenseDetailModal
                isOpen={isExpenseDetailOpen}
                onClose={() => setIsExpenseDetailOpen(false)}
                expenseId={selectedExpenseId}
                onExpenseUpdated={handleExpenseUpdated}
                onExpenseDeleted={handleExpenseDeleted}
                groupMembers={group.members}
                groupGuests={group.guests || []}
                currentUserId={user?.id || 0}
            />

            <AddMemberModal
                isOpen={isAddMemberModalOpen}
                onClose={() => setIsAddMemberModalOpen(false)}
                onMemberAdded={handleAddMember}
                groupId={groupId || ''}
                friends={friends}
            />

            <AddGuestModal
                isOpen={isAddGuestModalOpen}
                onClose={() => setIsAddGuestModalOpen(false)}
                onGuestAdded={handleAddGuest}
                groupId={groupId || ''}
            />

            <ManageGuestModal
                isOpen={isManageGuestModalOpen}
                onClose={() => {
                    setIsManageGuestModalOpen(false);
                    setSelectedGuest(null);
                }}
                guest={selectedGuest}
                groupId={groupId || ''}
                groupMembers={group?.members || []}
                groupGuests={group?.guests || []}
                onGuestUpdated={() => {
                    fetchGroupData();
                    setIsManageGuestModalOpen(false);
                    setSelectedGuest(null);
                }}
            />
        </div>
    );
};

export default GroupDetailPage;
