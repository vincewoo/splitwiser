import React, { useState, useEffect } from 'react';
import { api } from './services/api';
import { formatMoney } from './utils/formatters';

interface SimplifiedTransaction {
  from_id: number;
  from_is_guest: boolean;
  to_id: number;
  to_is_guest: boolean;
  amount: number;
  currency: string;
}

interface SimplifyDebtsModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: number;
  members: Array<{ id: number; user_id: number; full_name: string }>;
  guests: Array<{ id: number; name: string }>;
  onPaymentCreated?: () => void; // Callback to refresh balances after payment
}

const SimplifyDebtsModal: React.FC<SimplifyDebtsModalProps> = ({
  isOpen,
  onClose,
  groupId,
  members,
  guests,
  onPaymentCreated,
}) => {
  const [transactions, setTransactions] = useState<SimplifiedTransaction[]>([]);
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
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Simplified Debts</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Minimum transactions needed to settle all group balances
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Calculating optimal payments...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
                </div>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">All Settled Up!</h3>
              <p className="text-gray-600 dark:text-gray-400 text-center">
                Everyone is even. No payments needed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info Banner */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">How it works</h3>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      These {transactions.length} payment{transactions.length !== 1 ? 's' : ''} will settle all balances in the group.
                      {transactions.length > 0 && transactions[0].currency !== 'USD' && (
                        <> All amounts are shown in {transactions[0].currency} (the group's default currency), converted using historical exchange rates.</>
                      )}
                      {transactions.length > 0 && transactions[0].currency === 'USD' && (
                        <> All amounts are shown in USD, converted using historical exchange rates.</>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Transaction List */}
              <div className="space-y-3">
                {transactions.map((transaction, index) => (
                  <div
                    key={index}
                    className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-4 hover:border-teal-400 dark:hover:border-teal-500 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4 mb-3">
                      {/* From Person */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-lg">👤</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                              {getParticipantName(transaction.from_id, transaction.from_is_guest)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Pays</p>
                          </div>
                        </div>
                      </div>

                      {/* Arrow and Amount */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                        <span className="text-lg font-bold text-teal-600 dark:text-teal-400">
                          {formatMoney(transaction.amount, transaction.currency)}
                        </span>
                      </div>

                      {/* To Person */}
                      <div className="flex-1 min-w-0 flex justify-end">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 text-right">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                              {getParticipantName(transaction.to_id, transaction.to_is_guest)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Receives</p>
                          </div>
                          <div className="w-10 h-10 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-lg">👤</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Mark as Paid Button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleMarkAsPaid(transaction, index)}
                        disabled={processingPaymentIndex === index}
                        className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {processingPaymentIndex === index ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Mark as Paid</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Total transactions:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{transactions.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="text-gray-600 dark:text-gray-400">Total amount to transfer:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {formatMoney(
                      transactions.reduce((sum, t) => sum + t.amount, 0),
                      transactions.length > 0 ? transactions[0].currency : 'USD'
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-6">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium"
            >
              Close
            </button>
            {transactions.length > 0 && (
              <button
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
                className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors font-medium"
              >
                Copy to Clipboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimplifyDebtsModal;
