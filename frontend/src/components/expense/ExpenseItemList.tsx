import React from 'react';
import { CaretRight, X } from '@phosphor-icons/react';
import type { ExpenseItem, Participant } from '../../types/expense';
import { shouldUseCompactMode, getAssignmentDisplayText, sortParticipants } from '../../utils/participantHelpers';
import {
    assignmentIsParticipant,
    itemDetailKeyForParticipant,
} from '../../utils/expenseTransformations';
import { SegmentedControl } from '../ui';

/** The per-item split methods. Narrower than the expense-level `SplitType` —
 *  an item cannot itself be itemized. */
type ItemSplitType = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';

const SPLIT_OPTIONS: { value: ItemSplitType; label: string }[] = [
    { value: 'EQUAL', label: 'Equal' },
    { value: 'EXACT', label: 'Exact' },
    { value: 'PERCENT', label: '%' },
    { value: 'SHARES', label: 'Shares' },
];

/** The small number inputs beside a person's name in a non-equal split. */
const SPLIT_INPUT_CLASS =
    'px-2 py-1 text-sm sw-num rounded-md bg-sw-sunk text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2';

interface ExpenseItemListProps {
    items: ExpenseItem[];
    participants: Participant[];
    onToggleAssignment: (itemIdx: number, participant: Participant) => void;
    onRemoveItem: (idx: number) => void;
    onOpenSelector: (idx: number) => void;
    // Required on purpose: these were once optional and invoked with ?., and
    // the edit-mode mount silently omitted them — the pills rendered but did
    // nothing. Requiring them makes that regression a compile error.
    onChangeSplitType: (itemIdx: number, splitType: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES') => void;
    onUpdateSplitDetail: (itemIdx: number, participantKey: string, details: { amount?: number; percentage?: number; shares?: number }) => void;
    currency?: string; // Make it optional since it's not used
    getParticipantName: (p: Participant) => string;
    currentUserId?: number;
}

const ExpenseItemList: React.FC<ExpenseItemListProps> = ({
    items,
    participants,
    onToggleAssignment,
    onRemoveItem,
    onOpenSelector,
    onChangeSplitType,
    onUpdateSplitDetail,
    getParticipantName,
    currentUserId
}) => {
    const useCompactMode = shouldUseCompactMode(participants);

    if (items.length === 0) {
        return (
            <p className="text-[12.5px] text-sw-dim text-center py-4">
                No items yet. Scan a receipt or add items manually.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((item, idx) => (
                <div
                    key={idx}
                    className={`bg-sw-surface p-3 rounded-sw-card ${item.assignments.length === 0
                        ? 'border border-dashed border-sw-line'
                        : 'shadow-[0_0_0_1px_var(--sw-line)]'
                        }`}
                >
                    <div className="flex justify-between items-center mb-3">
                        <span className="font-medium text-sm flex-1 pr-2 text-sw-text">
                            {item.description}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-sm sw-num text-sw-muted font-medium whitespace-nowrap">
                                ${(item.price / 100).toFixed(2)}
                            </span>
                            <button
                                type="button"
                                onClick={() => onRemoveItem(idx)}
                                aria-label="Remove item"
                                className="text-sw-dim hover:text-sw-neg min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Participant Selection - Adaptive UI */}
                    {useCompactMode ? (
                        /* Compact mode for large groups */
                        <div>
                            <button
                                type="button"
                                onClick={() => onOpenSelector(idx)}
                                className={`w-full px-3 py-2.5 rounded-sw-row text-left flex items-center justify-between gap-2 min-h-[44px] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${item.assignments.length === 0
                                    ? 'border border-dashed border-sw-accent bg-sw-accent-ghost text-sw-accent font-medium'
                                    : 'bg-sw-sunk text-sw-text shadow-[0_0_0_1px_var(--sw-line)] hover:bg-sw-raise'
                                    }`}
                            >
                                <span className="text-sm">
                                    {getAssignmentDisplayText(item.assignments, participants, currentUserId)}
                                </span>
                                <CaretRight size={16} className="text-sw-dim flex-none" />
                            </button>
                        </div>
                    ) : (
                        /* Inline buttons for small groups */
                        <div className="flex flex-wrap gap-2">
                            {participants.map(p => {
                                // Check if participant is assigned to this item
                                const isAssigned = item.assignments.some(a =>
                                    assignmentIsParticipant(a, p)
                                );

                                return (
                                    <button
                                        key={p.isExpenseGuest ? `expenseguest_${p.id}` : (p.isGuest ? `guest_${p.id}` : `user_${p.id}`)}
                                        type="button"
                                        onClick={() => onToggleAssignment(idx, p)}
                                        aria-pressed={isAssigned}
                                        className={`px-3 py-2 text-sm rounded-full min-h-[44px] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${isAssigned
                                            ? 'bg-sw-accent-ghost text-sw-accent shadow-[0_0_0_1px_var(--sw-accent)]'
                                            : 'bg-sw-sunk text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text'
                                            }`}
                                    >
                                        {getParticipantName(p)}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Split type selector and inputs when multiple people are assigned */}
                    {item.assignments.length > 1 && (
                        <div className="mt-3 pt-3 border-t border-sw-line">
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-[11.5px] text-sw-muted">
                                    Split method
                                </span>
                                <SegmentedControl
                                    label="Split method"
                                    size="sm"
                                    options={SPLIT_OPTIONS}
                                    value={(item.split_type || 'EQUAL') as ItemSplitType}
                                    onChange={(splitType) => onChangeSplitType(idx, splitType)}
                                />
                            </div>

                            {/* Show input fields based on split type */}
                            {(item.split_type || 'EQUAL') !== 'EQUAL' && (
                                <div className="space-y-2 mt-3">
                                    {(() => {
                                        // Get participants from assignments and sort them
                                        const assignedParticipants = item.assignments
                                            .map(assignment => participants.find(
                                                p => assignmentIsParticipant(assignment, p)
                                            ))
                                            .filter((p): p is Participant => p !== undefined);

                                        const sortedParticipants = sortParticipants(assignedParticipants, currentUserId);

                                        return sortedParticipants.map(participant => {
                                            const participantKey = itemDetailKeyForParticipant(participant);
                                            const splitDetail = item.split_details?.[participantKey];

                                            return (
                                                <div key={participantKey} className="flex items-center gap-2">
                                                    <span className="text-sm text-sw-muted flex-1">
                                                        {getParticipantName(participant)}
                                                    </span>
                                                {item.split_type === 'EXACT' && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-sm text-sw-dim">$</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            aria-label={`Amount for ${getParticipantName(participant)}`}
                                                            value={(splitDetail?.amount || 0) / 100}
                                                            onChange={(e) => {
                                                                const amount = Math.round(parseFloat(e.target.value || '0') * 100);
                                                                onUpdateSplitDetail(idx, participantKey, { amount });
                                                            }}
                                                            className={`${SPLIT_INPUT_CLASS} w-20`}
                                                        />
                                                    </div>
                                                )}
                                                {item.split_type === 'PERCENT' && (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="0"
                                                            max="100"
                                                            aria-label={`Percentage for ${getParticipantName(participant)}`}
                                                            value={splitDetail?.percentage || 0}
                                                            onChange={(e) => {
                                                                const percentage = parseFloat(e.target.value || '0');
                                                                onUpdateSplitDetail(idx, participantKey, { percentage });
                                                            }}
                                                            className={`${SPLIT_INPUT_CLASS} w-16`}
                                                        />
                                                        <span className="text-sm text-sw-dim">%</span>
                                                    </div>
                                                )}
                                                {item.split_type === 'SHARES' && (
                                                    <input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        aria-label={`Shares for ${getParticipantName(participant)}`}
                                                        value={splitDetail?.shares || 1}
                                                        onChange={(e) => {
                                                            const shares = parseInt(e.target.value || '1');
                                                            onUpdateSplitDetail(idx, participantKey, { shares: Math.max(1, shares) });
                                                        }}
                                                        className={`${SPLIT_INPUT_CLASS} w-16`}
                                                    />
                                                )}
                                            </div>
                                        );
                                        });
                                    })()}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default ExpenseItemList;
