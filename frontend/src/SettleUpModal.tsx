import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { api } from './services/api';
import { formatDateForInput } from './utils/formatters';
import AlertDialog from './components/AlertDialog';

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
    preselectedFriendId?: number | null;
}

const SettleUpModal: React.FC<SettleUpModalProps> = ({ isOpen, onClose, onSettled, friends, preselectedFriendId = null }) => {
    const { user } = useAuth();
    const [payerId] = useState<number>(user?.id || 0);
    const [recipientId, setRecipientId] = useState<number>(preselectedFriendId || friends[0]?.id || 0);
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [currencies] = useState<string[]>(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'CNY', 'HKD']);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'success' | 'error';
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'alert'
    });

    // Reset recipient when modal opens with preselected friend
    useEffect(() => {
        if (isOpen) {
            setRecipientId(preselectedFriendId || friends[0]?.id || 0);
            setAmount('');
            setCurrency('USD');
        }
    }, [isOpen, preselectedFriendId, friends]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Please enter a valid amount',
                type: 'error'
            });
            return;
        }

        setIsSubmitting(true);

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

        try {
            const response = await api.expenses.create(payload);

            if (response.ok) {
                onSettled();
                onClose();
                setAmount('');
            } else {
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: 'Failed to settle up',
                    type: 'error'
                });
            }
        } catch {
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to settle up',
                type: 'error'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50"
            onClick={handleBackdropClick}
        >
            <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-xl dark:shadow-gray-900/50 w-96">
                <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Settle Up</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label htmlFor="recipient-select" className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">You paid</label>
                        <select
                            id="recipient-select"
                            aria-label="Recipient"
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
                            aria-label="Currency"
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className="border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-transparent text-gray-700 dark:text-gray-200 dark:bg-gray-700"
                        >
                            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                            aria-label="Amount"
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
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center">
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
            </div>

            {/* Alert Dialog */}
            <AlertDialog
                isOpen={alertDialog.isOpen}
                onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
                title={alertDialog.title}
                message={alertDialog.message}
                type={alertDialog.type}
            />
        </div>
    );
};

export default SettleUpModal;
