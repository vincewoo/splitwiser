import React from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { sanitizeAmountInput } from '../../utils/amountInput';

export interface AmountFieldProps {
    /** The raw entry string, e.g. "124.8". */
    value: string;
    onChange: (value: string) => void;
    currency: string;
    /** Opens the currency picker. Omit to render the code as a plain label. */
    onCurrencyPress?: () => void;
}

const CURRENCY_SYMBOL: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: '$',
    CNY: '¥',
    HKD: '$',
    CHF: 'Fr',
};

/**
 * The amount hero — the figure being typed, at display size.
 *
 * A real text field rather than an in-app keypad: the system keyboard is the
 * one every user already knows, it brings its own paste, dictation and
 * autocorrect-free numeric layout, and it leaves the form the whole sheet.
 * `inputMode="decimal"` is what gets a numeric keypad on mobile while still
 * allowing the decimal separator; `type` stays `text` because `type="number"`
 * brings spinners, scroll-wheel edits and locale-dependent parsing.
 */
const AmountField: React.FC<AmountFieldProps> = ({
    value,
    onChange,
    currency,
    onCurrencyPress,
}) => (
    <div className="px-[18px] text-center">
        <div className="flex items-baseline justify-center gap-1.5">
            <span className="text-[26px] text-sw-dim">
                {CURRENCY_SYMBOL[currency] ?? ''}
            </span>
            <input
                id="amount-input"
                aria-label="Amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={value}
                onChange={(event) => onChange(sanitizeAmountInput(event.target.value))}
                /*
                 * Sized to its contents so the figure and its symbol stay
                 * centred together as digits are added. Tabular figures make
                 * `ch` an exact digit width; the slack covers the caret.
                 */
                style={{
                    width: `${Math.max(value.length, 1) + 0.6}ch`,
                    maxWidth: '100%',
                }}
                className="sw-num text-[60px] font-medium tracking-[-0.03em] leading-none bg-transparent border-0 p-0 text-center text-sw-text placeholder:text-sw-dim caret-sw-accent focus:outline-none"
            />
        </div>

        {onCurrencyPress ? (
            <button
                type="button"
                onClick={onCurrencyPress}
                className="inline-flex items-center gap-1.5 mt-1.5 px-[11px] py-1 rounded-full bg-sw-surface text-xs text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
            >
                {currency}
                <CaretDown size={12} />
            </button>
        ) : (
            <div className="inline-flex mt-1.5 px-[11px] py-1 rounded-full bg-sw-surface text-xs text-sw-muted shadow-[0_0_0_1px_var(--sw-line)]">
                {currency}
            </div>
        )}
    </div>
);

export default AmountField;
