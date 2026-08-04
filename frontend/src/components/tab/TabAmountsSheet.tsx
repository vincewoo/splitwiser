import React, { useState } from 'react';
import { Button, Money, Sheet } from '../ui';
import TipPercentages from './TipPercentages';
import { sanitizeAmountInput } from '../../utils/amountInput';

export interface TabAmountsSheetProps {
    /** Sum of the tab's lines, in cents — what the percentages are taken on. */
    subtotal: number;
    tax: number;
    tip: number;
    currency: string;
    onClose: () => void;
    onSave: (amounts: { tax: number; tip: number }) => void;
    busy?: boolean;
    error?: string | null;
}

const centsToInput = (cents: number): string =>
    cents > 0 ? (cents / 100).toFixed(2) : '';

const inputToCents = (value: string): number => {
    const parsed = Math.round(parseFloat(value || '0') * 100);
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Correcting the tax and the tip on a tab that is already open.
 *
 * The scan reads a receipt well but it is not the authority on it: a tip is
 * written on after it prints, a "Service Fee" line is a tip in all but name,
 * and a tax line can be missed outright. Whoever is holding the bill can see
 * what it actually says, so they can put it right for as long as the tab is
 * open — everyone claiming from the link sees the new figures on their next
 * poll, and closing uses them.
 *
 * Mount this only while it is open: the fields are seeded from the tab at
 * mount, so a fresh open always starts from what the tab currently holds.
 */
const TabAmountsSheet: React.FC<TabAmountsSheetProps> = ({
    subtotal,
    tax,
    tip,
    currency,
    onClose,
    onSave,
    busy = false,
    error = null,
}) => {
    const [taxInput, setTaxInput] = useState(() => centsToInput(tax));
    const [tipInput, setTipInput] = useState(() => centsToInput(tip));

    const taxCents = inputToCents(taxInput);
    const tipCents = inputToCents(tipInput);
    const total = subtotal + taxCents + tipCents;

    const field = (
        id: string,
        label: string,
        value: string,
        onChange: (next: string) => void
    ) => (
        <div className="flex items-center justify-between gap-3">
            <label className="text-[12.5px] text-sw-muted" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={value}
                onChange={(event) => onChange(sanitizeAmountInput(event.target.value))}
                className="sw-num w-28 px-3 py-2 text-right rounded-sw-card bg-sw-sunk text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
            />
        </div>
    );

    return (
        <Sheet open onClose={onClose} label="Tax and tip" title="Tax and tip">
            <div className="rounded-sw-card bg-sw-surface border border-sw-line px-3 py-3 flex flex-col gap-2.5">
                {field('tab-tax', 'Tax', taxInput, setTaxInput)}
                {field('tab-tip-edit', 'Tip', tipInput, setTipInput)}

                <TipPercentages
                    subtotal={subtotal}
                    tip={tipCents}
                    onPick={(cents) => setTipInput(centsToInput(cents))}
                />

                <p className="text-[11.5px] text-sw-dim">
                    Both are split across the table in proportion to what each
                    person ordered — nobody claims them.
                </p>

                <div className="flex items-baseline justify-between pt-2 border-t border-sw-line">
                    <span className="text-[12.5px] text-sw-muted">Total</span>
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
                disabled={busy}
                onClick={() => onSave({ tax: taxCents, tip: tipCents })}
                className="min-h-[46px]"
            >
                {busy ? 'Saving…' : 'Save'}
            </Button>
        </Sheet>
    );
};

export default TabAmountsSheet;
