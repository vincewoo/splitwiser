import React, { useState, useEffect } from 'react';

interface ExpenseSplit {
    id: number;
    expense_id: number;
    user_id: number;
    is_guest: boolean;
    amount_owed: number;
    percentage: number | null;
    shares: number | null;
    user_name: string;
}

interface ExpenseWithSplits {
    id: number;
    description: string;
    amount: number;
    currency: string;
    date: string;
    payer_id: number;
    payer_is_guest: boolean;
    group_id: number | null;
    created_by_id: number | null;
    splits: ExpenseSplit[];
    split_type: string;
}

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

interface Participant {
    id: number;
    name: string;
    isGuest: boolean;
}

interface ExpenseDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    expenseId: number | null;
    onExpenseUpdated: () => void;
    onExpenseDeleted: () => void;
    groupMembers: GroupMember[];
    groupGuests: GuestMember[];
    currentUserId: number;
}

const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
    isOpen,
    onClose,
    expenseId,
    onExpenseUpdated,
    onExpenseDeleted,
    groupMembers,
    groupGuests,
    currentUserId
}) => {
    const [expense, setExpense] = useState<ExpenseWithSplits | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Edit form state
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [expenseDate, setExpenseDate] = useState('');
    const [payerId, setPayerId] = useState<number>(0);
    const [payerIsGuest, setPayerIsGuest] = useState(false);
    const [splitType, setSplitType] = useState('EQUAL');
    const [splitDetails, setSplitDetails] = useState<{[key: string]: number}>({});
    const [selectedParticipantKeys, setSelectedParticipantKeys] = useState<string[]>([]);

    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD'];

    useEffect(() => {
        if (isOpen && expenseId) {
            fetchExpense();
        }
    }, [isOpen, expenseId]);

    useEffect(() => {
        if (expense) {
            populateFormFromExpense(expense);
        }
    }, [expense]);

    useEffect(() => {
        // Reset split details when split type changes (but only in edit mode)
        if (isEditing) {
            setSplitDetails({});
        }
    }, [splitType]);

    const fetchExpense = async () => {
        setIsLoading(true);
        setError(null);
        const token = localStorage.getItem('token');

        try {
            const response = await fetch(`http://localhost:8000/expenses/${expenseId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch expense');
            }

            const data = await response.json();
            setExpense(data);
        } catch (err) {
            setError('Failed to load expense details');
        } finally {
            setIsLoading(false);
        }
    };

    const populateFormFromExpense = (exp: ExpenseWithSplits) => {
        setDescription(exp.description);
        setAmount((exp.amount / 100).toFixed(2));
        setCurrency(exp.currency);
        setExpenseDate(exp.date.split('T')[0]);
        setPayerId(exp.payer_id);
        setPayerIsGuest(exp.payer_is_guest);
        setSplitType(exp.split_type || 'EQUAL');

        // Set selected participants from splits
        const keys = exp.splits.map(s => s.is_guest ? `guest_${s.user_id}` : `user_${s.user_id}`);
        setSelectedParticipantKeys(keys);

        // Set split details for non-EQUAL types
        const details: {[key: string]: number} = {};
        exp.splits.forEach(s => {
            const key = s.is_guest ? `guest_${s.user_id}` : `user_${s.user_id}`;
            if (exp.split_type === 'PERCENT' && s.percentage !== null) {
                details[key] = s.percentage;
            } else if (exp.split_type === 'SHARES' && s.shares !== null) {
                details[key] = s.shares;
            } else if (exp.split_type === 'EXACT') {
                details[key] = s.amount_owed / 100;
            }
        });
        setSplitDetails(details);
    };

    const formatMoney = (amount: number, curr: string) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(amount / 100);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const getPayerName = () => {
        if (!expense) return '';
        if (expense.payer_is_guest) {
            const guest = groupGuests.find(g => g.id === expense.payer_id);
            return guest?.name || 'Unknown Guest';
        }
        if (expense.payer_id === currentUserId) return 'You';
        const member = groupMembers.find(m => m.user_id === expense.payer_id);
        return member?.full_name || 'Unknown';
    };

    const getAllParticipants = (): Participant[] => {
        const participants: Participant[] = [];

        selectedParticipantKeys.forEach(key => {
            const [type, idStr] = key.split('_');
            const id = parseInt(idStr);

            if (type === 'guest') {
                const guest = groupGuests.find(g => g.id === id);
                if (guest) {
                    participants.push({ id: guest.id, name: guest.name, isGuest: true });
                }
            } else {
                const member = groupMembers.find(m => m.user_id === id);
                if (member) {
                    participants.push({
                        id: member.user_id,
                        name: member.user_id === currentUserId ? 'You' : member.full_name,
                        isGuest: false
                    });
                }
            }
        });

        return participants;
    };

    const getPotentialPayers = (): Participant[] => {
        return getAllParticipants();
    };

    const toggleParticipant = (key: string) => {
        if (selectedParticipantKeys.includes(key)) {
            setSelectedParticipantKeys(selectedParticipantKeys.filter(k => k !== key));
            const newDetails = {...splitDetails};
            delete newDetails[key];
            setSplitDetails(newDetails);
        } else {
            setSelectedParticipantKeys([...selectedParticipantKeys, key]);
        }
    };

    const handleSplitDetailChange = (key: string, value: string) => {
        setSplitDetails({...splitDetails, [key]: parseFloat(value) || 0});
    };

    const handleSave = async () => {
        const totalAmountCents = Math.round(parseFloat(amount) * 100);
        const participants = getAllParticipants();
        let splits: { user_id: number; is_guest: boolean; amount_owed: number; percentage?: number; shares?: number }[] = [];

        if (splitType === 'EQUAL') {
            const splitAmount = Math.floor(totalAmountCents / participants.length);
            const remainder = totalAmountCents - (splitAmount * participants.length);
            splits = participants.map((p, index) => ({
                user_id: p.id,
                is_guest: p.isGuest,
                amount_owed: splitAmount + (index === 0 ? remainder : 0)
            }));
        } else if (splitType === 'EXACT') {
            splits = participants.map(p => {
                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                return {
                    user_id: p.id,
                    is_guest: p.isGuest,
                    amount_owed: Math.round((splitDetails[key] || 0) * 100)
                };
            });
            const sum = splits.reduce((acc, s) => acc + s.amount_owed, 0);
            if (Math.abs(sum - totalAmountCents) > 1) {
                alert(`Amounts do not sum to total. Total: ${totalAmountCents/100}, Sum: ${sum/100}`);
                return;
            }
        } else if (splitType === 'PERCENT') {
            const shares = participants.map(p => {
                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                return { participant: p, percent: splitDetails[key] || 0 };
            });
            const percentSum = shares.reduce((acc, s) => acc + s.percent, 0);
            if (Math.abs(percentSum - 100) > 0.1) {
                alert(`Percentages must sum to 100%. Current: ${percentSum}%`);
                return;
            }
            let runningTotal = 0;
            splits = shares.map((s, index) => {
                if (index === shares.length - 1) {
                    return {
                        user_id: s.participant.id,
                        is_guest: s.participant.isGuest,
                        amount_owed: totalAmountCents - runningTotal,
                        percentage: Math.round(s.percent)
                    };
                }
                const share = Math.round(totalAmountCents * (s.percent / 100));
                runningTotal += share;
                return {
                    user_id: s.participant.id,
                    is_guest: s.participant.isGuest,
                    amount_owed: share,
                    percentage: Math.round(s.percent)
                };
            });
        } else if (splitType === 'SHARES') {
            const sharesMap = participants.map(p => {
                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                return { participant: p, shares: splitDetails[key] || 0 };
            });
            const totalShares = sharesMap.reduce((acc, s) => acc + s.shares, 0);
            if (totalShares === 0) {
                alert("Total shares cannot be zero");
                return;
            }
            let runningTotal = 0;
            splits = sharesMap.map((s, index) => {
                if (index === sharesMap.length - 1) {
                    return {
                        user_id: s.participant.id,
                        is_guest: s.participant.isGuest,
                        amount_owed: totalAmountCents - runningTotal,
                        shares: Math.round(s.shares)
                    };
                }
                const shareAmount = Math.round(totalAmountCents * (s.shares / totalShares));
                runningTotal += shareAmount;
                return {
                    user_id: s.participant.id,
                    is_guest: s.participant.isGuest,
                    amount_owed: shareAmount,
                    shares: Math.round(s.shares)
                };
            });
        }

        const payload = {
            description,
            amount: totalAmountCents,
            currency,
            date: new Date(expenseDate).toISOString(),
            payer_id: payerId,
            payer_is_guest: payerIsGuest,
            splits,
            split_type: splitType
        };

        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/expenses/${expenseId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            setIsEditing(false);
            onExpenseUpdated();
            onClose();
        } else {
            const err = await response.json();
            alert(`Failed to update expense: ${err.detail}`);
        }
    };

    const handleDelete = async () => {
        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/expenses/${expenseId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });

        if (response.ok) {
            onExpenseDeleted();
            onClose();
        } else {
            const err = await response.json();
            alert(`Failed to delete expense: ${err.detail}`);
        }
    };

    const handleClose = () => {
        setIsEditing(false);
        setShowDeleteConfirm(false);
        setError(null);
        onClose();
    };

    if (!isOpen) return null;

    const canEdit = expense?.created_by_id === currentUserId;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-40">
            <div className="bg-white p-5 rounded-lg shadow-xl w-96 max-h-[90vh] overflow-y-auto">
                {isLoading ? (
                    <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : error ? (
                    <div className="text-center py-8">
                        <div className="text-red-500 mb-4">{error}</div>
                        <button onClick={handleClose} className="text-teal-600 hover:text-teal-800">Close</button>
                    </div>
                ) : expense ? (
                    <>
                        {/* Header */}
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">
                                {isEditing ? 'Edit Expense' : 'Expense Details'}
                            </h2>
                            {canEdit && !isEditing && !showDeleteConfirm && (
                                <div className="flex space-x-2">
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="text-xs bg-teal-100 text-teal-700 px-2 py-1 rounded hover:bg-teal-200"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(true)}
                                        className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200"
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Delete Confirmation */}
                        {showDeleteConfirm && (
                            <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
                                <p className="text-sm text-red-800 mb-3">
                                    Are you sure you want to delete this expense? This cannot be undone.
                                </p>
                                <div className="flex space-x-2">
                                    <button
                                        onClick={handleDelete}
                                        className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {isEditing ? (
                            /* Edit Mode */
                            <div>
                                <div className="mb-4">
                                    <label className="block text-gray-700 text-sm font-bold mb-2">Description:</label>
                                    <input
                                        type="text"
                                        className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500"
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="mb-4 flex items-center space-x-2">
                                    <select
                                        value={currency}
                                        onChange={(e) => setCurrency(e.target.value)}
                                        className="border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 bg-transparent"
                                    >
                                        {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 text-lg"
                                        value={amount}
                                        onChange={e => setAmount(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="mb-4">
                                    <label className="block text-gray-700 text-sm font-bold mb-2">Date:</label>
                                    <input
                                        type="date"
                                        className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500"
                                        value={expenseDate}
                                        onChange={(e) => setExpenseDate(e.target.value)}
                                        required
                                    />
                                </div>

                                <div className="mb-4">
                                    <label className="block text-gray-700 text-sm font-bold mb-2">Participants:</label>
                                    <div className="flex flex-wrap gap-2">
                                        {groupMembers.map(member => {
                                            const key = `user_${member.user_id}`;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => toggleParticipant(key)}
                                                    className={`px-3 py-1 rounded-full text-xs border ${selectedParticipantKeys.includes(key) ? 'bg-teal-100 border-teal-500 text-teal-700' : 'bg-gray-100 border-gray-300'}`}
                                                >
                                                    {member.user_id === currentUserId ? 'You' : member.full_name}
                                                </button>
                                            );
                                        })}
                                        {groupGuests.map(guest => {
                                            const key = `guest_${guest.id}`;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => toggleParticipant(key)}
                                                    className={`px-3 py-1 rounded-full text-xs border ${selectedParticipantKeys.includes(key) ? 'bg-orange-100 border-orange-500 text-orange-700' : 'bg-gray-100 border-gray-300'}`}
                                                >
                                                    {guest.name} <span className="text-gray-400">(guest)</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {selectedParticipantKeys.length > 0 && (
                                    <div className="mb-4">
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Paid by:</label>
                                        <select
                                            value={payerIsGuest ? `guest_${payerId}` : `user_${payerId}`}
                                            onChange={(e) => {
                                                const [type, id] = e.target.value.split('_');
                                                setPayerId(parseInt(id));
                                                setPayerIsGuest(type === 'guest');
                                            }}
                                            className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 bg-white"
                                        >
                                            {getPotentialPayers().map(p => (
                                                <option key={p.isGuest ? `guest_${p.id}` : `user_${p.id}`} value={p.isGuest ? `guest_${p.id}` : `user_${p.id}`}>
                                                    {p.name}{p.isGuest ? ' (guest)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="mb-4">
                                    <label className="block text-gray-700 text-sm font-bold mb-2">Split by:</label>
                                    <div className="flex space-x-2 mb-2">
                                        {['EQUAL', 'EXACT', 'PERCENT', 'SHARES'].map(type => (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => setSplitType(type)}
                                                className={`px-2 py-1 text-xs rounded border ${splitType === type ? 'bg-teal-500 text-white' : 'bg-white text-gray-600'}`}
                                            >
                                                {type}
                                            </button>
                                        ))}
                                    </div>

                                    {splitType !== 'EQUAL' && (
                                        <div className="bg-gray-50 p-2 rounded space-y-2">
                                            {getAllParticipants().map(p => {
                                                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                                                return (
                                                    <div key={key} className="flex items-center justify-between">
                                                        <span className="text-sm">
                                                            {p.name}
                                                            {p.isGuest && <span className="text-orange-500 ml-1">(guest)</span>}
                                                        </span>
                                                        <div className="flex items-center">
                                                            <input
                                                                type="number"
                                                                className="w-16 border rounded p-1 text-sm text-right"
                                                                placeholder="0"
                                                                value={splitDetails[key] || ''}
                                                                onChange={(e) => handleSplitDetailChange(key, e.target.value)}
                                                            />
                                                            <span className="ml-1 text-xs text-gray-500">
                                                                {splitType === 'PERCENT' ? '%' : splitType === 'SHARES' ? 'shares' : currency}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-end space-x-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsEditing(false);
                                            if (expense) populateFormFromExpense(expense);
                                        }}
                                        className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* View Mode */
                            <div>
                                <div className="mb-6">
                                    <h3 className="text-2xl font-semibold text-gray-900 mb-1">{expense.description}</h3>
                                    <p className="text-3xl font-bold text-gray-900">
                                        {formatMoney(expense.amount, expense.currency)}
                                    </p>
                                </div>

                                <div className="space-y-3 mb-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Date</span>
                                        <span className="text-gray-900">{formatDate(expense.date)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Paid by</span>
                                        <span className="text-gray-900">{getPayerName()}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Split type</span>
                                        <span className="text-gray-900">{expense.split_type}</span>
                                    </div>
                                </div>

                                <div className="border-t pt-4">
                                    <h4 className="text-sm font-bold text-gray-700 mb-3">Split Breakdown</h4>
                                    <div className="space-y-2">
                                        {expense.splits.map(split => (
                                            <div key={split.id} className="flex justify-between items-center text-sm">
                                                <span className="text-gray-700">
                                                    {split.user_id === currentUserId && !split.is_guest ? 'You' : split.user_name}
                                                    {split.is_guest && <span className="text-orange-500 ml-1">(guest)</span>}
                                                </span>
                                                <span className="text-gray-900 font-medium">
                                                    {formatMoney(split.amount_owed, expense.currency)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex justify-end mt-6">
                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default ExpenseDetailModal;
