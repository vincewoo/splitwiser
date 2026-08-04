import React, { useState, useEffect } from 'react';
import { ArrowRight, Check, CheckCircle, X } from '@phosphor-icons/react';
import { useAuth } from './AuthContext';
import { api } from './services/api';
import { formatMoney } from './utils/formatters';
import { Avatar, Button, Card, Money, Notice } from './components/ui';
import VenmoButton from './components/VenmoButton';
import { buildVenmoLinks, venmoUnavailableNote } from './utils/venmo';
import type { SettlementParticipant, SimplifiedTransaction } from './utils/settlement';

interface SimplifyDebtsModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: number;
  /** Only for the Venmo memo, so the recipient knows what the payment is for. */
  groupName?: string;
  members: Array<{ id: number; user_id: number; full_name: string }>;
  guests: Array<{ id: number; name: string }>;
  onPaymentCreated?: () => void; // Callback to refresh balances after payment
}

const SimplifyDebtsModal: React.FC<SimplifyDebtsModalProps> = ({
  isOpen,
  onClose,
  groupId,
  groupName,
  members,
  guests,
  onPaymentCreated,
}) => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<SimplifiedTransaction[]>([]);
  const [participants, setParticipants] = useState<SettlementParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingPaymentIndex, setProcessingPaymentIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchSimplifiedDebts();
    }
  }, [isOpen, groupId]);

  const fetchSimplifiedDebts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.balances.simplifyDebts(groupId);
      setTransactions(response.transactions || []);
      // Carries the Venmo handles for everyone in the group, not just friends.
      setParticipants(response.participants || []);
    } catch (err) {
      console.error('Failed to fetch simplified debts:', err);
      setError('Failed to load simplified debts. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getParticipantName = (userId: number, isGuest: boolean): string => {
    if (isGuest) {
      const guest = guests.find(g => g.id === userId);
      return guest ? guest.name : `Guest ${userId}`;
    } else {
      const member = members.find(m => m.user_id === userId);
      return member ? member.full_name : `User ${userId}`;
    }
  };

  /**
   * The Venmo hand-off for a transaction, when there is one to offer.
   *
   * This modal lists the whole group's payments, including ones between two
   * other people. Those are real and worth showing, but they are not this
   * user's to make — offering to charge someone else's debt to their Venmo
   * would be wrong, so they get nothing.
   *
   * `reachable` says the counterparty is an account that could in principle be
   * paid, which is what decides whether an absent link deserves an explanation:
   * a guest has no Venmo to reach, so "only sends US dollars" would be beside
   * the point there.
   */
  const handoffFor = (transaction: SimplifiedTransaction) => {
    const none = { links: null, action: 'pay' as const, reachable: false };

    const iAmPayer = !transaction.from_is_guest && transaction.from_id === user?.id;
    const iAmPayee = !transaction.to_is_guest && transaction.to_id === user?.id;
    if (iAmPayer === iAmPayee) return none;

    const otherId = iAmPayer ? transaction.to_id : transaction.from_id;
    const otherIsGuest = iAmPayer ? transaction.to_is_guest : transaction.from_is_guest;
    if (otherIsGuest) return none; // no account, nothing to pay into

    // I owe them → pay. They owe me → ask.
    const action = iAmPayer ? ('pay' as const) : ('request' as const);
    const other = participants.find(p => p.user_id === otherId && !p.is_guest);
    if (!other?.venmo_username) return { links: null, action, reachable: false };

    return {
      action,
      reachable: true,
      links: buildVenmoLinks({
        username: other.venmo_username,
        amountCents: Math.round(transaction.amount),
        currency: transaction.currency,
        action,
        // Plain ASCII: this lands in a Venmo memo, where anything else
        // arrives as percent-encoded noise.
        note: groupName ? `Settling up: ${groupName}` : 'Settling up',
      }),
    };
  };

  const handleMarkAsPaid = async (transaction: SimplifiedTransaction, index: number) => {
    setProcessingPaymentIndex(index);
    try {
      const payerName = getParticipantName(transaction.from_id, transaction.from_is_guest);
      const payeeName = getParticipantName(transaction.to_id, transaction.to_is_guest);
      const today = new Date().toISOString().split('T')[0];

      // Create expense where payer is the person who owes money
      // and the only participant is the person who is owed money
      await api.expenses.create({
        description: `Payment (${payerName} → ${payeeName})`,
        amount: Math.round(transaction.amount), // Convert to cents
        currency: transaction.currency,
        date: today,
        group_id: groupId,
        payer_id: transaction.from_id,
        payer_is_guest: transaction.from_is_guest,
        split_type: 'EQUAL',
        icon: '🏦',
        notes: 'Created by Simplify Debts',
        is_settlement: true,
        splits: [
          {
            user_id: transaction.to_id,
            is_guest: transaction.to_is_guest,
            amount_owed: Math.round(transaction.amount), // The payee owes this amount (it's a payment)
          },
        ],
      });

      // Remove this transaction from the list
      setTransactions(prev => prev.filter((_, i) => i !== index));

      // Notify parent to refresh balances
      if (onPaymentCreated) {
        onPaymentCreated();
      }
    } catch (err) {
      console.error('Failed to create payment expense:', err);
      setError('Failed to mark payment as paid. Please try again.');
    } finally {
      setProcessingPaymentIndex(null);
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
      className="fixed inset-0 bg-black/55 flex items-center justify-center p-4 z-50 font-sans"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Simplified debts"
        className="bg-sw-surface text-sw-text rounded-sw-card-lg shadow-[0_0_0_1px_var(--sw-line)] max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-sw-line">
          <div>
            <h2 className="sw-heading text-[19px]">Simplified debts</h2>
            <p className="text-[12.5px] text-sw-dim mt-1">
              Minimum transactions needed to settle all group balances
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sw-dim hover:text-sw-text p-2 -mr-2 -mt-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 rounded-lg"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-sw-line border-t-sw-accent"></div>
              <p className="mt-4 text-[12.5px] text-sw-muted">Calculating optimal payments…</p>
            </div>
          ) : error ? (
            <Notice tone="error">{error}</Notice>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-sw-pos-soft text-sw-pos rounded-full flex items-center justify-center mb-4">
                <CheckCircle size={32} weight="fill" aria-hidden="true" />
              </div>
              <h3 className="sw-heading text-[17px] mb-1.5">All settled up</h3>
              <p className="text-[12.5px] text-sw-muted text-center">
                Everyone is even. No payments needed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info Banner */}
              <Notice tone="info">
                These {transactions.length} payment{transactions.length !== 1 ? 's' : ''} will settle all balances in the group.
                {transactions.length > 0 && transactions[0].currency !== 'USD' && (
                  <> All amounts are shown in {transactions[0].currency} (the group's default currency), converted using historical exchange rates.</>
                )}
                {transactions.length > 0 && transactions[0].currency === 'USD' && (
                  <> All amounts are shown in USD, converted using historical exchange rates.</>
                )}
              </Notice>

              {/* Transaction List */}
              <div className="space-y-3">
                {transactions.map((transaction, index) => {
                  const payerName = getParticipantName(transaction.from_id, transaction.from_is_guest);
                  const payeeName = getParticipantName(transaction.to_id, transaction.to_is_guest);
                  return (
                    <Card key={index} tone="sunk" className="p-4">
                      <div className="flex items-center justify-between gap-4 mb-3">
                        {/* From Person */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Avatar name={payerName} size={38} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{payerName}</p>
                              <p className="text-[11.5px] text-sw-dim">Pays</p>
                            </div>
                          </div>
                        </div>

                        {/* Arrow and Amount */}
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <ArrowRight size={20} className="text-sw-dim" aria-hidden="true" />
                          <Money
                            amount={transaction.amount}
                            currency={transaction.currency}
                            className="sw-display text-[17px]"
                          />
                        </div>

                        {/* To Person */}
                        <div className="flex-1 min-w-0 flex justify-end">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 text-right">
                              <p className="text-sm font-medium truncate">{payeeName}</p>
                              <p className="text-[11.5px] text-sw-dim">Receives</p>
                            </div>
                            <Avatar name={payeeName} variant="accent" size={38} />
                          </div>
                        </div>
                      </div>

                      {/* Hand off to Venmo, then record it — two separate acts */}
                      {(() => {
                        const { links, action, reachable } = handoffFor(transaction);
                        const missing =
                          reachable && !links
                            ? venmoUnavailableNote(transaction.currency)
                            : null;
                        const counterparty = action === 'pay' ? payeeName : payerName;
                        return (
                          <>
                            <div className="flex justify-end gap-2">
                              {links && (
                                <VenmoButton
                                  links={links}
                                  action={action}
                                  counterparty={counterparty}
                                />
                              )}
                              <Button
                                variant="primary"
                                onClick={() => handleMarkAsPaid(transaction, index)}
                                disabled={processingPaymentIndex === index}
                                icon={
                                  processingPaymentIndex === index ? (
                                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sw-line border-t-sw-accent" />
                                  ) : (
                                    <Check size={14} />
                                  )
                                }
                              >
                                {processingPaymentIndex === index ? 'Processing…' : 'Mark as paid'}
                              </Button>
                            </div>
                            {links && (
                              <p className="text-[11.5px] text-sw-dim mt-2 text-right">
                                Venmo opens with the amount filled in. Mark it paid
                                once it&rsquo;s sent.
                              </p>
                            )}
                            {missing && (
                              <p className="text-[11.5px] text-sw-dim mt-2 text-right">
                                {missing}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </Card>
                  );
                })}
              </div>

              {/* Summary */}
              <Card tone="sunk" className="p-4">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-sw-muted">Total transactions</span>
                  <span className="sw-num font-medium">{transactions.length}</span>
                </div>
                <div className="flex items-center justify-between text-[12.5px] mt-2">
                  <span className="text-sw-muted">Total amount to transfer</span>
                  <Money
                    amount={transactions.reduce((sum, t) => sum + t.amount, 0)}
                    currency={transactions.length > 0 ? transactions[0].currency : 'USD'}
                    className="font-medium"
                  />
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-sw-line p-5">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {transactions.length > 0 && (
              <Button
                variant="primary"
                onClick={() => {
                  // Copy transactions to clipboard as text
                  const text = transactions
                    .map((t, i) =>
                      `${i + 1}. ${getParticipantName(t.from_id, t.from_is_guest)} → ${getParticipantName(t.to_id, t.to_is_guest)}: ${formatMoney(t.amount, t.currency)}`
                    )
                    .join('\n');
                  navigator.clipboard.writeText(text);
                  // You could add a toast notification here
                }}
              >
                Copy to clipboard
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimplifyDebtsModal;
