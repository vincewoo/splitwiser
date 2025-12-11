import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import EditGroupModal from './EditGroupModal';
import DeleteGroupConfirm from './DeleteGroupConfirm';
import AddExpenseModal from './AddExpenseModal';
import ExpenseDetailModal from './ExpenseDetailModal';

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
}

interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
    members: GroupMember[];
    guests: GuestMember[];
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
}

interface GroupBalance {
    user_id: number;
    is_guest: boolean;
    full_name: string;
    amount: number;
    currency: string;
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

    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [addMemberError, setAddMemberError] = useState<string | null>(null);

    const [newGuestName, setNewGuestName] = useState('');
    const [addGuestError, setAddGuestError] = useState<string | null>(null);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
    const [isExpenseDetailOpen, setIsExpenseDetailOpen] = useState(false);

    const [showInGroupCurrency, setShowInGroupCurrency] = useState(false);
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });

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

    const handleAddMember = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddMemberError(null);

        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/groups/${groupId}/members`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: newMemberEmail })
        });

        if (response.ok) {
            setNewMemberEmail('');
            fetchGroupData();
        } else {
            const err = await response.json();
            setAddMemberError(err.detail || 'Failed to add member');
        }
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

    const handleAddGuest = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddGuestError(null);

        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/groups/${groupId}/guests`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newGuestName })
        });

        if (response.ok) {
            setNewGuestName('');
            fetchGroupData();
        } else {
            const err = await response.json();
            setAddGuestError(err.detail || 'Failed to add guest');
        }
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
            const converted = balances.map(balance => ({
                ...balance,
                amount: convertCurrency(balance.amount, balance.currency, group.default_currency),
                currency: group.default_currency
            }));

            // Aggregate by user (combine amounts now in same currency)
            const aggregated: Record<string, GroupBalance> = {};
            converted.forEach(balance => {
                const key = `${balance.user_id}_${balance.is_guest}`;
                if (aggregated[key]) {
                    aggregated[key].amount += balance.amount;
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
                {Object.entries(byCurrency).map(([currency, balanceList]) => (
                    <div key={currency}>
                        <h3 className="text-sm font-semibold text-gray-600 mb-2 uppercase">
                            {currency}
                        </h3>
                        <ul className="space-y-2">
                            {balanceList.map((balance, idx) => (
                                <li key={`${balance.user_id}_${balance.is_guest}_${idx}`}
                                    className="flex justify-between items-center pl-2">
                                    <span className="text-sm text-gray-700">
                                        {balance.full_name}
                                    </span>
                                    <span className={`text-sm font-medium ${
                                        balance.amount >= 0 ? 'text-teal-600' : 'text-red-500'
                                    }`}>
                                        {balance.amount >= 0 ? '+' : ''}
                                        {formatMoney(balance.amount, balance.currency)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        );
    };

    const renderBalancesConverted = () => {
        const processedBalances = getProcessedBalances();

        return (
            <ul className="space-y-2">
                {processedBalances.map((balance, idx) => (
                    <li key={`${balance.user_id}_${balance.is_guest}_${idx}`}
                        className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">
                            {balance.full_name}
                        </span>
                        <span className={`text-sm font-medium ${
                            balance.amount >= 0 ? 'text-teal-600' : 'text-red-500'
                        }`}>
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
            <div className="flex h-screen items-center justify-center bg-gray-100">
                <div className="text-gray-500">Loading...</div>
            </div>
        );
    }

    if (error || !group) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-100">
                <div className="text-center">
                    <div className="text-red-500 mb-4">{error || 'Group not found'}</div>
                    <button
                        onClick={() => navigate('/')}
                        className="text-teal-600 hover:text-teal-800"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    const isOwner = group.created_by_id === user?.id;

    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <header className="bg-white shadow-sm">
                <div className="max-w-5xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={() => navigate('/')}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                &larr; Back
                            </button>
                            <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
                        </div>
                        {isOwner && (
                            <div className="flex space-x-2">
                                <button
                                    onClick={() => setIsEditModalOpen(true)}
                                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => setIsDeleteConfirmOpen(true)}
                                    className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                                >
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Members Section */}
                    <div className="bg-white rounded shadow-sm p-6">
                        <h2 className="text-lg font-medium text-gray-900 mb-4">
                            Members ({group.members.length + (group.guests?.length || 0)})
                        </h2>
                        <ul className="space-y-3 mb-4">
                            {group.members.map(member => (
                                <li key={member.id} className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-gray-900">
                                            {member.full_name}
                                            {member.user_id === group.created_by_id && (
                                                <span className="ml-2 text-xs text-gray-500">(owner)</span>
                                            )}
                                            {member.user_id === user?.id && (
                                                <span className="ml-2 text-xs text-teal-600">(you)</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-500">{member.email}</div>
                                    </div>
                                    {/* Show remove button if owner (can remove others) or if it's yourself (can leave) */}
                                    {member.user_id !== group.created_by_id && (isOwner || member.user_id === user?.id) && (
                                        <button
                                            onClick={() => handleRemoveMember(member.user_id)}
                                            className="text-xs text-red-500 hover:text-red-700"
                                        >
                                            {member.user_id === user?.id ? 'Leave' : 'Remove'}
                                        </button>
                                    )}
                                </li>
                            ))}
                            {/* Guest members */}
                            {group.guests?.map(guest => (
                                <li key={`guest-${guest.id}`} className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-gray-900">
                                            {guest.name}
                                            <span className="ml-2 text-xs text-orange-500">(guest)</span>
                                        </div>
                                        <div className="text-xs text-gray-400">No account</div>
                                    </div>
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => handleClaimGuest(guest.id)}
                                            className="text-xs text-teal-500 hover:text-teal-700"
                                        >
                                            Claim
                                        </button>
                                        <button
                                            onClick={() => handleRemoveGuest(guest.id)}
                                            className="text-xs text-red-500 hover:text-red-700"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <form onSubmit={handleAddMember} className="mt-4">
                            <div className="flex space-x-2">
                                <input
                                    type="email"
                                    placeholder="Add member by email"
                                    className="flex-1 text-sm p-2 border rounded focus:outline-none focus:border-teal-500"
                                    value={newMemberEmail}
                                    onChange={(e) => setNewMemberEmail(e.target.value)}
                                    required
                                />
                                <button
                                    type="submit"
                                    className="px-3 py-2 bg-teal-500 text-white text-sm rounded hover:bg-teal-600"
                                >
                                    Add
                                </button>
                            </div>
                            {addMemberError && (
                                <p className="mt-2 text-xs text-red-500">{addMemberError}</p>
                            )}
                        </form>

                        <form onSubmit={handleAddGuest} className="mt-2">
                            <div className="flex space-x-2">
                                <input
                                    type="text"
                                    placeholder="Add guest by name"
                                    className="flex-1 text-sm p-2 border rounded focus:outline-none focus:border-orange-500"
                                    value={newGuestName}
                                    onChange={(e) => setNewGuestName(e.target.value)}
                                    required
                                />
                                <button
                                    type="submit"
                                    className="px-3 py-2 bg-orange-500 text-white text-sm rounded hover:bg-orange-600"
                                >
                                    Add Guest
                                </button>
                            </div>
                            {addGuestError && (
                                <p className="mt-2 text-xs text-red-500">{addGuestError}</p>
                            )}
                        </form>
                    </div>

                    {/* Balances Section */}
                    <div className="bg-white rounded shadow-sm p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-medium text-gray-900">Group Balances</h2>
                            {group?.default_currency && balances.length > 0 && (
                                <button
                                    onClick={() => setShowInGroupCurrency(!showInGroupCurrency)}
                                    className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
                                >
                                    {showInGroupCurrency
                                        ? `Show by currency`
                                        : `Show in ${group.default_currency}`}
                                </button>
                            )}
                        </div>

                        {balances.length === 0 ? (
                            <p className="text-gray-500 italic text-sm">No balances yet</p>
                        ) : (
                            <div>
                                {!showInGroupCurrency && renderBalancesByCurrency()}
                                {showInGroupCurrency && renderBalancesConverted()}
                            </div>
                        )}
                    </div>
                </div>

                {/* Expenses Section */}
                <div className="bg-white rounded shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-medium text-gray-900">Group Expenses</h2>
                        <button
                            onClick={() => setIsExpenseModalOpen(true)}
                            className="px-4 py-2 bg-orange-500 text-white text-sm rounded hover:bg-orange-600"
                        >
                            Add Expense
                        </button>
                    </div>

                    {expenses.length === 0 ? (
                        <p className="text-gray-500 italic text-sm">No expenses yet</p>
                    ) : (
                        <div className="divide-y">
                            {expenses.map(expense => (
                                <div
                                    key={expense.id}
                                    className="py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded"
                                    onClick={() => handleExpenseClick(expense.id)}
                                >
                                    <div className="flex items-center space-x-4">
                                        <div className="text-xs text-gray-500 w-12">
                                            {formatDate(expense.date)}
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {expense.description}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {getPayerName(expense.payer_id, expense.payer_is_guest)} paid
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-medium text-gray-900">
                                        {formatMoney(expense.amount, expense.currency)}
                                    </div>
                                </div>
                            ))}
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
        </div>
    );
};

export default GroupDetailPage;
