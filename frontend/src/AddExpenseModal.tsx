import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import ReceiptScanner from './ReceiptScanner';
import ParticipantSelector from './ParticipantSelector';

interface Friend {
    id: number;
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

interface GroupMember {
    id: number;
    user_id: number;
    full_name: string;
    email: string;
}

interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
    members?: GroupMember[];
    guests?: GuestMember[];
}

interface Participant {
    id: number;
    name: string;
    isGuest: boolean;
}

interface ItemAssignment {
    user_id: number;
    is_guest: boolean;
}

interface ExpenseItem {
    description: string;
    price: number;
    is_tax_tip: boolean;
    assignments: ItemAssignment[];
}

interface AddExpenseModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExpenseAdded: () => void;
    friends: Friend[];
    groups?: Group[];
    preselectedGroupId?: number | null;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({ isOpen, onClose, onExpenseAdded, friends, groups = [], preselectedGroupId = null }) => {
    const { user } = useAuth();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [currencies] = useState<string[]>(['USD', 'EUR', 'GBP', 'JPY', 'CAD']);
    const [selectedFriendIds, setSelectedFriendIds] = useState<number[]>([]);
    const [selectedGuestIds, setSelectedGuestIds] = useState<number[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(preselectedGroupId);
    const [splitType, setSplitType] = useState('EQUAL');
    const [showScanner, setShowScanner] = useState(false);
    const [scannedItems, setScannedItems] = useState<{ description: string, price: number }[]>([]);
    const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().split('T')[0]);

    // Itemized expense state
    const [itemizedItems, setItemizedItems] = useState<ExpenseItem[]>([]);
    const [taxTipAmount, setTaxTipAmount] = useState<string>('');
    const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
    const [showParticipantSelector, setShowParticipantSelector] = useState(false);

    // Payer state - can be user or guest
    const [payerId, setPayerId] = useState<number>(user?.id || 0);
    const [payerIsGuest, setPayerIsGuest] = useState<boolean>(false);

    // Split details state - keyed by "user_<id>" or "guest_<id>"
    const [splitDetails, setSplitDetails] = useState<{[key: string]: number}>({});

    // Get current selected group
    const selectedGroup = groups.find(g => g.id === selectedGroupId);
    const groupGuests = selectedGroup?.guests || [];

    useEffect(() => {
        // Reset split details when split type changes
        setSplitDetails({});
    }, [splitType]);

    useEffect(() => {
        // Update currency when selected group changes
        if (selectedGroup?.default_currency) {
            setCurrency(selectedGroup.default_currency);
        }
    }, [selectedGroup]);

    const handleScannedItems = (items: { description: string, price: number }[]) => {
        setScannedItems(items);
        setShowScanner(false);

        // Convert scanned items to itemized format
        const newItems: ExpenseItem[] = items.map(item => ({
            description: item.description,
            price: item.price,
            is_tax_tip: false,
            assignments: []
        }));

        setItemizedItems(prev => [...prev, ...newItems]);
        setSplitType('ITEMIZED');

        // Update total
        const total = [...itemizedItems, ...newItems].reduce((acc, item) => acc + item.price, 0);
        const taxTip = Math.round(parseFloat(taxTipAmount || '0') * 100);
        setAmount(((total + taxTip) / 100).toFixed(2));
        setDescription("Receipt Scan");
    };

    if (!isOpen) return null;

    // Build list of all participants (users + guests)
    const getAllParticipants = (): Participant[] => {
        const participants: Participant[] = [];
        // Add current user
        participants.push({ id: user!.id, name: 'You', isGuest: false });
        // Add selected friends
        selectedFriendIds.forEach(fid => {
            const friend = friends.find(f => f.id === fid);
            if (friend) {
                participants.push({ id: friend.id, name: friend.full_name, isGuest: false });
            }
        });
        // Add selected guests
        selectedGuestIds.forEach(gid => {
            const guest = groupGuests.find(g => g.id === gid);
            if (guest) {
                participants.push({ id: guest.id, name: guest.name, isGuest: true });
            }
        });
        return participants;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

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
                    amount_owed: Math.round(parseFloat(splitDetails[key]?.toString() || '0') * 100)
                };
            });
             // Verify sum
             const sum = splits.reduce((acc, s) => acc + s.amount_owed, 0);
             if (Math.abs(sum - totalAmountCents) > 1) {
                 alert(`Amounts do not sum to total. Total: ${totalAmountCents/100}, Sum: ${sum/100}`);
                 return;
             }
        } else if (splitType === 'PERCENT') {
            let runningTotal = 0;
            // Get all percentages
            const shares = participants.map(p => {
                const key = p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
                return {
                    participant: p,
                    percent: parseFloat(splitDetails[key]?.toString() || '0')
                };
            });

            // Verify percent sum
            const percentSum = shares.reduce((acc, s) => acc + s.percent, 0);
            if (Math.abs(percentSum - 100) > 0.1) {
                 alert(`Percentages must sum to 100%. Current: ${percentSum}%`);
                 return;
            }

            splits = shares.map((s, index) => {
                if (index === shares.length - 1) {
                    // Last person gets the remainder to avoid rounding issues
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
                return {
                    participant: p,
                    shares: parseFloat(splitDetails[key]?.toString() || '0')
                };
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

        // Build payload - for ITEMIZED, include items
        let payload: any = {
            description,
            amount: totalAmountCents,
            currency,
            date: new Date(expenseDate).toISOString(),
            payer_id: payerId,
            payer_is_guest: payerIsGuest,
            group_id: selectedGroupId,
            split_type: splitType,
            splits: splits
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
                group_id: selectedGroupId,
                split_type: 'ITEMIZED',
                items: allItems,
                splits: []  // Backend will calculate
            };
        }

        const token = localStorage.getItem('token');
        const response = await fetch('http://localhost:8000/expenses', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            onExpenseAdded();
            onClose();
            // Reset
            setDescription('');
            setAmount('');
            setSelectedFriendIds([]);
            setSelectedGuestIds([]);
            setSplitDetails({});
            setSelectedGroupId(preselectedGroupId);
            setPayerId(user?.id || 0);
            setPayerIsGuest(false);
            setExpenseDate(new Date().toISOString().split('T')[0]);
            setItemizedItems([]);
            setTaxTipAmount('');
            setScannedItems([]);
        } else {
            const err = await response.json();
            alert(`Failed to add expense: ${err.detail}`);
        }
    };

    const toggleFriend = (id: number) => {
        if (selectedFriendIds.includes(id)) {
            setSelectedFriendIds(selectedFriendIds.filter(fid => fid !== id));
            // Cleanup split details
            const newDetails = {...splitDetails};
            delete newDetails[`user_${id}`];
            setSplitDetails(newDetails);
        } else {
            setSelectedFriendIds([...selectedFriendIds, id]);
        }
    };

    const toggleGuest = (id: number) => {
        if (selectedGuestIds.includes(id)) {
            setSelectedGuestIds(selectedGuestIds.filter(gid => gid !== id));
            // Cleanup split details
            const newDetails = {...splitDetails};
            delete newDetails[`guest_${id}`];
            setSplitDetails(newDetails);
        } else {
            setSelectedGuestIds([...selectedGuestIds, id]);
        }
    };

    const handleSplitDetailChange = (key: string, value: string) => {
        setSplitDetails({...splitDetails, [key]: parseFloat(value)});
    };

    const getParticipantName = (p: Participant) => {
        if (!p.isGuest && p.id === user?.id) return "You";
        return p.name;
    };

    // Helper to determine if we should use compact mode
    const shouldUseCompactMode = () => {
        const participants = getAllParticipants();
        return participants.length > 5;
    };

    // Helper to get assignment display text
    const getAssignmentDisplayText = (assignments: ItemAssignment[]): string => {
        const participants = getAllParticipants();

        if (assignments.length === 0) {
            return 'No one selected';
        }

        if (assignments.length === participants.length) {
            return `All ${participants.length} people`;
        }

        const names = assignments.map(a => {
            const p = participants.find(p => p.id === a.user_id && p.isGuest === a.is_guest);
            return p ? getParticipantName(p) : '';
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
        // Clear existing selections
        setSelectedFriendIds([]);
        setSelectedGuestIds([]);

        // Set new selections
        selectedParticipants.forEach(p => {
            if (p.isGuest) {
                setSelectedGuestIds(prev => [...prev, p.id]);
            } else if (p.id !== user?.id) {
                // Don't add current user to selectedFriendIds
                setSelectedFriendIds(prev => [...prev, p.id]);
            }
        });

        setShowParticipantSelector(false);
    };

    const getSelectedParticipantsDisplay = (): string => {
        const total = selectedFriendIds.length + selectedGuestIds.length;

        if (total === 0) {
            return 'Select people';
        }

        if (total === 1) {
            const friend = friends.find(f => selectedFriendIds.includes(f.id));
            if (friend) return `You and ${friend.full_name}`;

            const guest = groupGuests.find(g => selectedGuestIds.includes(g.id));
            if (guest) return `You and ${guest.name}`;
        }

        return `You and ${total} other${total === 1 ? '' : 's'}`;
    };

    // Get list of available participants for main selector (includes current user)
    const getAvailableParticipants = (): Participant[] => {
        const participants: Participant[] = [];

        // Add current user
        participants.push({ id: user!.id, name: 'You', isGuest: false });

        // Add friends
        friends.forEach(f => {
            participants.push({ id: f.id, name: f.full_name, isGuest: false });
        });

        // Add guests if group is selected
        groupGuests.forEach(g => {
            participants.push({ id: g.id, name: g.name, isGuest: true });
        });

        return participants;
    };

    // Get currently selected participants for main selector
    const getCurrentlySelectedParticipants = (): Participant[] => {
        const selected: Participant[] = [];

        // Always include current user
        selected.push({ id: user!.id, name: 'You', isGuest: false });

        // Add selected friends
        selectedFriendIds.forEach(fid => {
            const friend = friends.find(f => f.id === fid);
            if (friend) {
                selected.push({ id: friend.id, name: friend.full_name, isGuest: false });
            }
        });

        // Add selected guests
        selectedGuestIds.forEach(gid => {
            const guest = groupGuests.find(g => g.id === gid);
            if (guest) {
                selected.push({ id: guest.id, name: guest.name, isGuest: true });
            }
        });

        return selected;
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
                // Remove assignment
                item.assignments = item.assignments.filter((_, i) => i !== existingIdx);
            } else {
                // Add assignment
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
        const description = prompt("Item description:");
        if (!description) return;

        const priceStr = prompt("Price (in dollars, e.g., 12.99):");
        if (!priceStr) return;

        const price = Math.round(parseFloat(priceStr) * 100);
        if (isNaN(price) || price <= 0) {
            alert("Invalid price");
            return;
        }

        setItemizedItems(prev => [...prev, {
            description,
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

    // Build list of all potential payers (current user, selected friends, selected guests)
    const getPotentialPayers = (): Participant[] => {
        const payers: Participant[] = [];
        payers.push({ id: user!.id, name: 'You', isGuest: false });
        selectedFriendIds.forEach(fid => {
            const friend = friends.find(f => f.id === fid);
            if (friend) {
                payers.push({ id: friend.id, name: friend.full_name, isGuest: false });
            }
        });
        selectedGuestIds.forEach(gid => {
            const guest = groupGuests.find(g => g.id === gid);
            if (guest) {
                payers.push({ id: guest.id, name: guest.name, isGuest: true });
            }
        });
        return payers;
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-40 p-0 sm:p-4">
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
                <div className="sticky top-0 bg-white z-10 p-4 sm:p-5 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-xl font-bold">Add an expense</h2>
                    <button
                        type="button"
                        onClick={() => setShowScanner(true)}
                        className="text-sm bg-indigo-100 text-indigo-700 px-3 py-2 rounded hover:bg-indigo-200 min-h-[44px]"
                    >
                        Scan Receipt
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                    {scannedItems.length > 0 && (
                        <div className="mb-4 bg-gray-50 p-3 rounded text-sm">
                            <p className="font-semibold mb-1">Scanned Items:</p>
                            <ul className="list-disc pl-4 text-gray-600">
                                {scannedItems.map((item, idx) => (
                                    <li key={idx}>{item.description}: ${(item.price/100).toFixed(2)}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {groups.length > 0 && (
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Group (optional):</label>
                            <select
                                value={selectedGroupId || ''}
                                onChange={(e) => setSelectedGroupId(e.target.value ? parseInt(e.target.value) : null)}
                                className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 bg-white"
                            >
                                <option value="">No group</option>
                                {groups.map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">With you and:</label>
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
                                {friends.map(friend => (
                                    <button
                                        key={friend.id}
                                        type="button"
                                        onClick={() => toggleFriend(friend.id)}
                                        className={`px-4 py-2 rounded-full text-sm border min-h-[44px] ${selectedFriendIds.includes(friend.id) ? 'bg-teal-100 border-teal-500 text-teal-700' : 'bg-gray-100 border-gray-300'}`}
                                    >
                                        {friend.full_name}
                                    </button>
                                ))}
                                {/* Show guests if a group is selected */}
                                {groupGuests.map(guest => (
                                    <button
                                        key={`guest-${guest.id}`}
                                        type="button"
                                        onClick={() => toggleGuest(guest.id)}
                                        className={`px-4 py-2 rounded-full text-sm border min-h-[44px] ${selectedGuestIds.includes(guest.id) ? 'bg-orange-100 border-orange-500 text-orange-700' : 'bg-gray-100 border-gray-300'}`}
                                    >
                                        {guest.name} <span className="text-gray-400">(guest)</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Payer selection */}
                    {(selectedFriendIds.length > 0 || selectedGuestIds.length > 0) && (
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
                        <input
                            type="text"
                            placeholder="Enter a description"
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
                            className="border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 bg-transparent text-gray-700"
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
                                     <div className="flex gap-2">
                                         <button
                                             type="button"
                                             onClick={() => setShowScanner(true)}
                                             className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-2 min-h-[44px]"
                                         >
                                             + Scan
                                         </button>
                                         <button
                                             type="button"
                                             onClick={addManualItem}
                                             className="text-sm text-teal-600 hover:text-teal-800 px-3 py-2 min-h-[44px]"
                                         >
                                             + Add
                                         </button>
                                     </div>
                                 </div>

                                 {itemizedItems.length === 0 ? (
                                     <p className="text-sm text-gray-500 text-center py-4">
                                         No items yet. Scan a receipt or add items manually.
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
                                                                     {getParticipantName(p)}
                                                                 </button>
                                                             );
                                                         })}
                                                     </div>
                                                 )}
                                             </div>
                                         ))}
                                     </div>
                                 )}

                                 {/* Tax/Tip Section */}
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

                                 {/* Running Total */}
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
                                                 {getParticipantName(p)}
                                                 {p.isGuest && <span className="text-orange-500 ml-1">(guest)</span>}
                                             </span>
                                             <div className="flex items-center gap-2">
                                                 <input
                                                    type="number"
                                                    className="w-24 border rounded p-2 text-sm text-right min-h-[44px]"
                                                    placeholder="0"
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
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded min-h-[44px]">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 min-h-[44px]">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddExpenseModal;
