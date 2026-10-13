/**
 * Text editing for the add-expense amount.
 *
 * The amount is typed on the system's own numeric keyboard, so the value is
 * whatever the field currently holds — a string mid-edit, not a number. Kept
 * separate from the component so the rules are testable on their own.
 */

/** Digits before the decimal point. 9,999,999.99 is well past any real bill. */
const MAX_INTEGER_DIGITS = 7;
const MAX_DECIMALS = 2;

/**
 * Constrain whatever the field now holds to a money entry.
 *
 * `inputMode` only asks for a numeric keyboard; it does not stop other
 * characters arriving by paste, by a hardware keyboard, or from a locale that
 * types "," for the decimal separator. So the value is filtered on every
 * change. Anything invalid is dropped rather than rejecting the whole entry,
 * so typing never appears to stall.
 */
export function sanitizeAmountInput(raw: string): string {
    /*
     * A comma is the decimal separator on many locales' numeric keyboards, and
     * the thousands separator in plenty of pasted figures. Read it as the
     * decimal point only when it is the sole separator in the string —
     * otherwise it is grouping, and grouping is dropped.
     */
    const commas = raw.match(/,/g)?.length ?? 0;
    const unified =
        commas === 1 && !raw.includes('.')
            ? raw.replace(',', '.')
            : raw.replace(/,/g, '');
    const cleaned = unified.replace(/[^0-9.]/g, '');
    if (cleaned === '') return '';

    const [whole = '', ...rest] = cleaned.split('.');
    const hasPoint = rest.length > 0;

    // A lone leading zero is a legitimate start ("0.99"); a run of them is not.
    const trimmed = whole.replace(/^0+(?=\d)/, '').slice(0, MAX_INTEGER_DIGITS);
    // Typing "." first gives "0.", as the keypad used to.
    const head = trimmed === '' && hasPoint ? '0' : trimmed;
    if (!hasPoint) return head;

    // A second point is absorbed rather than swallowing the digits after it.
    return `${head}.${rest.join('').slice(0, MAX_DECIMALS)}`;
}

/**
 * The amount in cents, rounded, or null when nothing usable has been entered.
 * Trailing "." and empty input both count as nothing.
 */
export function amountToCents(current: string): number | null {
    if (current === '' || current === '.') return null;
    const value = parseFloat(current);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
}

/**
 * Seed an optional money field from cents: empty string for nothing (or a
 * credit), otherwise a fixed two-decimal figure. Distinct from the
 * centsToInput in settleAmount.ts, which renders zero as a zero figure; a tax
 * or tip field starting at zero reads as a value the user chose.
 */
export function centsToOptionalInput(cents: number): string {
    return cents > 0 ? (cents / 100).toFixed(2) : '';
}

/**
 * The cents a free-typed money field holds, defaulting to zero. Unlike
 * amountToCents, an empty or unparseable field is 0 rather than null: tax and
 * tip legitimately sit at nothing.
 */
export function inputToCentsOrZero(value: string): number {
    const parsed = Math.round(parseFloat(value || '0') * 100);
    return Number.isFinite(parsed) ? parsed : 0;
}
