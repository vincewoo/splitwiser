import React, { useState } from 'react';
import { useAuth } from './AuthContext';

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
    const [payerId, setPayerId] = useState<number>(user?.id || 0);
    const [recipientId, setRecipientId] = useState<number>(friends[0]?.id || 0);
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [currencies] = useState<string[]>(['USD', 'EUR', 'GBP', 'JPY', 'CAD']);

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
            date: new Date().toISOString(),
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
        const response = await fetch('http://localhost:8000/expenses', {
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
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white p-5 rounded-lg shadow-xl w-96">
                <h2 className="text-xl font-bold mb-4">Settle Up</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">You paid</label>
                        <select
                            className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 bg-white"
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

                    <div className="flex justify-end space-x-3 mt-6">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SettleUpModal;
