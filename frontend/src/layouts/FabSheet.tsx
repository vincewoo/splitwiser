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
    settleUpCaption?: string;
}

/**
 * The sheet behind the FAB. Peer actions — "Split a bill at the table" and
 * "Money received" sit alongside "Add an expense" rather than buried inside
 * it — plus a strip for resuming whatever was already in progress.
 */
const FabSheet: React.FC<FabSheetProps> = ({
    open,
    onClose,
    onAddExpense,
    onAddIncome,
    onSplitBill,
    onSettleUp,
    resumeTargets = [],
    addExpenseCaption = 'Split it with a group or a person',
    settleUpCaption = 'Clear what you owe, or get paid back',
}) => {
    const run = (action: () => void) => () => {
        onClose();
        action();
    };

    return (
        <Sheet open={open} onClose={onClose} label="Add something">
            <Row
                variant="card"
                onClick={run(onAddExpense)}
                leading={
                    <IconTile tone="accent">
                        <CurrencyDollarSimple size={21} />
                    </IconTile>
                }
                title={<span className="text-[15px]">Add an expense</span>}
                subtitle={addExpenseCaption}
                trailing={<CaretRight size={17} className="text-sw-dim" />}
            />

            <Row
                variant="card"
                tone="accent"
                onClick={run(onSplitBill)}
                leading={
                    <IconTile tone="accent-solid">
                        <Scan size={21} weight="fill" />
                    </IconTile>
                }
                title={<span className="text-[15px]">Split a bill at the table</span>}
                subtitle={
                    <span className="text-sw-accent">
                        Scan it, everyone claims their own
                    </span>
                }
                trailing={<CaretRight size={17} className="text-sw-accent" />}
            />

            <Row
                variant="card"
                onClick={run(onAddIncome)}
                leading={
                    <IconTile tone="neutral">
                        <HandCoins size={21} />
                    </IconTile>
                }
                title={<span className="text-[15px]">Money received</span>}
                subtitle="A refund or deposit someone's holding for the group"
                trailing={<CaretRight size={17} className="text-sw-dim" />}
            />

            <Row
                variant="card"
                onClick={run(onSettleUp)}
                leading={
                    <IconTile tone="neutral">
                        <Handshake size={21} />
                    </IconTile>
                }
                title={<span className="text-[15px]">Settle up</span>}
                subtitle={settleUpCaption}
                trailing={<CaretRight size={17} className="text-sw-dim" />}
            />

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
