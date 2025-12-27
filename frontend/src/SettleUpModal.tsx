import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { getApiUrl } from './api';
import { formatDateForInput } from './utils/formatters';

interface Friend {
    id: number;
    full_name: string;
    email: string;
}

interface SettleUpModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSettled: () => void;
    friends: Friend[];
}

const SettleUpModal: React.FC<SettleUpModalProps> = ({ isOpen, onClose, onSettled, friends }) => {
    const { user } = useAuth();
    const [payerId] = useState<number>(user?.id || 0);
    const [recipientId, setRecipientId] = useState<number>(friends[0]?.id || 0);
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [currencies] = useState<string[]>(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'CNY', 'HKD']);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Settle up is just an expense where one person pays the other full amount
        // Payer pays Amount.
        // Recipient owes Payer Amount. -> This increases Recipient's debt to Payer.
        // WAIT. "Settle Up" usually means paying back a debt.
        // If I owe Bob $50. I pay Bob $50.
        // In the system, this is recorded as a Payment.
        // A Payment is an expense where Payer = Me, Cost = $50. Split = Bob owes Me $50?
        // If Bob owes me $50, his balance with me decreases (becomes more negative for him, more positive for me).
        // If I owed him $50 (balance -50). Now he owes me $50 (+50). Net = 0.
        // YES.

        const totalAmountCents = Math.round(parseFloat(amount) * 100);

        const payload = {
            description: "Settle Up",
            amount: totalAmountCents,
            currency,
            date: formatDateForInput(new Date()),
            payer_id: payerId, // Who is paying the money physically
            group_id: null,
            split_type: 'EXACT',
            splits: [
                {
                    user_id: recipientId, // The person receiving the money (so they "owe" the payer in the system logic to offset the debt)
                    amount_owed: totalAmountCents
                }
            ]
        };

        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl('expenses'), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            onSettled();
            onClose();
            setAmount('');
        } else {
            alert('Failed to settle up');
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-xl dark:shadow-gray-900/50 w-96">
                <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Settle Up</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">You paid</label>
                        <select
                            className="w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                            value={recipientId}
                            onChange={e => setRecipientId(parseInt(e.target.value))}
                        >
                            {friends.map(f => (
                                <option key={f.id} value={f.id}>{f.full_name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4 flex items-center space-x-2">
                        <select
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className="border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-transparent text-gray-700 dark:text-gray-200 dark:bg-gray-700"
                        >
                            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            className="w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 text-lg dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex justify-end space-x-3 mt-6">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SettleUpModal;
