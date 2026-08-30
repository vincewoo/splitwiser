import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CaretRight,
    Check,
    Info,
    Plus,
    Receipt,
    Warning,
} from '@phosphor-icons/react';
import ParticipantSelector from './ParticipantSelector';
import ExpenseSplitTypeSelector from './components/expense/ExpenseSplitTypeSelector';
import ExpenseItemList from './components/expense/ExpenseItemList';
import SplitDetailsInput from './components/expense/SplitDetailsInput';
import IconSelector from './components/expense/IconSelector';
import AddItemModal from './components/AddItemModal';
import AlertDialog from './components/AlertDialog';
import ReceiptViewer from './components/ReceiptViewer';
import TabBreakdown from './components/tab/TabBreakdown';
import { useItemizedExpense } from './hooks/useItemizedExpense';
import { useSplitDetails } from './hooks/useSplitDetails';
import type {
    ExpenseWithSplits,
    GroupMember,
    GuestMember,
    Participant,
    SplitType,
    ExpensePayload
} from './types/expense';
import {
    getParticipantName as getParticipantNameUtil
} from './utils/participantHelpers';
import {
    calculateItemizedTotal,
    calculatePersonItemBreakdown
} from './utils/expenseCalculations';
import {
    extractParticipantKeysFromExpense,
    extractSplitDetailsFromExpense,
    extractItemizedDataFromExpense,
    assembleItemizedPayload,
    assembleSplitsPayload,
    amountToCents,
    centsToDisplayAmount,
} from './utils/expenseTransformations';
import { payerParticipantId } from './utils/tabShares';
import { formatMoney, formatDate, formatItemPercent } from './utils/formatters';
import { CURRENCIES } from './utils/currencyHelpers';
import type { Tab } from './types/tab';
import { expensesApi, tabsApi } from './services/api';
import { offlineExpensesApi } from './services/offlineApi';
import { useSync } from './contexts/SyncContext';
import { Button, Card, Money, Notice, TagPill } from './components/ui';
import { CONTROL_CLASS, CONTROL_CLASS_UNSIZED } from './components/ui/controlClass';

/** The label above each field in the edit form. */
const LABEL_CLASS = 'block text-[12.5px] text-sw-muted mb-1.5';

/** The section heading in view mode ("Items", "Receipt", "Split breakdown"). */
const SECTION_CLASS =
    'text-[11px] uppercase tracking-[0.09em] text-sw-dim mb-3';

/** The small right-aligned money inputs for tax and tip. */
const MONEY_INPUT_CLASS =
    'w-28 sm:w-24 px-2.5 py-2 text-sm text-right sw-num rounded-sw-row bg-sw-sunk text-sw-text border border-sw-line placeholder:text-sw-dim min-h-[44px] focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2';

/** A togglable person in the participants row. */
const participantPillClass = (selected: boolean) =>
    `px-4 py-2 rounded-full text-sm min-h-[44px] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${
        selected
            ? 'bg-sw-accent-ghost text-sw-accent shadow-[0_0_0_1px_var(--sw-accent)]'
            : 'bg-sw-sunk text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text'
    }`;

interface ExpenseDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    expenseId: number | null;
    onExpenseUpdated: () => void;
    onExpenseDeleted: () => void;
    groupMembers: GroupMember[];
    groupGuests: GuestMember[];
    currentUserId: number;
    shareLinkId?: string;
    readOnly?: boolean;
    groupDefaultCurrency?: string;
}

