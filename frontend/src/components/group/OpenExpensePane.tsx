import React from 'react';
import { PencilSimple, Trash } from '@phosphor-icons/react';
import { Avatar, Button, IconTile, Money, TagPill } from '../ui';
import ReceiptViewer from '../ReceiptViewer';
import { formatDate } from '../../utils/formatters';
import type { GroupExpense } from '../../hooks/useGroupData';

export interface OpenExpensePaneProps {
    expense: GroupExpense;
    currentUserId?: number;
    payerName: (expense: GroupExpense) => string;
    onEdit: () => void;
    onDelete: () => void;
    /** Hides Edit/Delete for read-only viewers. */
    readOnly?: boolean;
}

const SPLIT_LABEL: Record<string, string> = {
    EQUAL: 'Split equally',
    EXACT: 'Split by exact amounts',
    PERCENTAGE: 'Split by percentage',
    SHARES: 'Split by shares',
    ITEMIZED: 'Split by items',
};

/**
 * The selected expense, shown beside the list rather than over it — the
 * redesign's central claim for desktop is that nothing hides behind a modal.
 *
 * This is a read-only summary; editing still opens the full expense editor,
 * which owns the split-type machinery.
 */
const OpenExpensePane: React.FC<OpenExpensePaneProps> = ({
    expense,
    currentUserId,
    payerName,
    onEdit,
    onDelete,
    readOnly = false,
}) => (
    <div className="p-[18px] border-b border-sw-line">
        <div className="flex items-center gap-2 mb-3">
            <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                Open expense
            </div>
            {!readOnly && (
                <div className="ml-auto flex gap-1.5">
                    <Button
                        variant="ghost"
                        onClick={onEdit}
                        icon={<PencilSimple size={14} />}
                        className="text-[12.5px]"
                    >
                        Edit
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={onDelete}
                        icon={<Trash size={14} />}
                        className="text-[12.5px] text-sw-neg hover:bg-[color-mix(in_srgb,var(--sw-neg)_12%,transparent)]"
                    >
                        Delete
                    </Button>
                </div>
            )}
        </div>

        <div className="flex items-center gap-3 mb-3.5">
            <IconTile tone="neutral" size={44}>
                {expense.icon || (expense.is_settlement ? '🏦' : '🧾')}
            </IconTile>
            <div className="min-w-0">
                <div className="text-[17px] font-medium truncate">
                    {expense.description}
                </div>
                <div className="text-xs text-sw-dim truncate">
                    {payerName(expense)} · {formatDate(expense.date, {
                        month: 'short',
                        day: 'numeric',
                    })}
                </div>
            </div>
            <Money
                amount={expense.amount}
                currency={expense.currency}
                className="ml-auto text-2xl font-medium flex-none"
            />
        </div>

        {expense.notes && (
            <p className="text-[12.5px] text-sw-muted mb-3">{expense.notes}</p>
        )}

        {/*
          * Nothing hides behind a modal here, and that has to include the
          * receipt — on desktop this pane is the whole of an expense, so a
          * photograph reachable only from the editor is a photograph lost.
          */}
        {expense.receipt_image_path && (
            <div className="mb-3.5">
                <ReceiptViewer path={expense.receipt_image_path} />
            </div>
        )}

        {expense.splits?.length > 0 && (
            <div className="bg-sw-surface rounded-sw-row px-3.5 py-3 shadow-[0_0_0_1px_var(--sw-line)]">
                <div className="text-xs text-sw-muted mb-2.5">
                    {SPLIT_LABEL[expense.split_type ?? 'EQUAL'] ?? 'Split'} between{' '}
                    {expense.splits.length}
                </div>
                <div className="flex flex-col gap-[7px]">
                    {expense.splits.map((split) => {
                        const isMe = !split.is_guest && split.user_id === currentUserId;
                        return (
                            <div
                                key={`${split.user_id}-${split.is_guest}-${split.id}`}
                                className="flex items-center gap-[9px] text-[12.5px]"
                            >
                                <Avatar
                                    name={split.user_name}
                                    size={22}
                                    variant={isMe ? 'accent' : 'neutral'}
                                />
                                <span className="truncate">
                                    {isMe ? 'You' : split.user_name}
                                </span>
                                {split.is_guest && (
                                    <TagPill tone="neutral" className="flex-none">
                                        guest
                                    </TagPill>
                                )}
                                <Money
                                    amount={split.amount_owed}
                                    currency={expense.currency}
                                    tone="muted"
                                    className="ml-auto flex-none"
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        )}
    </div>
);

export default OpenExpensePane;
