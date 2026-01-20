import React from 'react';
import type { ExpenseItem, Participant } from '../../types/expense';
import { shouldUseCompactMode, getAssignmentDisplayText } from '../../utils/participantHelpers';

interface ExpenseItemListProps {
    items: ExpenseItem[];
    participants: Participant[];
    onToggleAssignment: (itemIdx: number, participant: Participant) => void;
    onRemoveItem: (idx: number) => void;
    onOpenSelector: (idx: number) => void;
    onChangeSplitType?: (itemIdx: number, splitType: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES') => void;
    onUpdateSplitDetail?: (itemIdx: number, participantKey: string, details: { amount?: number; percentage?: number; shares?: number }) => void;
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
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                No items yet. Scan a receipt or add items manually.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((item, idx) => (
                <div
                    key={idx}
                    className={`bg-white dark:bg-gray-800 p-3 rounded border ${item.assignments.length === 0
                        ? 'border-red-300 dark:border-red-900'
                        : 'border-gray-200 dark:border-gray-600'
                        }`}
                >
                    <div className="flex justify-between items-center mb-3">
                        <span className="font-medium text-sm flex-1 pr-2 dark:text-gray-100">
                            {item.description}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 dark:text-gray-400 font-semibold whitespace-nowrap">
                                ${(item.price / 100).toFixed(2)}
                            </span>
                            <button
                                type="button"
                                onClick={() => onRemoveItem(idx)}
                                aria-label="Remove item"
                                className="text-red-400 hover:text-red-600 text-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
                            >
                                ×
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
                                className={`w-full px-4 py-3 rounded-lg border text-left flex items-center justify-between min-h-[44px] ${item.assignments.length === 0
                                    ? 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                                    : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                                    }`}
                            >
                                <span className="text-sm">
                                    {getAssignmentDisplayText(item.assignments, participants, currentUserId)}
                                </span>
                                <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                                    <path d="M9 5l7 7-7 7"></path>
                                </svg>
                            </button>
                        </div>
                    ) : (
                        /* Inline buttons for small groups */
                        <div className="flex flex-wrap gap-2">
                            {participants.map(p => {
                                const isAssigned = item.assignments.some(
                                    a => a.user_id === p.id && a.is_guest === p.isGuest
                                );
                                const isUnassigned = p.name === 'Unassigned' && p.isGuest;

                                return (
                                    <button
                                        key={p.isGuest ? `guest_${p.id}` : `user_${p.id}`}
                                        type="button"
                                        onClick={() => onToggleAssignment(idx, p)}
                                        className={`px-3 py-2 text-sm rounded-full border min-h-[44px] ${isAssigned
                                            ? isUnassigned
                                                ? 'bg-yellow-200 dark:bg-yellow-700/50 border-yellow-500 dark:border-yellow-500 text-yellow-900 dark:text-yellow-100 font-medium'
                                                : 'bg-teal-100 dark:bg-teal-900/30 border-teal-500 dark:border-teal-600 text-teal-700 dark:text-teal-300'
                                            : 'bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                                            }`}
                                    >
                                        {isUnassigned ? '? Unassigned' : getParticipantName(p)}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Split type selector and inputs when multiple people are assigned */}
                    {item.assignments.length > 1 && (
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                    Split Method:
                                </span>
                                <div className="flex gap-1">
                                    {(['EQUAL', 'EXACT', 'PERCENT', 'SHARES'] as const).map(splitType => (
                                        <button
                                            key={splitType}
                                            type="button"
                                            onClick={() => onChangeSplitType?.(idx, splitType)}
                                            className={`px-2 py-1 text-xs rounded ${(item.split_type || 'EQUAL') === splitType
                                                ? 'bg-teal-500 text-white'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                                }`}
                                        >
                                            {splitType === 'EQUAL' ? 'Equal' :
                                                splitType === 'EXACT' ? 'Exact' :
                                                    splitType === 'PERCENT' ? '%' : 'Shares'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Show input fields based on split type */}
                            {(item.split_type || 'EQUAL') !== 'EQUAL' && (
                                <div className="space-y-2 mt-3">
                                    {item.assignments.map(assignment => {
                                        const participant = participants.find(
                                            p => p.id === assignment.user_id && p.isGuest === assignment.is_guest
                                        );
                                        if (!participant) return null;

                                        const participantKey = participant.isGuest ? `guest_${participant.id}` : `user_${participant.id}`;
                                        const splitDetail = item.split_details?.[participantKey];

                                        return (
                                            <div key={participantKey} className="flex items-center gap-2">
                                                <span className="text-sm text-gray-600 dark:text-gray-400 flex-1">
                                                    {getParticipantName(participant)}:
                                                </span>
                                                {item.split_type === 'EXACT' && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-sm text-gray-500">$</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={(splitDetail?.amount || 0) / 100}
                                                            onChange={(e) => {
                                                                const amount = Math.round(parseFloat(e.target.value || '0') * 100);
                                                                onUpdateSplitDetail?.(idx, participantKey, { amount });
                                                            }}
                                                            className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
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
                                                            value={splitDetail?.percentage || 0}
                                                            onChange={(e) => {
                                                                const percentage = parseFloat(e.target.value || '0');
                                                                onUpdateSplitDetail?.(idx, participantKey, { percentage });
                                                            }}
                                                            className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                                                        />
                                                        <span className="text-sm text-gray-500">%</span>
                                                    </div>
                                                )}
                                                {item.split_type === 'SHARES' && (
                                                    <input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        value={splitDetail?.shares || 1}
                                                        onChange={(e) => {
                                                            const shares = parseInt(e.target.value || '1');
                                                            onUpdateSplitDetail?.(idx, participantKey, { shares: Math.max(1, shares) });
                                                        }}
                                                        className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
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
