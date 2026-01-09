import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { usePageTitle } from './hooks/usePageTitle';
import { getApiUrl } from './api';
import { api } from './services/api';
import EditGroupModal from './EditGroupModal';
import DeleteGroupConfirm from './DeleteGroupConfirm';
import AddExpenseModal from './AddExpenseModal';
import ExpenseDetailModal from './ExpenseDetailModal';
import AddMemberModal from './AddMemberModal';
import AddGuestModal from './AddGuestModal';
import ManageGuestModal from './ManageGuestModal';
import ManageMemberModal from './ManageMemberModal';
import SimplifyDebtsModal from './SimplifyDebtsModal';
import AlertDialog from './components/AlertDialog';

interface GroupMember {
    id: number;
    user_id: number;
    full_name: string;
    email: string;
    managed_by_id: number | null;
    managed_by_type: string | null;  // 'user' | 'guest'
    managed_by_name: string | null;
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
    share_link_id?: string | null;
    is_public?: boolean;
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
    const { groupId, shareLinkId } = useParams<{ groupId?: string; shareLinkId?: string }>();
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
    const [isManageMemberModalOpen, setIsManageMemberModalOpen] = useState(false);
    const [selectedGuest, setSelectedGuest] = useState<GuestMember | null>(null);
    const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'success' | 'error';
        onConfirm?: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'alert'
    });
    const [isExpenseDetailOpen, setIsExpenseDetailOpen] = useState(false);

    const [showInGroupCurrency, setShowInGroupCurrency] = useState(true);
    const [isMembersExpanded, setIsMembersExpanded] = useState(!!shareLinkId);
    const [isSimplifyDebtsModalOpen, setIsSimplifyDebtsModalOpen] = useState(false);
    const [isBalancesExpanded, setIsBalancesExpanded] = useState(true);
    const [isExpensesExpanded, setIsExpensesExpanded] = useState(!!shareLinkId);
    const [showOnlyMyExpenses, setShowOnlyMyExpenses] = useState(false);

    // Set dynamic page title with group name
    usePageTitle(group?.name || 'Loading...');

    const isPublicView = !!shareLinkId;

    const fetchBalances = async (convertTo?: string) => {
        try {
            if (isPublicView) {
                const url = convertTo
                    ? `groups/public/${shareLinkId}/balances?convert_to=${convertTo}`
                    : `groups/public/${shareLinkId}/balances`;
                const response = await fetch(getApiUrl(url));
                const balancesData = await response.json();
                setBalances(balancesData);
            } else {
                const balancesData = await api.groups.getBalances(parseInt(groupId!), convertTo);
                setBalances(balancesData);
            }
        } catch (err) {
            console.error('Failed to fetch balances:', err);
        }
    };

    const fetchGroupData = async () => {
        setIsLoading(true);
        setError(null);

        try {
            if (isPublicView) {
                // Public view - no auth needed
                const [groupRes, expensesRes] = await Promise.all([
                    fetch(getApiUrl(`groups/public/${shareLinkId}`)),
                    fetch(getApiUrl(`groups/public/${shareLinkId}/expenses`))
                ]);

                if (!groupRes.ok) {
                    if (groupRes.status === 404) {
                        setError('Group not found');
                    } else {
                        setError('Failed to load group');
                    }
                    setIsLoading(false);
                    return;
                }

                const groupData = await groupRes.json();
                const expensesData = await expensesRes.json();

                setGroup(groupData);
                setExpenses(expensesData);
                setFriends([]);

                // Fetch balances separately to use conversion parameter
                await fetchBalances(showInGroupCurrency ? groupData.default_currency : undefined);
            } else {
                // Authenticated view - use API service with automatic token refresh
                const [groupData, expensesData, friendsData] = await Promise.all([
                    api.groups.getById(parseInt(groupId!)),
                    api.groups.getExpenses(parseInt(groupId!)),
                    api.friends.getAll()
                ]);

                setGroup(groupData);
                setExpenses(expensesData);
                setFriends(friendsData);

                // Fetch balances separately to use conversion parameter
                await fetchBalances(showInGroupCurrency ? groupData.default_currency : undefined);
            }
        } catch (err: any) {
            if (err.message?.includes('404') || err.message?.includes('not found')) {
                setError('Group not found');
            } else if (err.message?.includes('403')) {
                setError('You are not a member of this group');
            } else {
                setError('Failed to load group data');
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (groupId || shareLinkId) {
            fetchGroupData();
        }
    }, [groupId, shareLinkId]);

    // Refetch balances when currency toggle changes
    useEffect(() => {
        if (group) {
            fetchBalances(showInGroupCurrency ? group.default_currency : undefined);
        }
    }, [showInGroupCurrency]);

    // Redirect logged-in members from public link to full authenticated view
    useEffect(() => {
        if (isPublicView && user && group) {
            // Check if the logged-in user is a member of this group
            const isMember = group.members?.some(member => member.user_id === user.id);
            if (isMember) {
                // Redirect to the authenticated group view
                navigate(`/groups/${group.id}`, { replace: true });
            }
        }
    }, [isPublicView, user, group, navigate]);

    const handleAddMember = () => {
        fetchGroupData();
    };

    const handleRemoveMember = async (userId: number) => {
        try {
            const response = await api.groups.removeMember(parseInt(groupId!), userId);

            if (response.ok) {
                // If user removed themselves, navigate back to dashboard
                if (userId === user?.id) {
                    navigate('/');
                } else {
                    fetchGroupData();
                }
            } else {
                const err = await response.json();
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: err.detail || 'Failed to remove member',
                    type: 'error'
                });
            }
        } catch (error) {
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to remove member',
                type: 'error'
            });
        }
    };

    const handleAddGuest = () => {
        fetchGroupData();
    };

    const handleRemoveGuest = async (guestId: number) => {
        try {
            const response = await api.groups.removeGuest(parseInt(groupId!), guestId);

            if (response.ok) {
                fetchGroupData();
            } else {
                const err = await response.json();
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: err.detail || 'Failed to remove guest',
                    type: 'error'
                });
            }
        } catch (error) {
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to remove guest',
                type: 'error'
            });
        }
    };

    const handleClaimGuest = async (guestId: number) => {
        try {
            const response = await api.groups.claimGuest(parseInt(groupId!), guestId);

            if (response.ok) {
                fetchGroupData();
            } else {
                const err = await response.json();
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: err.detail || 'Failed to claim guest',
                    type: 'error'
                });
            }
        } catch (error) {
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to claim guest',
                type: 'error'
            });
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

    const handleShareGroup = async () => {
        if (!group || !groupId) return;

        try {
            const response = await api.groups.share(parseInt(groupId));

            if (response.ok) {
                const updatedGroup = await response.json();
                setGroup(prev => prev ? { ...prev, ...updatedGroup } : updatedGroup);

                const shareUrl = `${window.location.origin}/share/${updatedGroup.share_link_id}`;
                const shareTitle = `Join "${group.name}" on Splitwiser`;
                const shareText = `View expenses and balances for ${group.name}`;

                // Try Web Share API first (works great on iOS)
                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: shareTitle,
                            text: shareText,
                            url: shareUrl
                        });
                        return; // Success - no alert needed
                    } catch (shareErr: any) {
                        // User cancelled or share failed, fall through to clipboard
                        if (shareErr.name === 'AbortError') {
                            return; // User cancelled, don't show error
                        }
                    }
                }

                // Fallback: Try modern clipboard API
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(shareUrl);
                        setAlertDialog({
                            isOpen: true,
                            title: 'Success',
                            message: 'Public share link copied to clipboard!',
                            type: 'success'
                        });
                        return;
                    } catch (clipErr) {
                        // Clipboard failed, fall through to legacy method
                        console.warn('Clipboard API failed:', clipErr);
                    }
                }

                // Final fallback: Use legacy execCommand (works on older iOS)
                const textarea = document.createElement('textarea');
                textarea.value = shareUrl;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();

                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        setAlertDialog({
                            isOpen: true,
                            title: 'Success',
                            message: 'Public share link copied to clipboard!',
                            type: 'success'
                        });
                    } else {
                        // If all methods fail, show the URL
                        setAlertDialog({
                            isOpen: true,
                            title: 'Share Link',
                            message: `Share this link:\n${shareUrl}`,
                            type: 'alert'
                        });
                    }
                } catch (execErr) {
                    // Show the URL as last resort
                    setAlertDialog({
                        isOpen: true,
                        title: 'Share Link',
                        message: `Share this link:\n${shareUrl}`,
                        type: 'alert'
                    });
                } finally {
                    document.body.removeChild(textarea);
                }
            } else {
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: 'Failed to enable sharing',
                    type: 'error'
                });
            }
        } catch (err) {
            console.error(err);
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to share group',
                type: 'error'
            });
        }
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

    const handleJoinGroup = async () => {
        if (!shareLinkId) return;

        try {
            const response = await api.groups.joinPublic(shareLinkId);

            if (response.ok) {
                const result = await response.json();
                // Redirect to the authenticated group view
                navigate(`/groups/${result.group_id}`, { replace: true });
            } else {
                const error = await response.json();
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: error.detail || 'Failed to join group',
                    type: 'error'
                });
            }
        } catch (err) {
            console.error('Error joining group:', err);
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to join group',
                type: 'error'
            });
        }
    };

    const formatMoney = (amount: number, currency: string) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
    };

    const formatDate = (dateStr: string) => {
        // Parse date string to avoid timezone issues
        // If it's a plain YYYY-MM-DD, parse as local date not UTC
        let date: Date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const [year, month, day] = dateStr.split('-').map(Number);
            date = new Date(year, month - 1, day);
        } else {
            date = new Date(dateStr);
        }
        return date.toLocaleDateString('en-US', {
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

    const renderBalances = () => {
        // Backend now handles currency conversion, so we just need to render
        const sortedBalances = [...balances].sort((a, b) => {
            // If showing by currency, group by currency first
            if (!showInGroupCurrency && a.currency !== b.currency) {
                return a.currency.localeCompare(b.currency);
            }
            // Then sort: "You" first, then alphabetically
            if (a.full_name === 'You') return -1;
            if (b.full_name === 'You') return 1;
            return a.full_name.localeCompare(b.full_name);
        });

        if (!showInGroupCurrency) {
            // Group by currency for display
            const byCurrency: Record<string, GroupBalance[]> = {};
            sortedBalances.forEach(balance => {
                if (!byCurrency[balance.currency]) {
                    byCurrency[balance.currency] = [];
                }
                byCurrency[balance.currency].push(balance);
            });

            return (
                <div className="space-y-4">
                    {Object.entries(byCurrency).map(([currency, balanceList]) => (
                        <div key={currency}>
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">
                                {currency}
                            </h3>
                            <ul className="space-y-2">
                                {balanceList.map((balance, idx) => (
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
                    ))}
                </div>
            );
        }

        // Converted view - all in one currency
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
                {isPublicView && !user && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 px-4 py-2 text-sm text-blue-700 dark:text-blue-300 text-center border-b border-blue-100 dark:border-blue-800">
                        You are viewing this group as a guest. To join, find your name in the <strong>Members</strong> list below and click <strong>Claim</strong>.
                    </div>
                )}
                {isPublicView && user && (
                    <div className="bg-teal-50 dark:bg-teal-900/30 px-4 py-2 text-sm text-teal-700 dark:text-teal-300 text-center border-b border-teal-100 dark:border-teal-800">
                        You are viewing this public group. Click the <strong>Join Group</strong> button below to get full access.
                    </div>
                )}
                <div className="max-w-5xl mx-auto px-4 lg:px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 lg:gap-4 min-w-0">
                            {!isPublicView && (
                                <button
                                    onClick={() => navigate('/')}
                                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
                                >
                                    &larr;
                                </button>
                            )}
                            <h1 className="text-lg lg:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                                {group.icon && <span>{group.icon}</span>}
                                <span>{group.name}</span>
                            </h1>
                        </div>
                        <div className="flex gap-1 lg:gap-2 flex-shrink-0">
                            {!isPublicView && (
                                <button
                                    onClick={handleShareGroup}
                                    className="px-2 lg:px-3 py-1 text-xs lg:text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                                >
                                    Share
                                </button>
                            )}
                            {!isPublicView && isOwner && (
                                <>
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
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 lg:px-6 py-4 lg:py-6">
                {/* Quick Action - Add Expense */}
                {!isPublicView && (
                    <div className="mb-4">
                        <button
                            onClick={() => setIsExpenseModalOpen(true)}
                            className="w-full px-4 py-3 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 shadow-sm active:bg-orange-700"
                        >
                            Add Expense
                        </button>
                    </div>
                )}
                {/* Quick Action - Join Group (for logged-in users viewing public link) */}
                {isPublicView && user && (
                    <div className="mb-4">
                        <button
                            onClick={handleJoinGroup}
                            className="w-full px-4 py-3 bg-teal-500 text-white text-sm font-medium rounded-lg hover:bg-teal-600 shadow-sm active:bg-teal-700"
                        >
                            Join Group
                        </button>
                    </div>
                )}

                {/* Expenses Section - Priority #1 */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50 p-4 lg:p-6 mb-4">
                    <div className="flex items-center justify-between mb-3 lg:mb-4">
                        <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                            Recent Expenses
                        </h2>
                        {expenses.length > 0 && !isPublicView && (
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
                                <button
                                    key={expense.id}
                                    className="w-full text-left py-3 flex items-start lg:items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 -mx-2 px-2 rounded gap-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
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
                                </button>
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
                    <div className="flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t">
                        <button
                            onClick={() => setIsBalancesExpanded(!isBalancesExpanded)}
                            className="flex-1 p-4 lg:p-6 text-left focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700"
                            aria-expanded={isBalancesExpanded}
                            aria-controls="balances-section"
                        >
                            <div className="flex items-center justify-between">
                                <div>
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
                                <div className="flex items-center gap-4">
                                    {/* Spacer for when currency toggle is visible to prevent jumpiness,
                                        though in this layout it might not be strictly necessary as toggle is absolute or flexed.
                                        But here we just want the +/- to be part of the button visually.
                                    */}
                                </div>
                            </div>
                        </button>

                        <div className="flex items-center gap-4 pr-4 lg:pr-6 pointer-events-none">
                            {isBalancesExpanded && group?.default_currency && balances.length > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowInGroupCurrency(!showInGroupCurrency);
                                    }}
                                    className="pointer-events-auto text-xs px-2 lg:px-3 py-1 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded border border-gray-300 dark:border-gray-600 whitespace-nowrap z-10"
                                >
                                    {showInGroupCurrency
                                        ? `By currency`
                                        : `In ${group.default_currency}`}
                                </button>
                            )}
                            <span
                                className="text-gray-400 dark:text-gray-500 text-xl pointer-events-none"
                                aria-hidden="true"
                            >
                                {isBalancesExpanded ? '−' : '+'}
                            </span>
                        </div>
                    </div>

                    {isBalancesExpanded && (
                        <div id="balances-section" className="px-4 lg:px-6 pb-4 lg:pb-6 border-t dark:border-gray-700">
                            {balances.length === 0 ? (
                                <p className="text-gray-500 dark:text-gray-400 italic text-sm mt-4">No balances yet</p>
                            ) : (
                                <div className="mt-4">
                                    {renderBalances()}

                                    {/* Simplify Debts Button */}
                                    {!isPublicView && balances.some(b => b.amount !== 0) && (
                                        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                                            <button
                                                onClick={() => setIsSimplifyDebtsModalOpen(true)}
                                                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 font-medium"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                                </svg>
                                                <span>Simplify Debts</span>
                                            </button>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                                Calculate the minimum transactions needed to settle all balances
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Members Section - Collapsible */}
                <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50">
                    <button
                        onClick={() => setIsMembersExpanded(!isMembersExpanded)}
                        className="w-full p-4 lg:p-6 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700"
                        aria-expanded={isMembersExpanded}
                        aria-controls="members-section"
                    >
                        <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                            Members ({(group.members || []).length + (group.guests?.length || 0)})
                        </h2>
                        <span className="text-gray-400 dark:text-gray-500 text-xl" aria-hidden="true">
                            {isMembersExpanded ? '−' : '+'}
                        </span>
                    </button>

                    {isMembersExpanded && (
                        <div id="members-section" className="px-4 lg:px-6 pb-4 lg:pb-6 border-t dark:border-gray-700">
                            {/* Splitwisers Section */}
                            {(group.members || []).length > 0 && (
                                <div className="mt-4">
                                    <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">
                                        Splitwisers
                                    </h3>
                                    <ul className="space-y-2 lg:space-y-3">
                                        {(group.members || []).sort((a, b) => a.full_name.localeCompare(b.full_name)).map(member => (
                                            <li key={member.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700 rounded">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-gray-900 dark:text-gray-100">{member.full_name}</span>
                                                        {member.user_id === group.created_by_id && (
                                                            <span className="px-2 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-xs rounded">
                                                                owner
                                                            </span>
                                                        )}
                                                        {member.user_id === user?.id && (
                                                            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded">
                                                                you
                                                            </span>
                                                        )}
                                                    </div>
                                                    {member.managed_by_name && (
                                                        <span className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                                            Managed by {member.managed_by_name}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex gap-2">
                                                    {!isPublicView && (
                                                        <button
                                                            onClick={() => {
                                                                setSelectedMember(member);
                                                                setIsManageMemberModalOpen(true);
                                                            }}
                                                            className="text-xs px-2 py-1 text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded"
                                                            title={member.managed_by_id ? "Change manager" : "Set manager"}
                                                        >
                                                            {member.managed_by_id ? 'Change' : 'Manage'}
                                                        </button>
                                                    )}
                                                    {member.user_id !== group.created_by_id && (isOwner || member.user_id === user?.id) && (
                                                        <button
                                                            onClick={() => handleRemoveMember(member.user_id)}
                                                            className="text-xs px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                                        >
                                                            {member.user_id === user?.id ? 'Leave' : 'Remove'}
                                                        </button>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Guests Section */}
                            {(group.guests || []).length > 0 && (
                                <div className="mt-6">
                                    <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">
                                        Guests
                                    </h3>
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
                                                        onClick={() => {
                                                            if (isPublicView) {
                                                                // Redirect to register with params
                                                                navigate(`/register?claim_guest_id=${guest.id}&share_link_id=${shareLinkId}`);
                                                            } else {
                                                                handleClaimGuest(guest.id);
                                                            }
                                                        }}
                                                        className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                                        title="Claim this guest"
                                                    >
                                                        Claim
                                                    </button>
                                                    {!isPublicView && (
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
                                                    )}
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
                                </div>
                            )}

                            {/* Action buttons */}
                            {!isPublicView && (
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
                            )}
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
                groupGuests={(group.guests || [])}
                currentUserId={user?.id || 0}
                shareLinkId={isPublicView ? shareLinkId : undefined}
                readOnly={isPublicView}
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

            <ManageMemberModal
                isOpen={isManageMemberModalOpen}
                onClose={() => {
                    setIsManageMemberModalOpen(false);
                    setSelectedMember(null);
                }}
                member={selectedMember}
                groupId={groupId || ''}
                groupMembers={group?.members || []}
                groupGuests={group?.guests || []}
                onMemberUpdated={() => {
                    fetchGroupData();
                    setIsManageMemberModalOpen(false);
                    setSelectedMember(null);
                }}
            />

            {/* Alert Dialog */}
            <AlertDialog
                isOpen={alertDialog.isOpen}
                onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
                onConfirm={alertDialog.onConfirm}
                title={alertDialog.title}
                message={alertDialog.message}
                type={alertDialog.type}
            />

            {/* Simplify Debts Modal */}
            {group && (
                <SimplifyDebtsModal
                    isOpen={isSimplifyDebtsModalOpen}
                    onClose={() => setIsSimplifyDebtsModalOpen(false)}
                    groupId={parseInt(groupId || '0')}
                    members={group.members}
                    guests={group.guests}
                    onPaymentCreated={() => {
                        // Refresh balances and expenses after payment is created
                        fetchGroupData();
                    }}
                />
            )}
        </div>
    );
};

export default GroupDetailPage;
