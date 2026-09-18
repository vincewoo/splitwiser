import React, { useCallback, useState, useEffect } from 'react';
import { ArrowRight, Check, CheckCircle, PencilSimple, UserPlus, X } from '@phosphor-icons/react';
import { useAuth } from './AuthContext';
import { api } from './services/api';
import { formatMoney } from './utils/formatters';
import { Avatar, Button, Card, Money, Notice } from './components/ui';
import OffPlanPaymentSheet from './components/OffPlanPaymentSheet';
import SettleAmountSheet from './components/SettleAmountSheet';
import VenmoButton from './components/VenmoButton';
import { classifySettleCents, partialPaymentNote, settlementExpense } from './utils/settleAmount';
import { buildVenmoLinks, venmoUnavailableNote } from './utils/venmo';
import { paymentKey } from './utils/settlement';
import type { OffPlanPayment, PaymentPerson } from './components/OffPlanPaymentSheet';
import type { SettlementParticipant, SimplifiedTransaction } from './utils/settlement';

interface SimplifyDebtsModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: number;
  /** Only for the Venmo memo, so the recipient knows what the payment is for. */
  groupName?: string;
  /** The currency a payment in this group is recorded in — the plan's, and
   *  the only one that cancels a debt here exactly. Needed even when the plan
   *  is empty, since a payment can still be recorded then. */
  groupCurrency: string;
  members: Array<{ id: number; user_id: number; full_name: string }>;
  guests: Array<{ id: number; name: string }>;
  onPaymentCreated?: () => void; // Callback to refresh balances after payment
}

