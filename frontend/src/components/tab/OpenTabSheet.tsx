import React, { useState } from 'react';
import { Button, Money, Sheet } from '../ui';
import { sanitizeAmountInput } from '../../utils/amountInput';
import { formatMoney } from '../../utils/formatters';
import {
    RECONCILE_TOLERANCE_CENTS,
    reconcileReceipt,
} from '../../utils/receiptReconciliation';

/** A scanned bill waiting to become a tab. */
export interface PendingTab {
    items: { description: string; price: number }[];
    tax: number | null;
    tip: number | null;
    /** The total printed on the receipt, when the scan found one. */
    total: number | null;
    receiptPath?: string;
}

export interface OpenTabDetails {
    name: string;
    tip: number;
    total: number | null;
}

export interface OpenTabSheetProps {
    /**
     * The scanned bill. Mount this only while one is waiting to be opened —
     * the name and the tip are the mounted component's state, so a new scan
     * starts from the new receipt rather than the last one's leavings.
     */
    pending: PendingTab;
    onClose: () => void;
    onOpen: (details: OpenTabDetails) => void;
    busy?: boolean;
    error?: string | null;
    /** Matches what the tab will be opened in; tabs are USD unless told otherwise. */
    currency?: string;
}

/** The percentages worth one tap. Anything else is typed. */
const TIP_PERCENTAGES = [15, 18, 20];

const centsToInput = (cents: number): string =>
    cents > 0 ? (cents / 100).toFixed(2) : '';

const inputToCents = (value: string): number => {
    const parsed = Math.round(parseFloat(value || '0') * 100);
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Name the place and settle the tip, then open the tab.
 *
 * The tip belongs here rather than at close: a receipt is printed before the
 * tip is written on it, so the scan almost never finds one, and everyone
 * claiming from the link is shown what they owe *including* their part of it.
 * A tip added later would mean every figure people had already seen was short.
 */
const OpenTabSheet: React.FC<OpenTabSheetProps> = ({
    pending,
    onClose,
    onOpen,
    busy = false,
    error = null,
    currency = 'USD',
}) => {
    const scannedTip = pending.tip ?? 0;

    const [name, setName] = useState('');
    // Whatever the scan did find is the starting point, not a floor.
    const [tip, setTip] = useState(() => centsToInput(scannedTip));

    const items = pending.items;
    const subtotal = items.reduce((sum, item) => sum + item.price, 0);
    const tax = pending.tax ?? 0;
    const tipCents = inputToCents(tip);
    const total = subtotal + tax + tipCents;

    /*
     * What the scan could not account for, measured against the tip the scan
     * itself found — not against the live one. A tip written in by hand is
     * *meant* to exceed the printed total, so reconciling against the current
     * field would start crying "over the receipt" the moment anyone tips.
     */
    const scanned = reconcileReceipt(items, tax, scannedTip, pending.total);
    const gap = scanned.status === 'under' ? (scanned.delta ?? 0) : 0;
    /*
     * A service charge is the usual explanation for a shortfall: the parser is
     * told to leave tips and fees off the item list, and a "Service Fee" line
     * is a tip in all but name. It cannot tell those apart reliably, so the
     * host says which it is — and putting it in the tip is right either way,
     * since a fee nobody ordered should ride along in proportion rather than
     * land on whoever taps it.
     */
    const unaccounted = gap - (tipCents - scannedTip);

    const submit = () => {
        if (!name.trim() || busy) return;
        onOpen({
            name: name.trim(),
            tip: tipCents,
            /*
             * The printed total stands as the scan read it while the tip is
             * untouched — a scan that missed a line should keep showing the
             * discrepancy. Once the host writes a tip in, what will be charged
             * is the bill in front of them, so the receipt says that instead.
             */
            total: tipCents === scannedTip ? pending.total : total,
        });
    };

    return (
        <Sheet
            open
            onClose={onClose}
            label="Open a tab"
            title="Where are you?"
        >
            <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                }}
                placeholder="Bar Sol"
                aria-label="Venue name"
                className="px-3 py-3 rounded-sw-card bg-sw-surface text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
            />
            <p className="text-[12.5px] text-sw-muted">
                {items.length} {items.length === 1 ? 'line' : 'lines'} from the
                receipt. Everyone claims their own from a link — no group, nobody
                to invite.
            </p>

            <div className="rounded-sw-card bg-sw-surface border border-sw-line px-3 py-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                    <label className="text-[12.5px] text-sw-muted" htmlFor="tab-tip">
                        Tip
                    </label>
                    <input
                        id="tab-tip"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.00"
                        value={tip}
                        onChange={(event) =>
                            setTip(sanitizeAmountInput(event.target.value))
                        }
                        className="sw-num w-28 px-3 py-2 text-right rounded-sw-card bg-sw-sunk text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                    />
                </div>

                <div className="flex gap-2">
                    {TIP_PERCENTAGES.map((percent) => {
                        // Tipped on the items, as the rest of the app does —
                        // not on the tax.
                        const cents = Math.round((subtotal * percent) / 100);
                        const active = tipCents > 0 && cents === tipCents;
                        return (
                            <button
                                key={percent}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setTip(centsToInput(cents))}
                                className={`flex-1 py-2 rounded-sw-card text-[12.5px] border min-h-[38px] ${
                                    active
                                        ? 'bg-sw-accent-ghost border-sw-accent text-sw-accent'
                                        : 'bg-sw-sunk border-sw-line text-sw-muted'
                                }`}
                            >
                                {percent}%
                            </button>
                        );
                    })}
                </div>

                <p className="text-[11.5px] text-sw-dim">
                    Split across the table in proportion to what each person
                    ordered.
                </p>

                {unaccounted > RECONCILE_TOLERANCE_CENTS && (
                    <div className="rounded-sw-card bg-sw-sunk border border-sw-line px-3 py-2.5 flex flex-col gap-2">
                        <p className="text-[12.5px] text-sw-muted">
                            The receipt says{' '}
                            <Money amount={pending.total ?? 0} currency={currency} />
                            , which is{' '}
                            <Money amount={unaccounted} currency={currency} /> more
                            than these lines. If that is a service charge, put it in
                            the tip so it rides along with the rest.
                        </p>
                        <Button
                            variant="secondary"
                            onClick={() => setTip(centsToInput(tipCents + unaccounted))}
                            className="min-h-[38px] text-[12.5px]"
                        >
                            Add {formatMoney(unaccounted, currency)} to the tip
                        </Button>
                    </div>
                )}

                {scanned.status === 'over' && (
                    <p className="text-[11.5px] text-sw-neg">
                        These lines come to{' '}
                        {formatMoney(subtotal + tax + scannedTip, currency)}, more
                        than the {formatMoney(pending.total ?? 0, currency)} the
                        receipt printed — something was probably read twice.
                    </p>
                )}

                <div className="flex items-baseline justify-between pt-2 border-t border-sw-line">
                    <span className="text-[12.5px] text-sw-muted">
                        Total with tip
                    </span>
                    <Money
                        amount={total}
                        currency={currency}
                        className="sw-display text-[15px]"
                    />
                </div>
            </div>

            {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}
            <Button
                variant="primary"
                block
                disabled={busy || !name.trim()}
                onClick={submit}
                className="min-h-[46px]"
            >
                {busy ? 'Opening…' : 'Open the tab'}
            </Button>
        </Sheet>
    );
};

export default OpenTabSheet;
