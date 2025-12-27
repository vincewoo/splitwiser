import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import ReceiptScanner from './ReceiptScanner';
import ParticipantSelector from './ParticipantSelector';
import ExpenseSplitTypeSelector from './components/expense/ExpenseSplitTypeSelector';
import ExpenseItemList from './components/expense/ExpenseItemList';
import SplitDetailsInput from './components/expense/SplitDetailsInput';
import IconSelector from './components/expense/IconSelector';
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
import { expensesApi } from './services/api';

interface AddExpenseModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExpenseAdded: () => void;
    friends: Friend[];
    groups?: Group[];
    preselectedGroupId?: number | null;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
    isOpen,
    onClose,
    onExpenseAdded,
    friends,
    groups = [],
    preselectedGroupId = null
}) => {
    const { user } = useAuth();
    const { sortedCurrencies, recordCurrencyUsage } = useCurrencyPreferences();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [selectedFriendIds, setSelectedFriendIds] = useState<number[]>([]);
    const [selectedGuestIds, setSelectedGuestIds] = useState<number[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(preselectedGroupId);
    const [splitType, setSplitType] = useState<SplitType>('EQUAL');
    const [showScanner, setShowScanner] = useState(false);
    const [scannedItems, setScannedItems] = useState<{ description: string, price: number }[]>([]);
    const [expenseDate, setExpenseDate] = useState<string>(formatDateForInput());
    const [showParticipantSelector, setShowParticipantSelector] = useState(false);
    const [receiptImagePath, setReceiptImagePath] = useState<string | null>(null);
    const [payerId, setPayerId] = useState<number>(user?.id || 0);
    const [payerIsGuest, setPayerIsGuest] = useState<boolean>(false);
    const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
    const [notes, setNotes] = useState('');

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
        setSelectedFriendIds([]);
        setSelectedGuestIds([]);
        setSelectedGroupId(preselectedGroupId);

        // Reset currency to preselected group's default or USD
        const defaultGroup = groups.find(g => g.id === preselectedGroupId);
        setCurrency(defaultGroup?.default_currency || 'USD');

        setPayerId(user?.id || 0);
        setPayerIsGuest(false);
        setExpenseDate(formatDateForInput());
        setSplitType('EQUAL');
        setScannedItems([]);
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
    }, [isOpen, preselectedGroupId, user?.id]);

    const handleScannedItems = (items: { description: string, price: number }[], receiptPath?: string) => {
        setScannedItems(items);
        if (receiptPath) setReceiptImagePath(receiptPath);
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
        participants.push({ id: user!.id, name: 'You', isGuest: false });

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
                alert(result.error);
                return;
            }
            splits = result.splits;
        } else if (splitType === 'PERCENT') {
            const result = calculatePercentSplit(totalAmountCents, participants, splitDetails);
            if (result.error) {
                alert(result.error);
                return;
            }
            splits = result.splits;
        } else if (splitType === 'SHARES') {
            const result = calculateSharesSplit(totalAmountCents, participants, splitDetails);
            if (result.error) {
                alert(result.error);
                return;
            }
            splits = result.splits;
        }

        let payload: any = {
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
                alert(`Please assign all items. Unassigned: ${unassigned.map(i => i.description).join(', ')}`);
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

            if (participantsWithoutItems.length > 0) {
                const names = participantsWithoutItems.map(p => p.name).join(', ');
                const proceed = window.confirm(
                    `Warning: The following participant(s) have no items assigned and will not be included in this expense:\n\n${names}\n\nDo you want to continue?`
                );
                if (!proceed) return;
            }

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

            payload = {
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
        }

        const response = await expensesApi.create(payload);

        if (response.ok) {
            // Record currency usage for sorting
            recordCurrencyUsage(currency);
            onExpenseAdded();
            onClose();
            // Reset state
            resetForm();
        } else {
            const err = await response.json();
            alert(`Failed to add expense: ${err.detail}`);
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
        selected.push({ id: user!.id, name: 'You', isGuest: false });
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
        selectedParticipants.forEach(p => {
            if (p.isGuest) {
                setSelectedGuestIds(prev => [...prev, p.id]);
            } else if (p.id !== user?.id) {
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
        if (total === 0) return 'Select people';
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
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-40 p-0 sm:p-4">
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
            <div className="bg-white dark:bg-gray-800 w-full h-full sm:w-full sm:max-w-md sm:h-auto sm:max-h-[90vh] sm:rounded-lg shadow-xl dark:shadow-gray-900/50 overflow-y-auto flex flex-col">
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
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">With you and:</label>
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
                                        .filter(p => p.name !== 'You')
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map(participant => {
                                            const key = participant.isGuest ? `guest-${participant.id}` : `friend-${participant.id}`;
                                            const isSelected = participant.isGuest
                                                ? selectedGuestIds.includes(participant.id)
                                                : selectedFriendIds.includes(participant.id);
                                            const toggleFn = participant.isGuest
                                                ? () => toggleGuest(participant.id)
                                                : () => toggleFriend(participant.id);

                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={toggleFn}
                                                    className={`px-4 py-2 rounded-full text-sm border min-h-[44px] ${isSelected
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
                                type="number"
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
                                                onClick={itemizedExpense.addManualItem}
                                                className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 px-3 py-2 min-h-[44px]"
                                            >
                                                + Add
                                            </button>
                                        </div>
                                    </div>

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
                                                    type="number"
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
                                                        type="number"
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
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded min-h-[44px]">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 min-h-[44px]">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddExpenseModal;
