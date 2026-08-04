import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { api } from './services/api';
import { formatDateForInput } from './utils/formatters';
import { Button } from './components/ui';
import AlertDialog from './components/AlertDialog';
import VenmoButton from './components/VenmoButton';
import { buildVenmoLinks, venmoUnavailableNote } from './utils/venmo';
import type { Friend } from './types/friend';

interface SettleUpModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSettled: () => void;
    friends: Friend[];
    preselectedFriendId?: number | null;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'CNY', 'HKD', 'CHF'];

/**
 * A direct payment to one person, outside any group.
 *
 * The per-group simplification lives on the Settle up screen; this covers the
 * case that screen cannot — paying someone an arbitrary amount that is not
 * derived from a group's debts.
 */
const SettleUpModal: React.FC<SettleUpModalProps> = ({
    isOpen,
    onClose,
    onSettled,
    friends,
    preselectedFriendId = null,
}) => {
    const { user } = useAuth();
    const [recipientId, setRecipientId] = useState<number>(
        preselectedFriendId || friends[0]?.id || 0
    );
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [submitting, setSubmitting] = useState(false);
    const [alert, setAlert] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'success' | 'error';
    }>({ isOpen: false, title: '', message: '', type: 'alert' });

    useEffect(() => {
        if (isOpen) {
            setRecipientId(preselectedFriendId || friends[0]?.id || 0);
            setAmount('');
            setCurrency('USD');
        }
    }, [isOpen, preselectedFriendId, friends]);

    if (!isOpen) return null;

    const recipient = friends.find((f) => f.id === recipientId);
    const cents = Math.round(parseFloat(amount) * 100);

    /**
     * The hand-off, rebuilt as the amount is typed. Null until there is a real
     * figure to hand over — Venmo with a blank amount is worse than no link,
     * since it invites retyping the number this modal exists to carry.
     */
    const venmo = recipient?.venmo_username
        ? buildVenmoLinks({
              username: recipient.venmo_username,
              amountCents: cents,
              currency,
              // This modal only ever records money the signed-in user paid out.
              action: 'pay',
              note: 'Settling up',
          })
        : null;

    /** Only worth explaining once they have named a payable recipient. */
    const missing =
        recipient?.venmo_username && !venmo && cents > 0
            ? venmoUnavailableNote(currency)
            : null;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        // The payer is the signed-in user; without an id there is nothing to
        // record against. Guarded here so the payload stays fully typed.
        if (!user?.id) return;

        if (!Number.isFinite(cents) || cents <= 0) {
            setAlert({
                isOpen: true,
                title: 'Enter an amount',
                message: 'Please enter how much you paid.',
                type: 'error',
            });
            return;
        }

        setSubmitting(true);
        try {
            // Recorded as an expense the payer covered in full, which cancels
            // that much of the debt. is_settlement keeps it out of spending
            // totals and under the Settlements filter — matching how Simplify
            // Debts records one.
            const response = await api.expenses.create({
                description: 'Settle up',
                amount: cents,
                currency,
                date: formatDateForInput(new Date()),
                payer_id: user.id,
                payer_is_guest: false,
                group_id: null,
                split_type: 'EXACT',
                icon: '🏦',
                is_settlement: true,
                splits: [{ user_id: recipientId, amount_owed: cents }],
            });

            if (response.ok) {
                onSettled();
                onClose();
                setAmount('');
            } else {
                setAlert({
                    isOpen: true,
                    title: 'Error',
                    message: 'Failed to record the payment.',
                    type: 'error',
                });
            }
        } catch {
            setAlert({
                isOpen: true,
                title: 'Error',
                message: 'Failed to record the payment.',
                type: 'error',
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 font-sans"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Settle up"
                className="bg-sw-surface text-sw-text rounded-sw-card-lg shadow-[0_0_0_1px_var(--sw-line)] w-full max-w-sm p-5"
            >
                <h2 className="text-[17px] font-medium mb-4">Settle up</h2>

                <form onSubmit={handleSubmit}>
                    <label
                        className="block text-xs text-sw-muted mb-1.5"
                        htmlFor="settle-who"
                    >
                        You paid
                    </label>
                    <select
                        id="settle-who"
                        className="w-full mb-4 px-2.5 py-2 rounded-lg bg-sw-sunk text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        value={recipientId}
                        onChange={(event) =>
                            setRecipientId(parseInt(event.target.value, 10))
                        }
                    >
                        {friends.map((friend) => (
                            <option key={friend.id} value={friend.id}>
                                {friend.full_name}
                            </option>
                        ))}
                    </select>

                    <label
                        className="block text-xs text-sw-muted mb-1.5"
                        htmlFor="settle-amount"
                    >
                        Amount
                    </label>
                    <div className="flex gap-2 mb-5">
                        <select
                            aria-label="Currency"
                            value={currency}
                            onChange={(event) => setCurrency(event.target.value)}
                            className="px-2.5 py-2 rounded-lg bg-sw-sunk text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            {CURRENCIES.map((code) => (
                                <option key={code} value={code}>
                                    {code}
                                </option>
                            ))}
                        </select>
                        <input
                            id="settle-amount"
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            className="sw-num flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-sw-sunk text-sw-text border border-sw-line text-lg placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            required
                        />
                    </div>

                    {recipient && (
                        <p className="text-[12.5px] text-sw-dim mb-4">
                            Records a payment from you to {recipient.full_name}, clearing
                            that much of what you owe.
                            {venmo && (
                                <>
                                    {' '}
                                    Venmo opens with the amount filled in; saving is
                                    what records it here.
                                </>
                            )}
                            {missing && <> {missing}</>}
                        </p>
                    )}

                    <div className="flex justify-end gap-2">
                        {venmo && (
                            <VenmoButton
                                links={venmo}
                                action="pay"
                                counterparty={recipient?.full_name}
                                className="mr-auto"
                            />
                        )}
                        <Button variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" disabled={submitting}>
                            {submitting ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </form>
            </div>

            <AlertDialog
                isOpen={alert.isOpen}
                onClose={() => setAlert({ ...alert, isOpen: false })}
                title={alert.title}
                message={alert.message}
                type={alert.type}
            />
        </div>
    );
};

export default SettleUpModal;
