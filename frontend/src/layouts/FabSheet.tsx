import React from 'react';
import {
    CurrencyDollarSimple,
    HandCoins,
    Scan,
    Handshake,
    CaretRight,
} from '@phosphor-icons/react';
import { Sheet, Row, IconTile } from '../components/ui';

export interface ResumeTarget {
    key: string;
    /** Group name, or the tab's venue. */
    label: string;
    /** "5 people", "open tab · 4 here". */
    caption: string;
    /** Emoji for a group; omitted for an open tab, which gets a live dot. */
    icon?: string;
    /** Renders the pulsing positive dot instead of an emoji. */
    live?: boolean;
    onSelect: () => void;
}

export interface FabSheetProps {
    open: boolean;
    onClose: () => void;
    onAddExpense: () => void;
    /** Opens the add-expense modal pre-toggled to "Money received". */
    onAddIncome: () => void;
    onSplitBill: () => void;
    onSettleUp: () => void;
    /**
     * Where the user was last — the group they most recently added to, plus any
     * open tab. Rendered as the "pick up where you left off" strip.
     */
    resumeTargets?: ResumeTarget[];
    /** Context line under "Add an expense", e.g. the last-used group. */
    addExpenseCaption?: string;
}

/**
 * The sheet behind the FAB, in three tiers: "Add an expense" carries the
 * accent because it is the everyday action and the one the + button literally
 * promises; "Split a bill" keeps a full card; "Settle up" and "Money
 * received" are slimmer rows that keep their teaching subtitles, which wrap
 * rather than truncate on narrow phones. The eye lands on the primary. A live tab
 * gets its prominence from the "pick up where you left off" strip instead,
 * which is the situational slot.
 */
const FabSheet: React.FC<FabSheetProps> = ({
    open,
    onClose,
    onAddExpense,
    onAddIncome,
    onSplitBill,
    onSettleUp,
    resumeTargets = [],
    addExpenseCaption = 'Split it with the group',
}) => {
    const run = (action: () => void) => () => {
        onClose();
        action();
    };

    return (
        <Sheet open={open} onClose={onClose} label="Add something">
            <Row
                variant="card"
                tone="accent"
                onClick={run(onAddExpense)}
                leading={
                    <IconTile tone="accent-solid">
                        <CurrencyDollarSimple size={21} weight="fill" />
                    </IconTile>
                }
                title={<span className="text-[15px]">Add an expense</span>}
                subtitle={<span className="text-sw-accent">{addExpenseCaption}</span>}
                trailing={<CaretRight size={17} className="text-sw-accent" />}
            />

            <Row
                variant="card"
                onClick={run(onSplitBill)}
                leading={
                    <IconTile tone="neutral">
                        <Scan size={21} />
                    </IconTile>
                }
                title={<span className="text-[15px]">Split a bill at the table</span>}
                subtitle="Scan it, everyone claims their own"
                trailing={<CaretRight size={17} className="text-sw-dim" />}
            />

            {/* The quiet tier: full width so the teaching subtitles fit and
                wrap rather than truncate, but visibly smaller than the cards
                above — small dim icon, tighter padding, no caret. */}
            <button
                type="button"
                onClick={run(onSettleUp)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
            >
                <Handshake size={18} className="text-sw-dim flex-none" aria-hidden="true" />
                <span className="min-w-0">
                    <span className="block text-[13px] font-medium">Settle up</span>
                    <span className="block text-[11px] text-sw-dim leading-snug">
                        Clear what you owe, or get paid back
                    </span>
                </span>
            </button>
            <button
                type="button"
                onClick={run(onAddIncome)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
            >
                <HandCoins size={18} className="text-sw-dim flex-none" aria-hidden="true" />
                <span className="min-w-0">
                    <span className="block text-[13px] font-medium">Money received</span>
                    <span className="block text-[11px] text-sw-dim leading-snug">
                        A refund or deposit someone&apos;s holding for the group
                    </span>
                </span>
            </button>

            {resumeTargets.length > 0 && (
                <>
                    <div className="h-px bg-sw-line my-[5px]" aria-hidden="true" />
                    <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim px-0.5 pb-0.5">
                        Pick up where you left off
                    </div>
                    <div className="flex gap-2">
                        {resumeTargets.map((target) => (
                            <button
                                key={target.key}
                                type="button"
                                onClick={run(target.onSelect)}
                                className="flex-1 min-w-0 flex items-center gap-2 px-[11px] py-2.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                {target.live ? (
                                    <span
                                        className="w-[7px] h-[7px] rounded-full bg-sw-pos flex-none"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <span className="text-[15px] flex-none" aria-hidden="true">
                                        {target.icon}
                                    </span>
                                )}
                                <span className="min-w-0">
                                    <span className="block text-[12.5px] font-medium truncate">
                                        {target.label}
                                    </span>
                                    <span className="block text-[11px] text-sw-dim truncate">
                                        {target.caption}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </Sheet>
    );
};

export default FabSheet;
