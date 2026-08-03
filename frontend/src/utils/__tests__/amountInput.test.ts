import { describe, it, expect } from 'vitest';
import { amountToCents, sanitizeAmountInput } from '../amountInput';

/** Type a whole sequence one character at a time, as the field receives it. */
const type = (keys: string, from = ''): string =>
    [...keys].reduce<string>(
        (value, key) => sanitizeAmountInput(value + key),
        from
    );

describe('sanitizeAmountInput', () => {
    it('builds up a plain amount', () => {
        expect(type('12480')).toBe('12480');
    });

    it('accepts one decimal point', () => {
        expect(type('124.80')).toBe('124.80');
    });

    it('ignores a second decimal point', () => {
        expect(sanitizeAmountInput('124.8.')).toBe('124.8');
    });

    it('starts a decimal from zero when "." is typed first', () => {
        expect(type('.5')).toBe('0.5');
    });

    it('stops at two decimal places', () => {
        expect(sanitizeAmountInput('124.805')).toBe('124.80');
        expect(type('124.805')).toBe('124.80');
    });

    it('replaces a lone leading zero rather than extending it', () => {
        expect(sanitizeAmountInput('05')).toBe('5');
        // But zero followed by a decimal is a legitimate start.
        expect(type('0.99')).toBe('0.99');
    });

    it('refuses to pile up leading zeros', () => {
        expect(sanitizeAmountInput('00')).toBe('0');
    });

    it('caps the integer part', () => {
        expect(type('12345678')).toBe('1234567');
    });

    it('does not cap digits after the decimal point', () => {
        // The integer cap applies to the whole part only.
        expect(type('1234567.89')).toBe('1234567.89');
    });

    it('deletes one character at a time, down to empty', () => {
        // Deleting is the field's own business; the filter must not fight it.
        expect(sanitizeAmountInput('124.8')).toBe('124.8');
        expect(sanitizeAmountInput('124.')).toBe('124.');
        expect(sanitizeAmountInput('')).toBe('');
    });

    it('takes a comma as the decimal separator', () => {
        // Numeric keyboards in much of the world offer "," rather than ".".
        expect(sanitizeAmountInput('124,8')).toBe('124.8');
    });

    it('strips anything that is not part of a number', () => {
        expect(sanitizeAmountInput('$1,299.99 USD')).toBe('1299.99');
        expect(sanitizeAmountInput('abc')).toBe('');
        expect(sanitizeAmountInput('-12')).toBe('12');
    });
});

describe('amountToCents', () => {
    it('converts a well-formed amount', () => {
        expect(amountToCents('124.80')).toBe(12480);
        expect(amountToCents('124.8')).toBe(12480);
        expect(amountToCents('7')).toBe(700);
    });

    it('rounds rather than truncating', () => {
        expect(amountToCents('0.005')).toBe(1);
    });

    it('rejects nothing-entered states', () => {
        expect(amountToCents('')).toBeNull();
        expect(amountToCents('.')).toBeNull();
        expect(amountToCents('0')).toBeNull();
        expect(amountToCents('0.00')).toBeNull();
    });

    it('treats a trailing decimal point as its whole part', () => {
        expect(amountToCents('12.')).toBe(1200);
    });
});