const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
    isOpen,
    onClose,
    expenseId,
    onExpenseUpdated,
    onExpenseDeleted,
    groupMembers,
    groupGuests,
    currentUserId,
    shareLinkId,
    readOnly = false,
    groupDefaultCurrency
}) => {
    const { isOnline: _isOnline } = useSync();
    const navigate = useNavigate();
    const [expense, setExpense] = useState<ExpenseWithSplits | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Edit form state
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [notes, setNotes] = useState('');
    const [isSettlement, setIsSettlement] = useState(false);
    const [expenseDate, setExpenseDate] = useState('');
    const [payerId, setPayerId] = useState<number>(0);
    const [payerIsGuest, setPayerIsGuest] = useState(false);
    const [splitType, setSplitType] = useState<SplitType>('EQUAL');
    const [selectedParticipantKeys, setSelectedParticipantKeys] = useState<string[]>([]);
    const [showParticipantSelector, setShowParticipantSelector] = useState(false);
    const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showExchangeRateInfo, setShowExchangeRateInfo] = useState(false);
    /** The tab this expense closed from, for expenses that came from one. */
    const [tab, setTab] = useState<Tab | null>(null);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'success' | 'error';
        onConfirm?: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'alert'
    });

    // Quick settle state
    const [settlingGuestId, setSettlingGuestId] = useState<number | null>(null);

    // Use custom hooks
    const itemizedExpense = useItemizedExpense();
    const { splitDetails, setSplitDetails, handleSplitDetailChange } = useSplitDetails();

    // Toggle expense guest paid status
    const toggleExpenseGuestPaid = async (guestId: number, paid: boolean) => {
        if (!expense || settlingGuestId !== null) return;

        setSettlingGuestId(guestId);
        try {
            const updatedGuest = await expensesApi.toggleExpenseGuestPaid(expense.id, guestId, paid);
            // Update the expense state with the new guest data
            setExpense(prev => {
                if (!prev || !prev.expense_guests) return prev;
                return {
                    ...prev,
                    expense_guests: prev.expense_guests.map(g =>
                        g.id === guestId ? { ...g, paid: updatedGuest.paid, paid_at: updatedGuest.paid_at } : g
                    )
                };
            });
        } catch (err) {
            console.error('Failed to update guest paid status:', err);
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to update payment status',
                type: 'error'
            });
        } finally {
            setSettlingGuestId(null);
        }
    };

    useEffect(() => {
        if (isOpen && expenseId) {
            fetchExpense();
        }
    }, [isOpen, expenseId]);

    useEffect(() => {
        if (expense) {
            populateFormFromExpense(expense);
        }
    }, [expense]);

    /**
     * Pull in the tab this expense closed from, if it is one.
     *
     * A closed tab writes its expense with `split_type = "ITEMIZED"` but no
     * expense items — the item detail only ever existed on the tab — so the
     * itemised breakdown below has nothing to work from and the splits flatten
     * to one figure per person. The tab still holds who claimed what, and
     * `tab_id` is only ever sent to its owner, so this is both the one place
     * that detail can come from and a request only the owner can make.
     */
    useEffect(() => {
        const tabId = expense?.tab_id;
        if (!tabId) {
            setTab(null);
            return;
        }
        let cancelled = false;
        tabsApi
            .getById(tabId)
            .then((data: Tab) => !cancelled && setTab(data))
            // A tab that will not load is not worth an error: the split
            // breakdown below still stands on its own.
            .catch(() => !cancelled && setTab(null));
        return () => {
            cancelled = true;
        };
    }, [expense?.tab_id]);

    const fetchExpense = async () => {
        setIsLoading(true);
        setError(null);

        try {
            let data;
            if (shareLinkId) {
                data = await expensesApi.getPublicById(shareLinkId, expenseId!);
            } else {
                data = await expensesApi.getById(expenseId!);
            }
            setExpense(data);
        } catch {
            setError('Failed to load expense details');
        } finally {
            setIsLoading(false);
        }
    };

    const populateFormFromExpense = (exp: ExpenseWithSplits) => {
        setDescription(exp.description);
        setAmount(centsToDisplayAmount(exp.amount));
        setCurrency(exp.currency);
        setExpenseDate(exp.date.split('T')[0]);
        setPayerId(exp.payer_id);
        setPayerIsGuest(exp.payer_is_guest);
        setSplitType(exp.split_type as SplitType || 'EQUAL');
        setSelectedIcon(exp.icon || null);
        setNotes(exp.notes || '');
        setIsSettlement(exp.is_settlement || false);

        // Set selected participants from splits
        setSelectedParticipantKeys(extractParticipantKeysFromExpense(exp));

        // Set split details for non-EQUAL types
        const details = extractSplitDetailsFromExpense(exp);
        if (Object.keys(details).length > 0) {
            setSplitDetails(details);
        } else {
            setSplitDetails({});
        }

        // Handle ITEMIZED expenses
        if (exp.split_type === 'ITEMIZED' && exp.items) {
            const itemizedData = extractItemizedDataFromExpense(exp.items);
            itemizedExpense.setItems(itemizedData.items);
            itemizedExpense.setTaxAmount(itemizedData.taxAmount);
            itemizedExpense.setTipAmount(itemizedData.tipAmount);
        } else {
            itemizedExpense.setItems([]);
            itemizedExpense.setTaxAmount('');
            itemizedExpense.setTipAmount('');
        }
    };

    // Formatters now imported from utils

    const getPayerName = () => {
        if (!expense) return '';
        if (expense.payer_is_guest) {
            const guest = groupGuests.find(g => g.id === expense.payer_id);
            return guest?.name || 'Unknown Guest';
        }
        if (expense.payer_id === currentUserId) return 'You';
        const member = groupMembers.find(m => m.user_id === expense.payer_id);
        return member?.full_name || 'Unknown';
    };

    const getAllParticipants = (): Participant[] => {
        const participants: Participant[] = [];

        selectedParticipantKeys.forEach(key => {
            const [type, idStr] = key.split('_');
            const id = parseInt(idStr);

            if (type === 'guest') {
                const guest = groupGuests.find(g => g.id === id);
                if (guest) {
                    participants.push({ id: guest.id, name: guest.name, isGuest: true });
                }
            } else if (type === 'expenseguest') {
                // For expense guests (non-group expenses)
                const expenseGuest = expense?.expense_guests?.find(eg => eg.id === id);
                if (expenseGuest) {
                    participants.push({ id: expenseGuest.id, name: expenseGuest.name, isGuest: false, isExpenseGuest: true });
                }
            } else {
                const member = groupMembers.find(m => m.user_id === id);
                if (member) {
                    participants.push({
                        id: member.user_id,
                        name: member.user_id === currentUserId ? 'You' : member.full_name,
                        isGuest: false
                    });
                }
            }
        });

        return participants;
    };

    const getPotentialPayers = (): Participant[] => {
        // If we have group members, return all available participants (sorted)
        if (groupMembers.length > 0 || groupGuests.length > 0) {
            return getAvailableParticipants();
        }

        // Otherwise (friend expense), only return selected participants
        // (Though in this app version, maybe we only have group expenses or friend expenses behave effectively as groups of 2. 
        //  The logic in AddExpenseModal was stricter for friends, so let's stick to valid logic.)
        return getAllParticipants().sort((a, b) => {
            if (a.name === 'You') return -1;
            if (b.name === 'You') return 1;
            return a.name.localeCompare(b.name);
        });
    };

    const getParticipantName = (p: Participant): string => {
        return getParticipantNameUtil(p, currentUserId);
    };

    const toggleParticipant = (key: string) => {
        if (selectedParticipantKeys.includes(key)) {
            setSelectedParticipantKeys(selectedParticipantKeys.filter(k => k !== key));
        } else {
            setSelectedParticipantKeys([...selectedParticipantKeys, key]);
        }
    };

    const getAvailableParticipants = (): Participant[] => {
        const participants: Participant[] = [];

        groupMembers.forEach(m => {
            participants.push({
                id: m.user_id,
                name: m.user_id === currentUserId ? 'You' : m.full_name,
                isGuest: false
            });
        });

        groupGuests.forEach(g => {
            participants.push({
                id: g.id,
                name: g.name,
                isGuest: true
            });
        });

        // Include expense guests for non-group expenses
        if (expense?.expense_guests) {
            expense.expense_guests.forEach(eg => {
                participants.push({
                    id: eg.id,
                    name: eg.name,
                    isGuest: false,
                    isExpenseGuest: true
                });
            });
        }

        // Sort: "You" first, then alphabetically
        return participants.sort((a, b) => {
            if (a.name === 'You') return -1;
            if (b.name === 'You') return 1;
            return a.name.localeCompare(b.name);
        });
    };

    const handleMainParticipantSelectorConfirm = (selectedParticipants: Participant[]) => {
        const keys = selectedParticipants.map(p => {
            if (p.isExpenseGuest) {
                return `expenseguest_${p.id}`;
            }
            return p.isGuest ? `guest_${p.id}` : `user_${p.id}`;
        });
        setSelectedParticipantKeys(keys);
        setShowParticipantSelector(false);
    };

    const handleParticipantSelectorConfirm = (itemIdx: number, selectedParticipants: Participant[]) => {
        itemizedExpense.updateItemAssignments(itemIdx, selectedParticipants.map(p => {
            if (p.isExpenseGuest) {
                return {
                    user_id: p.id,
                    is_guest: false,
                    expense_guest_id: p.id
                };
            }
            return {
                user_id: p.id,
                is_guest: p.isGuest
            };
        }));
        itemizedExpense.setEditingItemIndex(null);
    };

    const getSelectedParticipantsDisplay = (): string => {
        const total = selectedParticipantKeys.length;
        if (total === 0) return 'Select people';
        const participants = getAllParticipants();
        if (total === 1) {
            const p = participants[0];
            return p?.name || 'Unknown';
        }
        return `${total} people selected`;
    };

    const handleSave = async () => {
        const totalAmountCents = amountToCents(amount);
        const allParticipants = getAllParticipants();

        // Calculate splits (assembleSplitsPayload filters out expense guests internally)
        const splitResult = assembleSplitsPayload(splitType, allParticipants, splitDetails, totalAmountCents);
        if (splitResult.error) {
            setAlertDialog({
                isOpen: true,
                title: 'Invalid Split',
                message: splitResult.error,
                type: 'error'
            });
            return;
        }

        const payload: ExpensePayload = {
            description,
            amount: totalAmountCents,
            currency,
            date: expenseDate,
            payer_id: payerId,
            payer_is_guest: payerIsGuest,
            splits: splitResult.splits,
            split_type: splitType,
            icon: selectedIcon,
            notes,
            is_settlement: isSettlement
        };

        if (splitType === 'ITEMIZED') {
            setIsSubmitting(true);
            try {
                const { items: allItems, totalCents: itemsTotal } = assembleItemizedPayload(
                    itemizedExpense.itemizedItems,
                    itemizedExpense.taxAmount,
                    itemizedExpense.tipAmount,
                );

                const itemizedPayload: ExpensePayload = {
                    description,
                    amount: itemsTotal,
                    currency,
                    date: expenseDate,
                    payer_id: payerId,
                    payer_is_guest: payerIsGuest,
                    split_type: 'ITEMIZED',
                    items: allItems,
                    splits: splitResult.splits,
                    icon: selectedIcon,
                    notes,
                    is_settlement: isSettlement
                };

                const result = await offlineExpensesApi.update(expenseId!, itemizedPayload);

                if (result.success) {
                    if (result.offline) {
                        console.log('Expense updated offline and queued for sync');
                    }
                    setIsEditing(false);
                    onExpenseUpdated();
                    onClose();
                } else {
                    setAlertDialog({
                        isOpen: true,
                        title: 'Error',
                        message: 'Failed to update expense',
                        type: 'error'
                    });
                }
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await offlineExpensesApi.update(expenseId!, payload);

            if (result.success) {
                if (result.offline) {
                    console.log('Expense updated offline and queued for sync');
                }
                setIsEditing(false);
                onExpenseUpdated();
                onClose();
            } else {
                setAlertDialog({
                    isOpen: true,
                    title: 'Error',
                    message: 'Failed to update expense',
                    type: 'error'
                });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        const result = await offlineExpensesApi.delete(expenseId!);

        if (result.success) {
            if (result.offline) {
                console.log('Expense deleted offline and queued for sync');
            }
            onExpenseDeleted();
            onClose();
        } else {
            setAlertDialog({
                isOpen: true,
                title: 'Error',
                message: 'Failed to delete expense',
                type: 'error'
            });
        }
    };

    const handleClose = () => {
        setIsEditing(false);
        setShowDeleteConfirm(false);
        setError(null);
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    };

    if (!isOpen) return null;

    // All group members can edit/delete expenses (not just the creator)
    const canEdit = !readOnly;

    return (
        <div
            className="fixed inset-0 bg-black/55 z-40 flex items-end md:items-center justify-center font-sans"
            onClick={handleBackdropClick}
        >
            {showParticipantSelector && (
                <ParticipantSelector
                    isOpen={true}
                    onClose={() => setShowParticipantSelector(false)}
                    participants={getAvailableParticipants()}
                    selectedParticipants={getAllParticipants()}
                    onConfirm={handleMainParticipantSelectorConfirm}
                    itemDescription="Select participants for this expense"
                />
            )}
            {itemizedExpense.editingItemIndex !== null && (
                <ParticipantSelector
                    isOpen={true}
                    onClose={() => itemizedExpense.setEditingItemIndex(null)}
                    participants={getAllParticipants()}
                    selectedParticipants={getAllParticipants().filter(p => {
                        const item = itemizedExpense.itemizedItems[itemizedExpense.editingItemIndex!];
                        return item?.assignments.some(a => {
                            if (p.isExpenseGuest) {
                                return a.expense_guest_id === p.id;
                            }
                            return a.user_id === p.id && a.is_guest === p.isGuest;
                        });
                    })}
                    onConfirm={(selected) => handleParticipantSelectorConfirm(itemizedExpense.editingItemIndex!, selected)}
                    itemDescription={itemizedExpense.itemizedItems[itemizedExpense.editingItemIndex]?.description || ''}
                />
            )}
            <div
                role="dialog"
                aria-modal="true"
                aria-label={isEditing ? 'Edit expense' : 'Expense details'}
                className="bg-sw-surface text-sw-text w-full md:w-[448px] max-h-[90vh] rounded-t-sw-sheet md:rounded-sw-card-lg shadow-[0_0_0_1px_var(--sw-line)] overflow-y-auto flex flex-col"
            >
                {isLoading ? (
                    <div className="text-center py-8 text-[12.5px] text-sw-dim">Loading…</div>
                ) : error ? (
                    <div className="text-center py-8 px-5">
                        <Notice tone="error" className="mb-4 text-left">{error}</Notice>
                        <Button variant="ghost" onClick={handleClose}>Close</Button>
                    </div>
                ) : expense ? (
                    <>
                        {/* Header */}
                        <div className="sticky top-0 bg-sw-surface z-10 p-4 sm:p-5 border-b border-sw-line flex justify-between items-center gap-2">
                            <h2 className="sw-heading text-[17px]">
                                {isEditing ? 'Edit expense' : 'Expense details'}
                            </h2>
                            {canEdit && !isEditing && !showDeleteConfirm && (
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => setIsEditing(true)}
                                        className="min-h-[38px]"
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setShowDeleteConfirm(true)}
                                        className="min-h-[38px] text-sw-neg border-sw-neg"
                                    >
                                        Delete
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Delete Confirmation */}
                        {showDeleteConfirm && (
                            <div className="bg-sw-neg-soft rounded-sw-card p-4 m-4 sm:m-5">
                                <p className="text-[12.5px] text-sw-neg mb-3">
                                    Are you sure you want to delete this expense? This cannot be undone.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={handleDelete}
                                        className="min-h-[44px] text-sw-neg border-sw-neg"
                                    >
                                        Delete
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="min-h-[44px]"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}

                        {isEditing ? (
                            /* Edit Mode */
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                                    <div className="mb-4">
                                        <label className={LABEL_CLASS} htmlFor="expense-description">Description</label>
                                        <div className="flex items-center gap-2">
                                            <IconSelector
                                                selectedIcon={selectedIcon}
                                                onIconSelect={setSelectedIcon}
                                            />
                                            <input
                                                id="expense-description"
                                                type="text"
                                                className={CONTROL_CLASS}
                                                value={description}
                                                onChange={e => setDescription(e.target.value)}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="mb-4">
                                        <label className={LABEL_CLASS} htmlFor="expense-amount">Amount</label>
                                        <div className="flex items-center gap-2">
                                            <select
                                                aria-label="Currency"
                                                value={currency}
                                                onChange={(e) => setCurrency(e.target.value)}
                                                className={`${CONTROL_CLASS_UNSIZED} w-auto max-w-[6.5rem] flex-none`}
                                            >
                                                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                            </select>
                                            <input
                                                id="expense-amount"
                                                type="text"
                                                inputMode="decimal"
                                                placeholder="0.00"
                                                className={`${CONTROL_CLASS} sw-num text-lg min-w-0`}
                                                value={splitType === 'ITEMIZED' ? calculateItemizedTotal(itemizedExpense.itemizedItems, itemizedExpense.taxAmount, itemizedExpense.tipAmount) : amount}
                                                onChange={e => setAmount(e.target.value)}
                                                disabled={splitType === 'ITEMIZED'}
                                                required={splitType !== 'ITEMIZED'}
                                            />
                                        </div>
                                        {splitType === 'ITEMIZED' && (
                                            <p className="text-[11.5px] text-sw-dim mt-1.5">
                                                Totalled from the items below
                                            </p>
                                        )}
                                    </div>

                                    <div className="mb-4">
                                        <label className={LABEL_CLASS} htmlFor="expense-date">Date</label>
                                        <input
                                            id="expense-date"
                                            type="date"
                                            className={CONTROL_CLASS}
                                            value={expenseDate}
                                            onChange={(e) => setExpenseDate(e.target.value)}
                                            required
                                        />
                                    </div>

                                    <div className="mb-4">
                                        <label className={LABEL_CLASS} htmlFor="expense-notes">Notes</label>
                                        <textarea
                                            id="expense-notes"
                                            className={`${CONTROL_CLASS} text-sm`}
                                            placeholder="Add notes (optional)"
                                            rows={2}
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                        />
                                    </div>

                                    <div className="mb-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={isSettlement}
                                                onChange={(e) => setIsSettlement(e.target.checked)}
                                                className="w-4 h-4 rounded accent-[var(--sw-accent)] focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                            />
                                            <span className="text-sm text-sw-text">This is a settlement (payment)</span>
                                        </label>
                                    </div>

                                    <div className="mb-4">
                                        <span className={LABEL_CLASS}>Participants</span>
                                        {getAvailableParticipants().length > 6 ? (
                                            <button
                                                type="button"
                                                onClick={() => setShowParticipantSelector(true)}
                                                className="w-full px-3 py-2.5 rounded-sw-row bg-sw-sunk text-sw-text shadow-[0_0_0_1px_var(--sw-line)] hover:bg-sw-raise text-left flex items-center justify-between gap-2 min-h-[44px] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                            >
                                                <span className="text-sm">{getSelectedParticipantsDisplay()}</span>
                                                <CaretRight size={16} className="text-sw-dim flex-none" />
                                            </button>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {/*
                                                 * Members, group guests and expense-only guests used to
                                                 * be teal, orange and purple. The redesign has one
                                                 * accent, so selection is the only thing the colour
                                                 * says here; who someone is is already in their name.
                                                 */}
                                                {groupMembers.map(member => {
                                                    const key = `user_${member.user_id}`;
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            onClick={() => toggleParticipant(key)}
                                                            aria-pressed={selectedParticipantKeys.includes(key)}
                                                            className={participantPillClass(selectedParticipantKeys.includes(key))}
                                                        >
                                                            {member.user_id === currentUserId ? 'You' : member.full_name}
                                                        </button>
                                                    );
                                                })}
                                                {groupGuests.map(guest => {
                                                    const key = `guest_${guest.id}`;
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            onClick={() => toggleParticipant(key)}
                                                            aria-pressed={selectedParticipantKeys.includes(key)}
                                                            className={participantPillClass(selectedParticipantKeys.includes(key))}
                                                        >
                                                            {guest.name}
                                                        </button>
                                                    );
                                                })}
                                                {expense?.expense_guests?.map(expenseGuest => {
                                                    const key = `expenseguest_${expenseGuest.id}`;
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            onClick={() => toggleParticipant(key)}
                                                            aria-pressed={selectedParticipantKeys.includes(key)}
                                                            className={participantPillClass(selectedParticipantKeys.includes(key))}
                                                        >
                                                            {expenseGuest.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {getPotentialPayers().length > 1 && (
                                        <div className="mb-4">
                                            <label className={LABEL_CLASS} htmlFor="expense-payer">Paid by</label>
                                            <select
                                                id="expense-payer"
                                                value={payerIsGuest ? `guest_${payerId}` : `user_${payerId}`}
                                                onChange={(e) => {
                                                    const [type, id] = e.target.value.split('_');
                                                    setPayerId(parseInt(id));
                                                    setPayerIsGuest(type === 'guest');
                                                }}
                                                className={CONTROL_CLASS}
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
                                        <span className={LABEL_CLASS}>Split by</span>
                                        <ExpenseSplitTypeSelector value={splitType} onChange={setSplitType} />

                                        {splitType === 'ITEMIZED' && (
                                            <Card tone="sunk" className="p-3 mt-3">
                                                <div className="flex justify-between items-center gap-2 mb-3">
                                                    <p className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">Assign items</p>
                                                    <Button
                                                        variant="ghost"
                                                        onClick={itemizedExpense.openAddItemModal}
                                                        icon={<Plus size={14} />}
                                                        className="min-h-[38px]"
                                                    >
                                                        Add item
                                                    </Button>
                                                </div>

                                                <ExpenseItemList
                                                    items={itemizedExpense.itemizedItems}
                                                    participants={getAllParticipants()}
                                                    onToggleAssignment={itemizedExpense.toggleItemAssignment}
                                                    onRemoveItem={itemizedExpense.removeItem}
                                                    onOpenSelector={itemizedExpense.setEditingItemIndex}
                                                    getParticipantName={getParticipantName}
                                                    currentUserId={currentUserId}
                                                />

                                                <div className="mt-3 pt-3 border-t border-sw-line space-y-3">
                                                    {/* Tax Input */}
                                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                        <label className="text-sm text-sw-muted" htmlFor="expense-tax">Tax (split proportionally)</label>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-sw-dim">{currency}</span>
                                                            <input
                                                                id="expense-tax"
                                                                type="text"
                                                                inputMode="decimal"
                                                                placeholder="0.00"
                                                                step="0.01"
                                                                className={MONEY_INPUT_CLASS}
                                                                value={itemizedExpense.taxAmount}
                                                                onChange={(e) => itemizedExpense.setTaxAmount(e.target.value)}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Tip Input with percentage buttons */}
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                            <label className="text-sm text-sw-muted" htmlFor="expense-tip">Tip (split proportionally)</label>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-sw-dim">{currency}</span>
                                                                <input
                                                                    id="expense-tip"
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    placeholder="0.00"
                                                                    step="0.01"
                                                                    className={MONEY_INPUT_CLASS}
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
                                                                    className="px-3 py-1.5 text-xs rounded-full bg-sw-surface text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                                                >
                                                                    {percent}%
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex justify-between items-baseline pt-3 border-t border-sw-line">
                                                    <span className="text-[12.5px] text-sw-muted">Total</span>
                                                    <span className="sw-display text-base">
                                                        {currency} {calculateItemizedTotal(itemizedExpense.itemizedItems, itemizedExpense.taxAmount, itemizedExpense.tipAmount)}
                                                    </span>
                                                </div>
                                            </Card>
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

                                <div className="sticky bottom-0 bg-sw-surface border-t border-sw-line p-4 sm:p-5 flex justify-end gap-2">
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            setIsEditing(false);
                                            if (expense) populateFormFromExpense(expense);
                                        }}
                                        className="min-h-[44px]"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="primary"
                                        onClick={handleSave}
                                        disabled={isSubmitting}
                                        className="min-h-[44px]"
                                        icon={
                                            isSubmitting ? (
                                                <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sw-line border-t-sw-accent" />
                                            ) : undefined
                                        }
                                    >
                                        {isSubmitting ? 'Saving…' : 'Save'}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            /* View Mode */
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                                    <div className="mb-6">
                                        <div className="flex items-center gap-3 mb-1.5">
                                            {expense.icon && (
                                                <span className="text-3xl">{expense.icon}</span>
                                            )}
                                            <h3 className="sw-heading text-[22px]">{expense.description}</h3>
                                        </div>
                                        <Money
                                            amount={expense.amount}
                                            currency={expense.currency}
                                            className="sw-display text-[32px] block"
                                        />
                                    </div>

                                    <div className="space-y-3 mb-6">
                                        <div className="flex justify-between gap-3 text-[12.5px]">
                                            <span className="text-sw-muted">Date</span>
                                            <span className="text-sw-text">{formatDate(expense.date)}</span>
                                        </div>
                                        <div className="flex justify-between gap-3 text-[12.5px]">
                                            <span className="text-sw-muted">Paid by</span>
                                            <span className="text-sw-text">{getPayerName()}</span>
                                        </div>
                                        <div className="flex justify-between items-center gap-3 text-[12.5px]">
                                            <span className="text-sw-muted">Split type</span>
                                            <TagPill tone="neutral">{expense.split_type}</TagPill>
                                        </div>
                                        {groupDefaultCurrency && expense.currency !== groupDefaultCurrency && expense.exchange_rate && (
                                            <div className="flex justify-between gap-3 text-[12.5px]">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-sw-muted">Exchange rate</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowExchangeRateInfo(true)}
                                                        aria-label="About this exchange rate"
                                                        className="text-sw-dim hover:text-sw-text cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                                    >
                                                        <Info size={15} />
                                                    </button>
                                                </div>
                                                <span className="sw-num text-sw-text">1 {expense.currency} = {expense.exchange_rate} {expense.exchange_rate_target_currency || 'USD'}</span>
                                            </div>
                                        )}
                                    </div>

                                    {expense.notes && (
                                        <Card tone="sunk" className="mb-6 p-3">
                                            <h4 className="text-[11px] uppercase tracking-[0.09em] text-sw-dim mb-1">Notes</h4>
                                            <p className="text-sm text-sw-text whitespace-pre-wrap">{expense.notes}</p>
                                        </Card>
                                    )}

                                    {/* Itemized breakdown for ITEMIZED expenses */}
                                    {expense.split_type === 'ITEMIZED' && expense.items && expense.items.length > 0 && (
                                        <div className="border-t border-sw-line pt-4 mb-4">
                                            <h4 className={SECTION_CLASS}>Items</h4>
                                            <div className="space-y-2">
                                                {expense.items.filter(i => !i.is_tax_tip).map(item => (
                                                    <div key={item.id} className="flex justify-between items-start gap-3 text-sm">
                                                        <div>
                                                            <span className="text-sw-text">{item.description}</span>
                                                            <div className={`text-[11.5px] flex items-center gap-1 ${item.assignments.length === 0 ? 'text-sw-neg' : 'text-sw-dim'}`}>
                                                                {item.assignments.length === 0 ? (
                                                                    <>
                                                                        <Warning size={12} weight="fill" />
                                                                        Unclaimed
                                                                    </>
                                                                ) : (
                                                                    item.assignments.map(a => a.user_name).join(', ')
                                                                )}
                                                            </div>
                                                        </div>
                                                        <Money
                                                            amount={item.price}
                                                            currency={expense.currency}
                                                            tone="muted"
                                                            className="flex-none"
                                                        />
                                                    </div>
                                                ))}
                                                {expense.items.filter(i => i.is_tax_tip).map(item => (
                                                    <div key={item.id} className="flex justify-between gap-3 text-sm text-sw-dim">
                                                        <span>{item.description}</span>
                                                        <Money
                                                            amount={item.price}
                                                            currency={expense.currency}
                                                            tone="dim"
                                                            className="flex-none"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}


                                    {/*
                                      * A tab settles into one expense, and the
                                      * split breakdown below flattens it to a
                                      * figure per person. Who claimed which
                                      * item only exists on the tab, so it is
                                      * read in and shown here rather than
                                      * behind a link: sending someone to
                                      * another screen to find out why their
                                      * number is their number is the long way
                                      * round to the question this modal exists
                                      * to answer.
                                      *
                                      * Sent only to the tab's owner; nobody
                                      * else can load the tab at all.
                                      */}
                                    {expense.tab_id && (
                                        <div className="border-t border-sw-line pt-4 mb-4">
                                            <h4 className={SECTION_CLASS}>
                                                From a tab
                                            </h4>
                                            {tab ? (
                                                <>
                                                    <TabBreakdown
                                                        items={tab.items}
                                                        participants={tab.participants}
                                                        currency={tab.currency}
                                                        tax={tab.tax}
                                                        tip={tab.tip}
                                                        meId={
                                                            tab.participants.find(
                                                                (p) => p.user_id === currentUserId
                                                            )?.id ?? null
                                                        }
                                                        payerId={payerParticipantId(
                                                            tab.participants,
                                                            tab.payer_id
                                                        )}
                                                        className="mb-3"
                                                    />
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => {
                                                            handleClose();
                                                            navigate(`/tabs/${expense.tab_id}`);
                                                        }}
                                                        icon={<Receipt size={15} />}
                                                    >
                                                        Open the tab
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => {
                                                        handleClose();
                                                        navigate(`/tabs/${expense.tab_id}`);
                                                    }}
                                                    icon={<Receipt size={15} />}
                                                >
                                                    View tab
                                                </Button>
                                            )}
                                        </div>
                                    )}

                                    {/* Receipt Image */}
                                    {expense.receipt_image_path && (
                                        <div className="border-t border-sw-line pt-4 mb-4">
                                            <h4 className={SECTION_CLASS}>Receipt</h4>
                                            <ReceiptViewer
                                                path={expense.receipt_image_path}
                                            />
                                        </div>
                                    )}

                                    <div className="border-t border-sw-line pt-4">
                                        <h4 className={SECTION_CLASS}>Split breakdown</h4>
                                        <div className="space-y-4">
                                            {[...expense.splits].sort((a, b) => {
                                                const aName = a.user_id === currentUserId && !a.is_guest ? 'You' : a.user_name;
                                                const bName = b.user_id === currentUserId && !b.is_guest ? 'You' : b.user_name;
                                                if (aName === 'You') return -1;
                                                if (bName === 'You') return 1;
                                                return aName.localeCompare(bName);
                                            }).map(split => {
                                                const displayName = split.user_id === currentUserId && !split.is_guest ? 'You' : split.user_name;

                                                // For itemized expenses, calculate the breakdown
                                                if (expense.split_type === 'ITEMIZED' && expense.items && expense.items.length > 0) {
                                                    const breakdown = calculatePersonItemBreakdown(
                                                        { user_id: split.user_id, is_guest: split.is_guest },
                                                        expense.items
                                                    );

                                                    return (
                                                        <Card key={split.id} tone="sunk" className="p-3">
                                                            <div className="flex justify-between items-center gap-3 mb-2">
                                                                <span className="text-sm font-medium">
                                                                    {displayName}
                                                                </span>
                                                                <Money
                                                                    amount={split.amount_owed}
                                                                    currency={expense.currency}
                                                                    className="font-medium"
                                                                />
                                                            </div>
                                                            {breakdown.items.length > 0 && (
                                                                <div className="text-[11.5px] text-sw-dim space-y-1 pl-2 border-l-2 border-sw-line mb-2">
                                                                    {breakdown.items.map((item, idx) => (
                                                                        <div key={idx} className="flex justify-between gap-2">
                                                                            <span>
                                                                                {item.description}
                                                                                {item.isShared && (
                                                                                    <span className="ml-1">
                                                                                        ({formatItemPercent(item.percent)}%, with {item.sharedWith} {item.sharedWith === 1 ? 'other' : 'others'})
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                            <span className="sw-num flex-none">{formatMoney(item.shareAmount, expense.currency)}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <div className="text-[11.5px] text-sw-dim space-y-1 pl-2 border-l-2 border-sw-line">
                                                                <div className="flex justify-between gap-2">
                                                                    <span>Items subtotal</span>
                                                                    <span className="sw-num flex-none">{formatMoney(breakdown.subtotal, expense.currency)}</span>
                                                                </div>
                                                                {breakdown.tax > 0 && (
                                                                    <div className="flex justify-between gap-2">
                                                                        <span>+ Tax ({breakdown.sharePercent.toFixed(1)}% share)</span>
                                                                        <span className="sw-num flex-none">{formatMoney(breakdown.tax, expense.currency)}</span>
                                                                    </div>
                                                                )}
                                                                {breakdown.tip > 0 && (
                                                                    <div className="flex justify-between gap-2">
                                                                        <span>+ Tip ({breakdown.sharePercent.toFixed(1)}% share)</span>
                                                                        <span className="sw-num flex-none">{formatMoney(breakdown.tip, expense.currency)}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </Card>
                                                    );
                                                }

                                                // For non-itemized expenses, show simple display
                                                return (
                                                    <div key={split.id} className="flex justify-between items-center gap-3 text-sm">
                                                        <span className="text-sw-muted">
                                                            {displayName}
                                                        </span>
                                                        <Money
                                                            amount={split.amount_owed}
                                                            currency={expense.currency}
                                                            className="font-medium"
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Quick Settle Section - Only for non-group expenses with expense guests */}
                                    {expense.expense_guests && expense.expense_guests.length > 0 && (
                                        <div className="border-t border-sw-line pt-4 mt-4">
                                            <div className="flex justify-between items-center gap-2 mb-3">
                                                <h4 className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">Quick settle</h4>
                                                <TagPill
                                                    tone={
                                                        expense.expense_guests.filter(g => g.paid).length === expense.expense_guests.length
                                                            ? 'positive'
                                                            : 'neutral'
                                                    }
                                                >
                                                    {expense.expense_guests.filter(g => g.paid).length}/{expense.expense_guests.length} paid
                                                </TagPill>
                                            </div>
                                            <div className="space-y-2">
                                                {expense.expense_guests.map(guest => (
                                                    <div
                                                        key={guest.id}
                                                        className={`flex items-center justify-between gap-3 p-3 rounded-sw-row transition-colors ${
                                                            guest.paid
                                                                ? 'bg-sw-pos-soft'
                                                                : 'bg-sw-sunk shadow-[0_0_0_1px_var(--sw-line)]'
                                                        }`}
                                                    >
                                                        <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                                                            <input
                                                                type="checkbox"
                                                                checked={guest.paid}
                                                                disabled={settlingGuestId === guest.id || readOnly}
                                                                onChange={() => toggleExpenseGuestPaid(guest.id, !guest.paid)}
                                                                className="w-5 h-5 rounded accent-[var(--sw-pos)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                                            />
                                                            <span className={`text-sm font-medium truncate ${guest.paid ? 'text-sw-pos' : 'text-sw-text'}`}>
                                                                {guest.name}
                                                            </span>
                                                        </label>
                                                        <div className="flex items-center gap-2 flex-none">
                                                            <Money
                                                                amount={guest.amount_owed}
                                                                currency={expense.currency}
                                                                tone={guest.paid ? 'positive' : 'default'}
                                                                className="font-medium"
                                                            />
                                                            {guest.paid && (
                                                                <Check size={16} className="text-sw-pos" aria-hidden="true" />
                                                            )}
                                                            {settlingGuestId === guest.id && (
                                                                <span className="animate-spin rounded-full h-4 w-4 border-2 border-sw-line border-t-sw-accent" />
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="sticky bottom-0 bg-sw-surface border-t border-sw-line p-4 sm:p-5 flex justify-end">
                                    <Button variant="ghost" onClick={handleClose} className="min-h-[44px]">
                                        Close
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                ) : null}

                {/* Add Item Modal */}
                <AddItemModal
                    isOpen={itemizedExpense.showAddItemModal}
                    onClose={itemizedExpense.closeAddItemModal}
                    onAdd={itemizedExpense.addManualItem}
                />

                {/* Alert Dialog */}
                <AlertDialog
                    isOpen={alertDialog.isOpen}
                    onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
                    onConfirm={alertDialog.onConfirm}
                    title={alertDialog.title}
                    message={alertDialog.message}
                    type={alertDialog.type}
                />
            </div>

            {/*
             * Sibling of the panel rather than nested in the exchange-rate row
             * it explains. It is a fixed-position overlay covering the whole
             * viewport, so living inside a flex row several levels down was
             * only ever working by accident.
             */}
            {showExchangeRateInfo && (
                <div
                    className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center p-4"
                    onClick={() => setShowExchangeRateInfo(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Exchange rate"
                        className="bg-sw-surface text-sw-text rounded-sw-card-lg shadow-[0_0_0_1px_var(--sw-line)] max-w-sm w-full p-6"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-sw-accent-ghost text-sw-accent flex items-center justify-center flex-none">
                                <Info size={20} weight="fill" aria-hidden="true" />
                            </div>
                            <h3 className="sw-heading text-[17px]">Exchange rate</h3>
                        </div>
                        <p className="text-[12.5px] text-sw-muted leading-relaxed mb-6">
                            This exchange rate was captured at the time of the expense and is used to normalize amounts when calculating balances and simplifying debts between different currencies.
                        </p>
                        <Button
                            variant="primary"
                            block
                            onClick={() => setShowExchangeRateInfo(false)}
                            className="py-3"
                        >
                            Got it
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpenseDetailModal;
