import React, { useState, useEffect } from 'react';
import ParticipantSelector from './ParticipantSelector';

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

interface ItemAssignment {
    user_id: number;
    is_guest: boolean;
    user_name: string;
}

interface ExpenseItemDetail {
    id: number;
    expense_id: number;
    description: string;
    price: number;
    is_tax_tip: boolean;
    assignments: ItemAssignment[];
}

interface ExpenseItem {
    description: string;
    price: number;
    is_tax_tip: boolean;
    assignments: { user_id: number; is_guest: boolean }[];
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
    items?: ExpenseItemDetail[];
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

    // Itemized expense state
    const [itemizedItems, setItemizedItems] = useState<ExpenseItem[]>([]);
    const [taxTipAmount, setTaxTipAmount] = useState<string>('');
    const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
    const [showParticipantSelector, setShowParticipantSelector] = useState(false);

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

        // Handle ITEMIZED expenses
        if (exp.split_type === 'ITEMIZED' && exp.items) {
            // Convert ExpenseItemDetail to ExpenseItem (editable format)
            const regularItems = exp.items.filter(i => !i.is_tax_tip);
            const taxTipItems = exp.items.filter(i => i.is_tax_tip);

            const editableItems: ExpenseItem[] = regularItems.map(item => ({
                description: item.description,
                price: item.price,
                is_tax_tip: false,
                assignments: item.assignments.map(a => ({
                    user_id: a.user_id,
                    is_guest: a.is_guest
                }))
            }));

            setItemizedItems(editableItems);

            // Sum tax/tip items
            const taxTipTotal = taxTipItems.reduce((sum, item) => sum + item.price, 0);
            setTaxTipAmount(taxTipTotal > 0 ? (taxTipTotal / 100).toFixed(2) : '');
        } else {
            setItemizedItems([]);
            setTaxTipAmount('');
        }
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

    // Helper to determine if we should use compact mode
    const shouldUseCompactMode = () => {
        const participants = getAllParticipants();
        return participants.length > 5;
    };

    // Helper to get assignment display text
    const getAssignmentDisplayText = (assignments: { user_id: number; is_guest: boolean }[]): string => {
        const participants = getAllParticipants();

        if (assignments.length === 0) {
            return 'No one selected';
        }

        if (assignments.length === participants.length) {
            return `All ${participants.length} people`;
        }

        const names = assignments.map(a => {
            const p = participants.find(p => p.id === a.user_id && p.isGuest === a.is_guest);
            return p ? p.name : '';
        }).filter(n => n);

        if (names.length <= 2) {
            return names.join(', ');
        }

        return `${names[0]}, ${names[1]} +${names.length - 2} more`;
    };

