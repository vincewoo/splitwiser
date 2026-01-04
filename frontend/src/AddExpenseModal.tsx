import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import ReceiptScanner from './ReceiptScanner';
import ParticipantSelector from './ParticipantSelector';
import ExpenseSplitTypeSelector from './components/expense/ExpenseSplitTypeSelector';
import ExpenseItemList from './components/expense/ExpenseItemList';
import SplitDetailsInput from './components/expense/SplitDetailsInput';
import IconSelector from './components/expense/IconSelector';
import AddItemModal from './components/AddItemModal';
import AlertDialog from './components/AlertDialog';
import { useItemizedExpense } from './hooks/useItemizedExpense';
import { useSplitDetails } from './hooks/useSplitDetails';
import { useCurrencyPreferences } from './hooks/useCurrencyPreferences';
import type {
    Friend,
    Group,
    Participant,
    SplitType
} from './types/expense';
import {
    getParticipantName as getParticipantNameUtil,
    getParticipantKey
} from './utils/participantHelpers';
import {
    calculateEqualSplit,
    calculateExactSplit,
    calculatePercentSplit,
    calculateSharesSplit,
    calculateItemizedTotal
} from './utils/expenseCalculations';
import { formatDateForInput } from './utils/formatters';
import { formatCurrencyDisplay } from './utils/currencyHelpers';
import { offlineExpensesApi } from './services/offlineApi';
import { useSync } from './contexts/SyncContext';