const SimplifyDebtsModal: React.FC<SimplifyDebtsModalProps> = ({
  isOpen,
  onClose,
  groupId,
  groupName,
  groupCurrency,
  members,
  guests,
  onPaymentCreated,
}) => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<SimplifiedTransaction[]>([]);
  const [participants, setParticipants] = useState<SettlementParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Rows are identified by the pair they settle, never by position: recording
   * one removes it and shifts the rest, so an index held across an await —
   * or an open sheet — would land on the wrong two people.
   */
  const keyOf = (t: SimplifiedTransaction) => paymentKey(groupId, t);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  /** The transaction whose amount is being edited, when the sheet is open. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** The sheet for a payment the plan never suggested. */
  const [offPlan, setOffPlan] = useState(false);
  const [offPlanBusy, setOffPlanBusy] = useState(false);
  const [offPlanError, setOffPlanError] = useState<string | null>(null);

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
   * Which side of a transaction the signed-in user is on, or null for one
   * between two other people.
   */
  const sideOf = (transaction: SimplifiedTransaction): 'payer' | 'payee' | null => {
    const iAmPayer = !transaction.from_is_guest && transaction.from_id === user?.id;
    const iAmPayee = !transaction.to_is_guest && transaction.to_id === user?.id;
    if (iAmPayer === iAmPayee) return null;
    return iAmPayer ? 'payer' : 'payee';
  };

  /** The other party's handle, or null: a guest, or nobody who published one. */
  const venmoUsernameFor = (
    transaction: SimplifiedTransaction,
    you: 'payer' | 'payee'
  ): string | null => {
    const otherId = you === 'payer' ? transaction.to_id : transaction.from_id;
    const otherIsGuest = you === 'payer' ? transaction.to_is_guest : transaction.from_is_guest;
    if (otherIsGuest) return null; // no account, nothing to pay into
    const other = participants.find(p => p.user_id === otherId && !p.is_guest);
    return other?.venmo_username ?? null;
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

    const you = sideOf(transaction);
    if (!you) return none;

    // I owe them → pay. They owe me → ask.
    const action = you === 'payer' ? ('pay' as const) : ('request' as const);
    const username = venmoUsernameFor(transaction, you);
    if (!username) return { links: null, action, reachable: false };

    return {
      action,
      reachable: true,
      links: buildVenmoLinks({
        username,
        amountCents: Math.round(transaction.amount),
        currency: transaction.currency,
        action,
        // Plain ASCII: this lands in a Venmo memo, where anything else
        // arrives as percent-encoded noise.
        note: groupName ? `Settling up: ${groupName}` : 'Settling up',
      }),
    };
  };

  /**
   * Record one of the plan's payments as a settlement expense.
   *
   * `cents` defaults to the suggested figure. Anything else is what actually
   * changed hands — rounded, or part of it — and is recorded as such, with a
   * note saying what it was measured against. Returns whether it was
   * recorded; the caller owns the error, since the row and the amount sheet
   * each show theirs in a different place.
   */
  const recordPayment = async (
    transaction: SimplifiedTransaction,
    cents: number = Math.round(transaction.amount)
  ): Promise<boolean> => {
    const key = keyOf(transaction);
    setProcessingKey(key);
    try {
      const payerName = getParticipantName(transaction.from_id, transaction.from_is_guest);
      const payeeName = getParticipantName(transaction.to_id, transaction.to_is_guest);
      const today = new Date().toISOString().split('T')[0];

      const status = classifySettleCents(cents, transaction.amount);
      const against = partialPaymentNote(status, transaction.amount, transaction.currency);

      // The payer is the person who owes money and the only participant is
      // the person who is owed it, so the split cancels that much of the debt.
      // apiFetch does not throw on a 4xx/5xx, so the status has to be read.
      const response = await api.expenses.create(
        settlementExpense({
          description: `Payment (${payerName} → ${payeeName})`,
          notes: against
            ? `Created by Simplify Debts · ${against}`
            : 'Created by Simplify Debts',
          cents,
          currency: transaction.currency,
          groupId,
          payer: { userId: transaction.from_id, isGuest: transaction.from_is_guest },
          payee: { userId: transaction.to_id, isGuest: transaction.to_is_guest },
          date: today,
        })
      );
      if (!response.ok) return false;

      if (status.kind === 'partial') {
        // The plan is stable under being paid, so the rest of the list stands
        // and this row simply shrinks by what was paid.
        setTransactions(prev =>
          prev.map(t => (keyOf(t) === key ? { ...t, amount: t.amount - cents } : t))
        );
      } else {
        // Remove this transaction from the list
        setTransactions(prev => prev.filter(t => keyOf(t) !== key));
      }

      // Notify parent to refresh balances
      if (onPaymentCreated) {
        onPaymentCreated();
      }
      return true;
    } catch (err) {
      console.error('Failed to create payment expense:', err);
      return false;
    } finally {
      setProcessingKey(null);
    }
  };

  /** The row's one tap: the suggested figure in full. */
  const handleMarkAsPaid = async (transaction: SimplifiedTransaction) => {
    setError(null);
    if (!(await recordPayment(transaction))) {
      setError('Failed to mark payment as paid. Please try again.');
    }
  };

  /** The sheet's path, keeping its error in the sheet. */
  const recordCustom = async (cents: number) => {
    const transaction = transactions.find(t => keyOf(t) === editingKey);
    if (!transaction) return;
    setEditError(null);
    const ok = await recordPayment(transaction, cents);
    if (ok) setEditingKey(null);
    else setEditError('Failed to record that payment. Please try again.');
  };

  /**
   * Everyone in the group, for the off-plan sheet. The roster is the group's
   * own — somebody with no balance is not in the plan but can still be paid.
   * Handles come from the plan's directory, which covers every member.
   */
  const loadPeople = useCallback(async (): Promise<PaymentPerson[]> => {
    const handle = (userId: number) =>
      participants.find(p => p.user_id === userId && !p.is_guest)?.venmo_username ?? null;
    return [
      ...members.map(m => ({
        userId: m.user_id,
        isGuest: false,
        name: m.full_name,
        venmoUsername: handle(m.user_id),
      })),
      ...guests.map(g => ({ userId: g.id, isGuest: true, name: g.name })),
    ];
  }, [members, guests, participants]);

  /** A payment the plan never suggested: record it, then re-plan. */
  const recordOffPlan = async (payment: OffPlanPayment) => {
    setOffPlanBusy(true);
    setOffPlanError(null);
    try {
      const response = await api.expenses.create(
        settlementExpense({
          description: `Payment (${payment.payer.name} → ${payment.payee.name})`,
          notes: 'Created by Simplify Debts · not one of the suggested payments',
          cents: payment.cents,
          currency: payment.currency,
          groupId,
          payer: payment.payer,
          payee: payment.payee,
          date: new Date().toISOString().split('T')[0],
        })
      );
      if (!response.ok) {
        setOffPlanError('Failed to record that payment. Please try again.');
        return;
      }
      setOffPlan(false);
      // Paying somebody the plan never named is the one thing that legitimately
      // re-plans the group, so fetch the new answer rather than patching the list.
      await fetchSimplifiedDebts();
      onPaymentCreated?.();
    } catch (err) {
      console.error('Failed to create payment expense:', err);
      setOffPlanError('Failed to record that payment. Please try again.');
    } finally {
      setOffPlanBusy(false);
    }
  };

  /** The transaction being edited with the sheet's view of it, or null. */
  const editingTransaction = transactions.find(t => keyOf(t) === editingKey) ?? null;
  const editing = editingTransaction && {
    transaction: editingTransaction,
    you: sideOf(editingTransaction),
    payer: getParticipantName(editingTransaction.from_id, editingTransaction.from_is_guest),
    payee: getParticipantName(editingTransaction.to_id, editingTransaction.to_is_guest),
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
                {transactions.map(transaction => {
                  const key = keyOf(transaction);
                  const processing = processingKey === key;
                  const payerName = getParticipantName(transaction.from_id, transaction.from_is_guest);
                  const payeeName = getParticipantName(transaction.to_id, transaction.to_is_guest);
                  return (
                    <Card key={key} tone="sunk" className="p-4">
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
                                onClick={() => handleMarkAsPaid(transaction)}
                                disabled={processing}
                                icon={
                                  processing ? (
                                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sw-line border-t-sw-accent" />
                                  ) : (
                                    <Check size={14} />
                                  )
                                }
                              >
                                {processing ? 'Processing…' : 'Mark as paid'}
                              </Button>
                            </div>
                            {/*
                              * The figure is a suggestion. What was actually
                              * paid may be rounded, or part of it.
                              */}
                            <div className="flex justify-end mt-1">
                              <Button
                                variant="ghost"
                                icon={<PencilSimple size={14} />}
                                disabled={processing}
                                onClick={() => {
                                  setEditError(null);
                                  setEditingKey(key);
                                }}
                                className="text-[12.5px]"
                              >
                                Different amount…
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
          <div className="flex items-center gap-2">
            {/*
              * The plan is the fewest transfers, not the only ones. Somebody who
              * paid a person the plan did not name still needs it recorded.
              */}
            {!isLoading && !error && (
              <Button
                variant="ghost"
                icon={<UserPlus size={15} />}
                onClick={() => {
                  setOffPlanError(null);
                  setOffPlan(true);
                }}
                className="mr-auto text-[12.5px]"
              >
                Someone else…
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} className="ml-auto">
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

      {offPlan && user?.id && (
        <OffPlanPaymentSheet
          groups={[{ id: groupId, name: groupName ?? 'This group', currency: groupCurrency }]}
          loadPeople={loadPeople}
          youId={user.id}
          onClose={() => setOffPlan(false)}
          onRecord={recordOffPlan}
          busy={offPlanBusy}
          error={offPlanError}
        />
      )}

      {editing && (
        <SettleAmountSheet
          key={editingKey}
          outstanding={editing.transaction.amount}
          currency={editing.transaction.currency}
          payer={editing.payer}
          payee={editing.payee}
          you={editing.you}
          groupName={groupName ?? 'This group'}
          venmoUsername={editing.you ? venmoUsernameFor(editing.transaction, editing.you) : null}
          onClose={() => setEditingKey(null)}
          onRecord={recordCustom}
          busy={processingKey === editingKey}
          error={editError}
        />
      )}
    </div>
  );
};

export default SimplifyDebtsModal;