    const handleParticipantSelectorConfirm = (itemIdx: number, selectedParticipants: Participant[]) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = {...updated[itemIdx]};
            item.assignments = selectedParticipants.map(p => ({
                user_id: p.id,
                is_guest: p.isGuest
            }));
            updated[itemIdx] = item;
            return updated;
        });
        setEditingItemIndex(null);
    };

    const handleMainParticipantSelectorConfirm = (selectedParticipants: Participant[]) => {
        // Set new selections based on selected participants
        const keys = selectedParticipants.map(p =>
            p.isGuest ? `guest_${p.id}` : `user_${p.id}`
        );
        setSelectedParticipantKeys(keys);
        setShowParticipantSelector(false);
    };

    const getSelectedParticipantsDisplay = (): string => {
        const total = selectedParticipantKeys.length;

        if (total === 0) {
            return 'Select people';
        }

        const participants = getAllParticipants();

        if (total === 1) {
            const p = participants[0];
            return p?.name || 'Unknown';
        }

        return `${total} people selected`;
    };

    const getAvailableParticipants = (): Participant[] => {
        const participants: Participant[] = [];

        groupMembers.forEach(m => {
            participants.push({
                id: m.user_id,
                name: m.user_id === currentUserId ? 'You' : m.full_name,
                isGuest: false
            });
        });

        groupGuests.forEach(g => {
            participants.push({
                id: g.id,
                name: g.name,
                isGuest: true
            });
        });

        return participants;
    };

    // Itemized expense helpers
    const toggleItemAssignment = (itemIdx: number, participant: Participant) => {
        setItemizedItems(prev => {
            const updated = [...prev];
            const item = {...updated[itemIdx]};

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

    const addManualItem = () => {
        const itemDescription = prompt("Item description:");
        if (!itemDescription) return;

        const priceStr = prompt("Price (in dollars, e.g., 12.99):");
        if (!priceStr) return;

        const price = Math.round(parseFloat(priceStr) * 100);
        if (isNaN(price) || price <= 0) {
            alert("Invalid price");
            return;
        }

        setItemizedItems(prev => [...prev, {
            description: itemDescription,
            price,
            is_tax_tip: false,
            assignments: []
        }]);
    };

    const removeItem = (idx: number) => {
        setItemizedItems(prev => prev.filter((_, i) => i !== idx));
    };

    const calculateItemizedTotal = (): string => {
        const itemsTotal = itemizedItems.reduce((sum, item) => sum + item.price, 0);
        const taxTip = Math.round(parseFloat(taxTipAmount || '0') * 100);
        return ((itemsTotal + taxTip) / 100).toFixed(2);
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

        // Build payload - handle ITEMIZED differently
        let payload: any = {
            description,
            amount: totalAmountCents,
            currency,
            date: new Date(expenseDate).toISOString(),
            payer_id: payerId,
            payer_is_guest: payerIsGuest,
            splits,
            split_type: splitType
        };

        if (splitType === 'ITEMIZED') {
            // Validate all items have assignments
            const unassigned = itemizedItems.filter(
                item => !item.is_tax_tip && item.assignments.length === 0
            );
            if (unassigned.length > 0) {
                alert(`Please assign all items. Unassigned: ${unassigned.map(i => i.description).join(', ')}`);
                return;
            }

            // Check for participants with no items assigned
            const allParticipants = getAllParticipants();
            const participantsWithItems = new Set<string>();
            itemizedItems.forEach(item => {
                item.assignments.forEach(a => {
                    const key = a.is_guest ? `guest_${a.user_id}` : `user_${a.user_id}`;
                    participantsWithItems.add(key);
                });
            });

            const participantsWithoutItems = allParticipants.filter(p => {
                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                return !participantsWithItems.has(key);
            });

            if (participantsWithoutItems.length > 0) {
                const names = participantsWithoutItems.map(p => p.name).join(', ');
                const proceed = window.confirm(
                    `Warning: The following participant(s) have no items assigned and will not be included in this expense:\n\n${names}\n\nDo you want to continue?`
                );
                if (!proceed) {
                    return;
                }
            }

            // Prepare items with tax/tip
            const allItems = [...itemizedItems];
            const taxTip = Math.round(parseFloat(taxTipAmount || '0') * 100);
            if (taxTip > 0) {
                allItems.push({
                    description: 'Tax/Tip',
                    price: taxTip,
                    is_tax_tip: true,
                    assignments: []
                });
            }

            const itemsTotal = allItems.reduce((sum, item) => sum + item.price, 0);

            payload = {
                description,
                amount: itemsTotal,
                currency,
                date: new Date(expenseDate).toISOString(),
                payer_id: payerId,
                payer_is_guest: payerIsGuest,
                split_type: 'ITEMIZED',
                items: allItems,
                splits: []
            };
        }

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
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-40 p-0 sm:p-4">
            {showParticipantSelector && (
                <ParticipantSelector
                    isOpen={true}
                    onClose={() => setShowParticipantSelector(false)}
                    participants={getAvailableParticipants()}
                    selectedParticipants={getAllParticipants()}
                    onConfirm={handleMainParticipantSelectorConfirm}
                    itemDescription="Select participants for this expense"
                />
            )}
            {editingItemIndex !== null && (
                <ParticipantSelector
                    isOpen={true}
                    onClose={() => setEditingItemIndex(null)}
                    participants={getAllParticipants()}
                    selectedParticipants={getAllParticipants().filter(p => {
                        const item = itemizedItems[editingItemIndex];
                        return item?.assignments.some(a => a.user_id === p.id && a.is_guest === p.isGuest);
                    })}
                    onConfirm={(selected) => handleParticipantSelectorConfirm(editingItemIndex, selected)}
                    itemDescription={itemizedItems[editingItemIndex]?.description || ''}
                />
            )}
            <div className="bg-white w-full h-full sm:w-full sm:max-w-md sm:h-auto sm:max-h-[90vh] sm:rounded-lg shadow-xl overflow-y-auto flex flex-col">
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
                        <div className="sticky top-0 bg-white z-10 p-4 sm:p-5 border-b border-gray-200 flex justify-between items-center">
                            <h2 className="text-xl font-bold">
                                {isEditing ? 'Edit Expense' : 'Expense Details'}
                            </h2>
                            {canEdit && !isEditing && !showDeleteConfirm && (
                                <div className="flex space-x-2">
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="text-sm bg-teal-100 text-teal-700 px-3 py-2 rounded hover:bg-teal-200 min-h-[44px]"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(true)}
                                        className="text-sm bg-red-100 text-red-700 px-3 py-2 rounded hover:bg-red-200 min-h-[44px]"
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Delete Confirmation */}
                        {showDeleteConfirm && (
                            <div className="bg-red-50 border border-red-200 rounded p-4 m-4 sm:m-5">
                                <p className="text-sm text-red-800 mb-3">
                                    Are you sure you want to delete this expense? This cannot be undone.
                                </p>
                                <div className="flex space-x-2">
                                    <button
                                        onClick={handleDelete}
                                        className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600 min-h-[44px]"
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 min-h-[44px]"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {isEditing ? (
                            /* Edit Mode */
                            <div className="flex-1 flex flex-col">
                            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
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
                                        className={`w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 text-lg ${splitType === 'ITEMIZED' ? 'bg-gray-100 text-gray-500' : ''}`}
                                        value={splitType === 'ITEMIZED' ? calculateItemizedTotal() : amount}
                                        onChange={e => setAmount(e.target.value)}
                                        disabled={splitType === 'ITEMIZED'}
                                        required={splitType !== 'ITEMIZED'}
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
                                    {getAvailableParticipants().length > 6 ? (
                                        /* Compact mode for large groups */
                                        <button
                                            type="button"
                                            onClick={() => setShowParticipantSelector(true)}
                                            className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 text-left flex items-center justify-between min-h-[44px]"
                                        >
                                            <span className="text-sm">
                                                {getSelectedParticipantsDisplay()}
                                            </span>
                                            <svg className="w-5 h-5 text-gray-400" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                                                <path d="M9 5l7 7-7 7"></path>
                                            </svg>
                                        </button>
                                    ) : (
                                        /* Inline buttons for small groups */
                                        <div className="flex flex-wrap gap-2">
                                            {groupMembers.map(member => {
                                                const key = `user_${member.user_id}`;
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        onClick={() => toggleParticipant(key)}
                                                        className={`px-4 py-2 rounded-full text-sm border min-h-[44px] ${selectedParticipantKeys.includes(key) ? 'bg-teal-100 border-teal-500 text-teal-700' : 'bg-gray-100 border-gray-300'}`}
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
                                                        className={`px-4 py-2 rounded-full text-sm border min-h-[44px] ${selectedParticipantKeys.includes(key) ? 'bg-orange-100 border-orange-500 text-orange-700' : 'bg-gray-100 border-gray-300'}`}
                                                    >
                                                        {guest.name} <span className="text-gray-400">(guest)</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
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
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {['EQUAL', 'EXACT', 'PERCENT', 'SHARES', 'ITEMIZED'].map(type => (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => setSplitType(type)}
                                                className={`px-4 py-2 text-sm rounded border min-h-[44px] ${splitType === type ? 'bg-teal-500 text-white' : 'bg-white text-gray-600'}`}
                                            >
                                                {type}
                                            </button>
                                        ))}
                                    </div>

                                    {splitType === 'ITEMIZED' && (
                                        <div className="bg-gray-50 p-3 rounded">
                                            <div className="flex justify-between items-center mb-3">
                                                <p className="font-semibold text-sm">Assign Items</p>
                                                <button
                                                    type="button"
                                                    onClick={addManualItem}
                                                    className="text-sm text-teal-600 hover:text-teal-800 px-3 py-2 min-h-[44px]"
                                                >
                                                    + Add Item
                                                </button>
                                            </div>

                                            {itemizedItems.length === 0 ? (
                                                <p className="text-sm text-gray-500 text-center py-4">
                                                    No items yet. Add items manually.
                                                </p>
                                            ) : (
                                                <div className="space-y-3">
                                                    {itemizedItems.map((item, idx) => (
                                                        <div key={idx} className={`bg-white p-3 rounded border ${item.assignments.length === 0 ? 'border-red-300' : 'border-gray-200'}`}>
                                                            <div className="flex justify-between items-center mb-3">
                                                                <span className="font-medium text-sm flex-1 pr-2">{item.description}</span>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-sm text-gray-600 font-semibold whitespace-nowrap">
                                                                        ${(item.price / 100).toFixed(2)}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeItem(idx)}
                                                                        className="text-red-400 hover:text-red-600 text-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
                                                                    >
                                                                        ×
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* Participant Selection - Adaptive UI */}
                                                            {shouldUseCompactMode() ? (
                                                                /* Compact mode for large groups */
                                                                <div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setEditingItemIndex(idx)}
                                                                        className={`w-full px-4 py-3 rounded-lg border text-left flex items-center justify-between min-h-[44px] ${
                                                                            item.assignments.length === 0
                                                                                ? 'border-red-300 bg-red-50 text-red-700'
                                                                                : 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100'
                                                                        }`}
                                                                    >
                                                                        <span className="text-sm">
                                                                            {getAssignmentDisplayText(item.assignments)}
                                                                        </span>
                                                                        <svg className="w-5 h-5 text-gray-400" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path d="M9 5l7 7-7 7"></path>
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                /* Inline buttons for small groups */
                                                                <div className="flex flex-wrap gap-2">
                                                                    {getAllParticipants().map(p => {
                                                                        const isAssigned = item.assignments.some(
                                                                            a => a.user_id === p.id && a.is_guest === p.isGuest
                                                                        );

                                                                        return (
                                                                            <button
                                                                                key={p.isGuest ? `guest_${p.id}` : `user_${p.id}`}
                                                                                type="button"
                                                                                onClick={() => toggleItemAssignment(idx, p)}
                                                                                className={`px-3 py-2 text-sm rounded-full border min-h-[44px] ${
                                                                                    isAssigned
                                                                                        ? 'bg-teal-100 border-teal-500 text-teal-700'
                                                                                        : 'bg-gray-50 border-gray-300 text-gray-500'
                                                                                }`}
                                                                            >
                                                                                {p.name}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="mt-3 pt-3 border-t">
                                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                    <span className="text-sm text-gray-600">Tax/Tip (split proportionally)</span>
                                                    <div className="flex items-center">
                                                        <span className="text-sm mr-2">{currency}</span>
                                                        <input
                                                            type="number"
                                                            placeholder="0.00"
                                                            step="0.01"
                                                            className="w-28 sm:w-24 border rounded p-2 text-sm text-right min-h-[44px]"
                                                            value={taxTipAmount}
                                                            onChange={(e) => setTaxTipAmount(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-3 text-right text-base font-semibold">
                                                Total: {currency} {calculateItemizedTotal()}
                                            </div>
                                        </div>
                                    )}

                                    {splitType !== 'EQUAL' && splitType !== 'ITEMIZED' && (
                                        <div className="bg-gray-50 p-3 rounded space-y-3">
                                            {getAllParticipants().map(p => {
                                                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                                                return (
                                                    <div key={key} className="flex items-center justify-between gap-3">
                                                        <span className="text-sm flex-1">
                                                            {p.name}
                                                            {p.isGuest && <span className="text-orange-500 ml-1">(guest)</span>}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                className="w-24 border rounded p-2 text-sm text-right min-h-[44px]"
                                                                placeholder="0"
                                                                value={splitDetails[key] || ''}
                                                                onChange={(e) => handleSplitDetailChange(key, e.target.value)}
                                                            />
                                                            <span className="text-sm text-gray-500 w-16">
                                                                {splitType === 'PERCENT' ? '%' : splitType === 'SHARES' ? 'shares' : currency}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                                <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 sm:p-5 flex justify-end space-x-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsEditing(false);
                                            if (expense) populateFormFromExpense(expense);
                                        }}
                                        className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded min-h-[44px]"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 min-h-[44px]"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* View Mode */
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 overflow-y-auto p-4 sm:p-5">
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

                                {/* Itemized breakdown for ITEMIZED expenses */}
                                {expense.split_type === 'ITEMIZED' && expense.items && expense.items.length > 0 && (
                                    <div className="border-t pt-4 mb-4">
                                        <h4 className="text-sm font-bold text-gray-700 mb-3">Items</h4>
                                        <div className="space-y-2">
                                            {expense.items.filter(i => !i.is_tax_tip).map(item => (
                                                <div key={item.id} className="flex justify-between items-start text-sm">
                                                    <div>
                                                        <span className="text-gray-700">{item.description}</span>
                                                        <div className="text-xs text-gray-500">
                                                            {item.assignments.map(a => a.user_name).join(', ')}
                                                        </div>
                                                    </div>
                                                    <span className="text-gray-600">
                                                        {formatMoney(item.price, expense.currency)}
                                                    </span>
                                                </div>
                                            ))}
                                            {expense.items.filter(i => i.is_tax_tip).map(item => (
                                                <div key={item.id} className="flex justify-between text-sm text-gray-500 italic">
                                                    <span>{item.description}</span>
                                                    <span>{formatMoney(item.price, expense.currency)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

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
                                </div>

                                <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 sm:p-5 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded min-h-[44px]"
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