interface AddExpenseModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExpenseAdded: () => void;
    friends: Friend[];
    groups?: Group[];
    preselectedGroupId?: number | null;
    preselectedFriendId?: number | null;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
    isOpen,
    onClose,
    onExpenseAdded,
    friends,
    groups = [],
    preselectedGroupId = null,
    preselectedFriendId = null
}) => {
    const { user } = useAuth();
    const { isOnline: _isOnline } = useSync();
    const { sortedCurrencies, recordCurrencyUsage } = useCurrencyPreferences();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [selectedFriendIds, setSelectedFriendIds] = useState<number[]>([]);
    const [selectedGuestIds, setSelectedGuestIds] = useState<number[]>([]);
    const [currentUserSelected, setCurrentUserSelected] = useState<boolean>(true);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(preselectedGroupId);
    const [splitType, setSplitType] = useState<SplitType>('EQUAL');
    const [showScanner, setShowScanner] = useState(false);
    const [scannedItems, setScannedItems] = useState<{ description: string, price: number }[]>([]);
    const [ocrValidationWarning, setOcrValidationWarning] = useState<string | null>(null);
    const [expenseDate, setExpenseDate] = useState<string>(formatDateForInput());
    const [showParticipantSelector, setShowParticipantSelector] = useState(false);
    const [receiptImagePath, setReceiptImagePath] = useState<string | null>(null);
    const [payerId, setPayerId] = useState<number>(user?.id || 0);
    const [payerIsGuest, setPayerIsGuest] = useState<boolean>(false);
    const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
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

    // Use custom hooks
    const itemizedExpense = useItemizedExpense();
    const { splitDetails, handleSplitDetailChange, removeSplitDetail, setSplitDetails } = useSplitDetails();

    const selectedGroup = groups.find(g => g.id === selectedGroupId);
    const groupGuests = selectedGroup?.guests || [];

    useEffect(() => {
        if (selectedGroup?.default_currency) {
            setCurrency(selectedGroup.default_currency);
        }
    }, [selectedGroup]);

    const resetForm = () => {
        setDescription('');
        setAmount('');
        setSelectedFriendIds(preselectedFriendId ? [preselectedFriendId] : []);
        setSelectedGuestIds([]);
        setCurrentUserSelected(true);
        setSelectedGroupId(preselectedGroupId);

        // Reset currency to preselected group's default or USD
        const defaultGroup = groups.find(g => g.id === preselectedGroupId);
        setCurrency(defaultGroup?.default_currency || 'USD');

        setPayerId(user?.id || 0);
        setPayerIsGuest(false);
        setExpenseDate(formatDateForInput());
        setSplitType('EQUAL');
        setScannedItems([]);
        setOcrValidationWarning(null);
        setSelectedIcon(null);
        setReceiptImagePath(null);
        setNotes('');
        itemizedExpense.setItemizedItems([]);
        itemizedExpense.setTaxAmount('');
        itemizedExpense.setTipAmount('');
        setSplitDetails({});
    };

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            resetForm();
        }
    }, [isOpen, preselectedGroupId, preselectedFriendId, user?.id]);

    const handleScannedItems = (items: { description: string, price: number }[], receiptPath?: string, validationWarning?: string | null) => {
        setScannedItems(items);
        if (receiptPath) setReceiptImagePath(receiptPath);
        setOcrValidationWarning(validationWarning || null);
        setShowScanner(false);

        const newItems = items.map(item => ({
            description: item.description,
            price: item.price,
            is_tax_tip: false,
            assignments: []
        }));

        itemizedExpense.setItemizedItems(prev => [...prev, ...newItems]);
        setSplitType('ITEMIZED');

        const total = [...itemizedExpense.itemizedItems, ...newItems].reduce((acc, item) => acc + item.price, 0);
        const tax = Math.round(parseFloat(itemizedExpense.taxAmount || '0') * 100);
        const tip = Math.round(parseFloat(itemizedExpense.tipAmount || '0') * 100);
        setAmount(((total + tax + tip) / 100).toFixed(2));
        setDescription("Receipt Scan");
    };

    if (!isOpen) return null;

    const getAllParticipants = (): Participant[] => {
        const participants: Participant[] = [];

        // Only include current user if selected
        if (currentUserSelected) {
            participants.push({ id: user!.id, name: 'You', isGuest: false });
        }

        selectedFriendIds.forEach(fid => {
            const friend = friends.find(f => f.id === fid);
            if (friend) {
                participants.push({ id: friend.id, name: friend.full_name, isGuest: false });
            }
        });

        selectedGuestIds.forEach(gid => {
            const guest = groupGuests.find(g => g.id === gid);
            if (guest) {
                participants.push({ id: guest.id, name: guest.name, isGuest: true });
            }
        });

        return participants;
    };

    const getParticipantName = (p: Participant): string => {
        return getParticipantNameUtil(p, user?.id);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const totalAmountCents = Math.round(parseFloat(amount) * 100);
        const participants = getAllParticipants();
        let splits: any[] = [];

        // Calculate splits based on type
        if (splitType === 'EQUAL') {
            splits = calculateEqualSplit(totalAmountCents, participants);
        } else if (splitType === 'EXACT') {
            const result = calculateExactSplit(totalAmountCents, participants, splitDetails);
            if (result.error) {
                setAlertDialog({
                    isOpen: true,
                    title: 'Invalid Split',
                    message: result.error,
                    type: 'error'
                });
                return;
            }
            splits = result.splits;
        } else if (splitType === 'PERCENT') {
            const result = calculatePercentSplit(totalAmountCents, participants, splitDetails);
            if (result.error) {
                setAlertDialog({
                    isOpen: true,
                    title: 'Invalid Split',
                    message: result.error,
                    type: 'error'
                });
                return;
            }
            splits = result.splits;
        } else if (splitType === 'SHARES') {
            const result = calculateSharesSplit(totalAmountCents, participants, splitDetails);
            if (result.error) {
                setAlertDialog({
                    isOpen: true,
                    title: 'Invalid Split',
                    message: result.error,
                    type: 'error'
                });
                return;
            }
            splits = result.splits;
        }

        const payload: any = {
            description,
            amount: totalAmountCents,
            currency,
            date: expenseDate,
            payer_id: payerId,
            payer_is_guest: payerIsGuest,
            group_id: selectedGroupId,
            split_type: splitType,
            splits: splits,
            icon: selectedIcon,
            receipt_image_path: receiptImagePath,
            notes: notes
        };

        if (splitType === 'ITEMIZED') {
            const unassigned = itemizedExpense.itemizedItems.filter(
                item => !item.is_tax_tip && item.assignments.length === 0
            );
            if (unassigned.length > 0) {
                setAlertDialog({
                    isOpen: true,
                    title: 'Unassigned Items',
                    message: `Please assign all items. Unassigned: ${unassigned.map(i => i.description).join(', ')}`,
                    type: 'error'
                });
                return;
            }

            const allParticipants = getAllParticipants();
            const participantsWithItems = new Set<string>();
            itemizedExpense.itemizedItems.forEach(item => {
                item.assignments.forEach(a => {
                    const key = a.is_guest ? `guest_${a.user_id}` : `user_${a.user_id}`;
                    participantsWithItems.add(key);
                });
            });

            const participantsWithoutItems = allParticipants.filter(p => {
                const key = getParticipantKey(p);
                return !participantsWithItems.has(key);
            });

            // Helper function to finalize itemized expense
            const finalizeItemizedExpense = async () => {
                setIsSubmitting(true);
                try {
                    const allItems = [...itemizedExpense.itemizedItems];
                    const tax = Math.round(parseFloat(itemizedExpense.taxAmount || '0') * 100);
                    const tip = Math.round(parseFloat(itemizedExpense.tipAmount || '0') * 100);

                    // Add Tax as a separate item if present
                    if (tax > 0) {
                        allItems.push({
                            description: 'Tax',
                            price: tax,
                            is_tax_tip: true,
                            assignments: []
                        });
                    }

                    // Add Tip as a separate item if present
                    if (tip > 0) {
                        allItems.push({
                            description: 'Tip',
                            price: tip,
                            is_tax_tip: true,
                            assignments: []
                        });
                    }

                    const itemsTotal = allItems.reduce((sum, item) => sum + item.price, 0);

                    const itemizedPayload = {
                        description,
                        amount: itemsTotal,
                        currency,
                        date: expenseDate,
                        payer_id: payerId,
                        payer_is_guest: payerIsGuest,
                        group_id: selectedGroupId,
                        split_type: 'ITEMIZED',
                        items: allItems,
                        splits: [],
                        icon: selectedIcon,
                        receipt_image_path: receiptImagePath,
                        notes: notes
                    };

                    const result = await offlineExpensesApi.create(itemizedPayload);

                    if (result.success) {
                        recordCurrencyUsage(currency);
                        if (result.offline) {
                            console.log('Expense created offline and queued for sync');
                        }
                        onExpenseAdded();
                        onClose();
                        resetForm();
                    } else {
                        setAlertDialog({
                            isOpen: true,
                            title: 'Error',
                            message: 'Failed to add expense',
                            type: 'error'
                        });
                    }
                } finally {
                    setIsSubmitting(false);
                }
            };

            // Check for participants without items
            if (participantsWithoutItems.length > 0) {
                const names = participantsWithoutItems.map(p => p.name).join(', ');
                setAlertDialog({
                    isOpen: true,
                    title: 'Warning',
                    message: `The following participant(s) have no items assigned and will not be included in this expense:\n\n${names}\n\nDo you want to continue?`,
                    type: 'confirm',
                    onConfirm: finalizeItemizedExpense
                });
                return;
            }

            await finalizeItemizedExpense();
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await offlineExpensesApi.create(payload);

            if (result.success) {
                // Record currency usage for sorting
                recordCurrencyUsage(currency);

                // Show feedback if created offline
                if (result.offline) {
                    console.log('Expense created offline and queued for sync');
                }

                onExpenseAdded();
                onClose();
                // Reset state
                resetForm();
            } else {
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: 'Failed to add expense',
                    type: 'error'
                });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleFriend = (id: number) => {
        if (selectedFriendIds.includes(id)) {
            setSelectedFriendIds(selectedFriendIds.filter(fid => fid !== id));
            removeSplitDetail(`user_${id}`);
        } else {
            setSelectedFriendIds([...selectedFriendIds, id]);
        }
    };

    const toggleGuest = (id: number) => {
        if (selectedGuestIds.includes(id)) {
            setSelectedGuestIds(selectedGuestIds.filter(gid => gid !== id));
            removeSplitDetail(`guest_${id}`);
        } else {
            setSelectedGuestIds([...selectedGuestIds, id]);
        }
    };

    const getAvailableParticipants = (): Participant[] => {
        const participants: Participant[] = [];
        participants.push({ id: user!.id, name: 'You', isGuest: false });

        // If a group is selected, only show group members and guests
        if (selectedGroup) {
            // Add group members (excluding current user)
            selectedGroup.members?.forEach(m => {
                if (m.user_id !== user!.id) {
                    participants.push({ id: m.user_id, name: m.full_name, isGuest: false });
                }
            });
            // Add group guests
            groupGuests.forEach(g => {
                participants.push({ id: g.id, name: g.name, isGuest: true });
            });
        } else {
            // If no group selected, show all friends
            friends.forEach(f => {
                participants.push({ id: f.id, name: f.full_name, isGuest: false });
            });
        }

        return participants;
    };

    const getCurrentlySelectedParticipants = (): Participant[] => {
        const selected: Participant[] = [];

        // Only include current user if selected
        if (currentUserSelected) {
            selected.push({ id: user!.id, name: 'You', isGuest: false });
        }

        selectedFriendIds.forEach(fid => {
            const friend = friends.find(f => f.id === fid);
            if (friend) {
                selected.push({ id: friend.id, name: friend.full_name, isGuest: false });
            }
        });
        selectedGuestIds.forEach(gid => {
            const guest = groupGuests.find(g => g.id === gid);
            if (guest) {
                selected.push({ id: guest.id, name: guest.name, isGuest: true });
            }
        });
        return selected;
    };

    const handleMainParticipantSelectorConfirm = (selectedParticipants: Participant[]) => {
        setSelectedFriendIds([]);
        setSelectedGuestIds([]);
        setCurrentUserSelected(false);

        selectedParticipants.forEach(p => {
            if (p.isGuest) {
                setSelectedGuestIds(prev => [...prev, p.id]);
            } else if (p.id === user?.id) {
                setCurrentUserSelected(true);
            } else {
                setSelectedFriendIds(prev => [...prev, p.id]);
            }
        });
        setShowParticipantSelector(false);
    };

    const handleParticipantSelectorConfirm = (itemIdx: number, selectedParticipants: Participant[]) => {
        itemizedExpense.updateItemAssignments(itemIdx, selectedParticipants.map(p => ({
            user_id: p.id,
            is_guest: p.isGuest
        })));
        itemizedExpense.setEditingItemIndex(null);
    };

    const getSelectedParticipantsDisplay = (): string => {
        const total = selectedFriendIds.length + selectedGuestIds.length;
        const totalWithCurrentUser = total + (currentUserSelected ? 1 : 0);

        if (totalWithCurrentUser === 0) return 'Select people';

        // If only current user selected
        if (totalWithCurrentUser === 1 && currentUserSelected) return 'You';

        // If current user not selected
        if (!currentUserSelected) {
            if (total === 1) {
                const friend = friends.find(f => selectedFriendIds.includes(f.id));
                if (friend) return friend.full_name;
                const guest = groupGuests.find(g => selectedGuestIds.includes(g.id));
                if (guest) return guest.name;
            }
            return `${total} people selected`;
        }

        // If current user is selected plus others
        if (total === 1) {
            const friend = friends.find(f => selectedFriendIds.includes(f.id));
            if (friend) return `You and ${friend.full_name}`;
            const guest = groupGuests.find(g => selectedGuestIds.includes(g.id));
            if (guest) return `You and ${guest.name}`;
        }
        return `You and ${total} other${total === 1 ? '' : 's'}`;
    };

    const getPotentialPayers = (): Participant[] => {
        // If a group is selected, any member/guest of the group can be the payer
        if (selectedGroup) {
            const participants = getAvailableParticipants();
            // Sort: "You" first, then alphabetically
            return participants.sort((a, b) => {
                if (a.id === user!.id && !a.isGuest) return -1;
                if (b.id === user!.id && !b.isGuest) return 1;
                return a.name.localeCompare(b.name);
            });
        }

        // For non-group expenses (friends only), restrict to selected participants
        const payers: Participant[] = [];
        payers.push({ id: user!.id, name: 'You', isGuest: false });

        const friendPayers: Participant[] = [];
        selectedFriendIds.forEach(fid => {
            const friend = friends.find(f => f.id === fid);
            if (friend) {
                friendPayers.push({ id: friend.id, name: friend.full_name, isGuest: false });
            }
        });

        // Sort friends alphabetically
        friendPayers.sort((a, b) => a.name.localeCompare(b.name));

        return [...payers, ...friendPayers];
    };

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 z-40 flex items-end md:items-center justify-center">
            {showScanner && (
                <ReceiptScanner
                    onItemsDetected={handleScannedItems}
                    onClose={() => setShowScanner(false)}
                />
            )}
            {showParticipantSelector && (
                <ParticipantSelector
                    isOpen={true}
                    onClose={() => setShowParticipantSelector(false)}
                    participants={getAvailableParticipants()}
                    selectedParticipants={getCurrentlySelectedParticipants()}
                    onConfirm={handleMainParticipantSelectorConfirm}
                    itemDescription="Select people for this expense"
                />
            )}
            {itemizedExpense.editingItemIndex !== null && (
                <ParticipantSelector
                    isOpen={true}
                    onClose={() => itemizedExpense.setEditingItemIndex(null)}
                    participants={getAllParticipants()}
                    selectedParticipants={getAllParticipants().filter(p => {
                        const item = itemizedExpense.itemizedItems[itemizedExpense.editingItemIndex!];
                        return item?.assignments.some(a => a.user_id === p.id && a.is_guest === p.isGuest);
                    })}
                    onConfirm={(selected) => handleParticipantSelectorConfirm(itemizedExpense.editingItemIndex!, selected)}
                    itemDescription={itemizedExpense.itemizedItems[itemizedExpense.editingItemIndex]?.description || ''}
                />
            )}
            <div className="bg-white dark:bg-gray-800 w-full md:w-[448px] max-h-[90vh] rounded-t-2xl md:rounded-2xl shadow-xl dark:shadow-gray-900/50 overflow-y-auto flex flex-col">
                <div className="sticky top-0 bg-white dark:bg-gray-800 z-10 p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold dark:text-gray-100">Add an expense</h2>
                    <button
                        type="button"
                        onClick={() => setShowScanner(true)}
                        className="text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-3 py-2 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/50 min-h-[44px]"
                    >
                        Scan Receipt
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                        {scannedItems.length > 0 && (
                            <div className="mb-4 bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm">
                                <p className="font-semibold mb-1 dark:text-gray-100">Scanned Items:</p>
                                <ul className="list-disc pl-4 text-gray-600 dark:text-gray-300">
                                    {scannedItems.map((item, idx) => (
                                        <li key={idx}>{item.description}: ${(item.price / 100).toFixed(2)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {groups.length > 0 && (
                            <div className="mb-4">
                                <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Group (optional):</label>
                                <select
                                    value={selectedGroupId || ''}
                                    onChange={(e) => setSelectedGroupId(e.target.value ? parseInt(e.target.value) : null)}
                                    className="w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                                >
                                    <option value="">No group</option>
                                    {groups.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="mb-4">
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Description:</label>
                            <div className="flex items-center gap-2">
                                <IconSelector
                                    selectedIcon={selectedIcon}
                                    onIconSelect={setSelectedIcon}
                                />
                                <input
                                    type="text"
                                    placeholder="Enter a description"
                                    className="flex-1 border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="mb-4 flex items-center space-x-2">
                            <select
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                className="border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-transparent text-gray-700 dark:text-gray-200 dark:bg-gray-700"
                            >
                                {sortedCurrencies.map(c => (
                                    <option key={c.code} value={c.code}>
                                        {formatCurrencyDisplay(c.code)}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0.00"
                                className={`w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 text-lg dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 ${splitType === 'ITEMIZED' ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' : ''}`}
                                value={splitType === 'ITEMIZED' ? calculateItemizedTotal(itemizedExpense.itemizedItems, itemizedExpense.taxAmount, itemizedExpense.tipAmount) : amount}
                                onChange={e => setAmount(e.target.value)}
                                disabled={splitType === 'ITEMIZED'}
                                required={splitType !== 'ITEMIZED'}
                            />
                        </div>

                        <div className="mb-4">
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Date:</label>
                            <input
                                type="date"
                                className="w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 dark:bg-gray-800 dark:text-gray-100"
                                value={expenseDate}
                                onChange={(e) => setExpenseDate(e.target.value)}
                                required
                            />
                        </div>

                        <div className="mb-4">
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Notes:</label>
                            <textarea
                                className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:border-teal-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-400"
                                placeholder="Add notes (optional)"
                                rows={2}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        </div>

                        <div className="mb-4">
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Participants:</label>
                            {getAvailableParticipants().length === 1 ? (
                                <div className="text-sm text-gray-500 dark:text-gray-400 italic py-2">
                                    {selectedGroup ? 'No other members in this group' : 'Add friends or select a group with members to split expenses'}
                                </div>
                            ) : getAvailableParticipants().length > 6 ? (
                                <button
                                    type="button"
                                    onClick={() => setShowParticipantSelector(true)}
                                    className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 text-left flex items-center justify-between min-h-[44px]"
                                >
                                    <span className="text-sm">{getSelectedParticipantsDisplay()}</span>
                                    <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                                        <path d="M9 5l7 7-7 7"></path>
                                    </svg>
                                </button>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {getAvailableParticipants()
                                        .sort((a, b) => {
                                            // "You" always first
                                            if (a.name === 'You') return -1;
                                            if (b.name === 'You') return 1;
                                            return a.name.localeCompare(b.name);
                                        })
                                        .map(participant => {
                                            const key = participant.isGuest ? `guest-${participant.id}` : `friend-${participant.id}`;
                                            const isCurrentUser = participant.id === user?.id && !participant.isGuest;
                                            const isSelected = isCurrentUser
                                                ? currentUserSelected
                                                : participant.isGuest
                                                    ? selectedGuestIds.includes(participant.id)
                                                    : selectedFriendIds.includes(participant.id);
                                            const toggleFn = isCurrentUser
                                                ? () => setCurrentUserSelected(!currentUserSelected)
                                                : participant.isGuest
                                                    ? () => toggleGuest(participant.id)
                                                    : () => toggleFriend(participant.id);

                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={toggleFn}
                                                    aria-pressed={isSelected}
                                                    className={`px-4 py-2 rounded-full text-sm border min-h-[44px] transition-all duration-200 ${isSelected
                                                        ? participant.isGuest
                                                            ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-500 dark:border-orange-600 text-orange-700 dark:text-orange-300'
                                                            : 'bg-teal-100 dark:bg-teal-900/30 border-teal-500 dark:border-teal-600 text-teal-700 dark:text-teal-300'
                                                        : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 dark:text-gray-200'
                                                        }`}
                                                >
                                                    {participant.name}
                                                </button>
                                            );
                                        })}
                                </div>
                            )}
                        </div>

                        {getPotentialPayers().length > 1 && (
                            <div className="mb-4">
                                <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Paid by:</label>
                                <select
                                    value={payerIsGuest ? `guest_${payerId}` : `user_${payerId}`}
                                    onChange={(e) => {
                                        const [type, id] = e.target.value.split('_');
                                        setPayerId(parseInt(id));
                                        setPayerIsGuest(type === 'guest');
                                    }}
                                    className="w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                                >
                                    {getPotentialPayers().map(p => (
                                        <option key={p.isGuest ? `guest_${p.id}` : `user_${p.id}`} value={p.isGuest ? `guest_${p.id}` : `user_${p.id}`}>
                                            {p.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="mb-4">
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">Split by:</label>
                            <ExpenseSplitTypeSelector value={splitType} onChange={setSplitType} />

                            {splitType === 'ITEMIZED' && (
                                <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                                    <div className="flex justify-between items-center mb-3">
                                        <p className="font-semibold text-sm dark:text-gray-100">Assign Items</p>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowScanner(true)}
                                                className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 px-3 py-2 min-h-[44px]"
                                            >
                                                + Scan
                                            </button>
                                            <button
                                                type="button"
                                                onClick={itemizedExpense.openAddItemModal}
                                                className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 px-3 py-2 min-h-[44px]"
                                            >
                                                + Add
                                            </button>
                                        </div>
                                    </div>

                                    {/* OCR Validation Warning */}
                                    {ocrValidationWarning && (
                                        <div className="mb-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 px-3 py-2 rounded-md text-sm">
                                            <div className="flex items-start gap-2">
                                                <span className="text-yellow-500 flex-shrink-0">⚠️</span>
                                                <div>
                                                    <p className="font-medium">Some items may be missing</p>
                                                    <p className="text-xs mt-1 text-yellow-700 dark:text-yellow-300">{ocrValidationWarning}</p>
                                                    <p className="text-xs mt-1 text-yellow-600 dark:text-yellow-400">Please review and add any missing items manually using the "+ Add" button.</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setOcrValidationWarning(null)}
                                                    className="text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-300 flex-shrink-0"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <ExpenseItemList
                                        items={itemizedExpense.itemizedItems}
                                        participants={getAllParticipants()}
                                        onToggleAssignment={itemizedExpense.toggleItemAssignment}
                                        onRemoveItem={itemizedExpense.removeItem}
                                        onOpenSelector={itemizedExpense.setEditingItemIndex}
                                        getParticipantName={getParticipantName}
                                        currentUserId={user?.id}
                                    />

                                    <div className="mt-3 pt-3 border-t dark:border-gray-600 space-y-3">
                                        {/* Tax Input */}
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            <span className="text-sm text-gray-600 dark:text-gray-400">Tax (split proportionally)</span>
                                            <div className="flex items-center">
                                                <span className="text-sm mr-2 dark:text-gray-300">{currency}</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="0.00"
                                                    step="0.01"
                                                    className="w-28 sm:w-24 border dark:border-gray-600 rounded p-2 text-sm text-right min-h-[44px] dark:bg-gray-800 dark:text-gray-100"
                                                    value={itemizedExpense.taxAmount}
                                                    onChange={(e) => itemizedExpense.setTaxAmount(e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        {/* Tip Input with percentage buttons */}
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Tip (split proportionally)</span>
                                                <div className="flex items-center">
                                                    <span className="text-sm mr-2 dark:text-gray-300">{currency}</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="0.00"
                                                        step="0.01"
                                                        className="w-28 sm:w-24 border dark:border-gray-600 rounded p-2 text-sm text-right min-h-[44px] dark:bg-gray-800 dark:text-gray-100"
                                                        value={itemizedExpense.tipAmount}
                                                        onChange={(e) => itemizedExpense.setTipAmount(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-2 justify-end">
                                                {[15, 18, 20].map(percent => (
                                                    <button
                                                        key={percent}
                                                        type="button"
                                                        onClick={() => itemizedExpense.setTipFromPercentage(percent)}
                                                        className="px-3 py-1 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors"
                                                    >
                                                        {percent}%
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3 text-right text-base font-semibold dark:text-white">
                                        Total: {currency} {calculateItemizedTotal(itemizedExpense.itemizedItems, itemizedExpense.taxAmount, itemizedExpense.tipAmount)}
                                    </div>
                                </div>
                            )}

                            {splitType !== 'EQUAL' && splitType !== 'ITEMIZED' && (
                                <SplitDetailsInput
                                    splitType={splitType}
                                    participants={getAllParticipants()}
                                    splitDetails={splitDetails}
                                    onChange={handleSplitDetailChange}
                                    currency={currency}
                                    getParticipantName={getParticipantName}
                                />
                            )}
                        </div>
                    </div>

                    <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 sm:p-5 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded min-h-[44px] disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                            {isSubmitting ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Saving...
                                </>
                            ) : 'Save'}
                        </button>
                    </div>
                </form>

                {/* Add Item Modal */}
                <AddItemModal
                    isOpen={itemizedExpense.showAddItemModal}
                    onClose={itemizedExpense.closeAddItemModal}
                    onAdd={itemizedExpense.addManualItem}
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
            </div>
        </div>
    );
};

export default AddExpenseModal;
