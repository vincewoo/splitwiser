import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import ReceiptScanner from './ReceiptScanner';

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
        const total = items.reduce((acc, item) => acc + item.price, 0);
        setAmount((total / 100).toFixed(2));
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

        const payload = {
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
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-40">
            {showScanner && (
                <ReceiptScanner
                    onItemsDetected={handleScannedItems}
                    onClose={() => setShowScanner(false)}
                />
            )}
            <div className="bg-white p-5 rounded-lg shadow-xl w-96 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">Add an expense</h2>
                    <button
                        type="button"
                        onClick={() => setShowScanner(true)}
                        className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200"
                    >
                        Scan Receipt
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    {scannedItems.length > 0 && (
                        <div className="mb-4 bg-gray-50 p-2 rounded text-xs">
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
                        <div className="flex flex-wrap gap-2">
                            {friends.map(friend => (
                                <button
                                    key={friend.id}
                                    type="button"
                                    onClick={() => toggleFriend(friend.id)}
                                    className={`px-3 py-1 rounded-full text-xs border ${selectedFriendIds.includes(friend.id) ? 'bg-teal-100 border-teal-500 text-teal-700' : 'bg-gray-100 border-gray-300'}`}
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
                                    className={`px-3 py-1 rounded-full text-xs border ${selectedGuestIds.includes(guest.id) ? 'bg-orange-100 border-orange-500 text-orange-700' : 'bg-gray-100 border-gray-300'}`}
                                >
                                    {guest.name} <span className="text-gray-400">(guest)</span>
                                </button>
                            ))}
                        </div>
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
                                                 {getParticipantName(p)}
                                                 {p.isGuest && <span className="text-orange-500 ml-1">(guest)</span>}
                                             </span>
                                             <div className="flex items-center">
                                                 <input
                                                    type="number"
                                                    className="w-16 border rounded p-1 text-sm text-right"
                                                    placeholder="0"
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
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddExpenseModal;
