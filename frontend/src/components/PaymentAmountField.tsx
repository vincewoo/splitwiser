import React, { useId } from 'react';
import { CONTROL_CLASS_UNSIZED } from './ui/controlClass';
import { sanitizeAmountInput } from '../utils/amountInput';

export interface PaymentAmountFieldProps {
    /** The raw entry string, e.g. "54.35". */
    value: string;
    onChange: (value: string) => void;
    /** Shown as a fixed label: a settlement is always in the debt's currency. */
    currency: string;
    /** Select the whole figure on focus — for a field seeded with a number
     *  the usual edit replaces it outright. */
    selectOnFocus?: boolean;
    autoFocus?: boolean;
}

/**
 * The amount on a settle-up sheet: a labelled decimal field with the currency
 * pinned beside it. Shared by the sheet that edits a suggested payment and the
 * one that records a payment the plan never suggested, so the two cannot
 * drift apart in how a figure is typed.
 */
const PaymentAmountField: React.FC<PaymentAmountFieldProps> = ({
    value,
    onChange,
    currency,
    selectOnFocus = false,
    autoFocus = false,
}) => {
    // Both sheets render this, and the page behind a sheet stays reachable by
    // keyboard, so the id must not collide.
    const id = useId();
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-[12.5px] text-sw-muted">
                Amount paid
            </label>
            <div className="flex items-center gap-2">
                <input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    autoFocus={autoFocus}
                    placeholder="0.00"
                    value={value}
                    onChange={(event) => onChange(sanitizeAmountInput(event.target.value))}
                    onFocus={selectOnFocus ? (event) => event.target.select() : undefined}
                    className={`sw-num flex-1 min-w-0 text-lg ${CONTROL_CLASS_UNSIZED}`}
                />
                <div className="px-[11px] py-1 rounded-full bg-sw-surface text-xs text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] flex-none">
                    {currency}
                </div>
            </div>
        </div>
    );
};

export default PaymentAmountField;
