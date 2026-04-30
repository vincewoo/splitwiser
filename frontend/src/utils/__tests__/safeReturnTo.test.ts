// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../safeReturnTo';

describe('safeReturnTo', () => {
    it('returns fallback when value is null', () => {
        expect(safeReturnTo(null)).toBe('/');
    });

    it('returns fallback when value is undefined', () => {
        expect(safeReturnTo(undefined)).toBe('/');
    });

    it('returns fallback when value is an empty string', () => {
        expect(safeReturnTo('')).toBe('/');
    });

    it('returns the value when it is a simple absolute path', () => {
        expect(safeReturnTo('/share/abc123')).toBe('/share/abc123');
    });

    it('returns the value when it has query and hash components', () => {
        expect(safeReturnTo('/groups/42?foo=bar#x')).toBe('/groups/42?foo=bar#x');
    });

    it('returns fallback when value is protocol-relative', () => {
        expect(safeReturnTo('//evil.com/path')).toBe('/');
    });

    it('returns fallback when value starts with /\\', () => {
        expect(safeReturnTo('/\\evil.com')).toBe('/');
    });

    it('returns fallback when value is an absolute URL', () => {
        expect(safeReturnTo('https://evil.com/path')).toBe('/');
    });

    it('returns fallback when value uses the javascript: scheme', () => {
        expect(safeReturnTo('javascript:alert(1)')).toBe('/');
    });

    it('returns fallback when value is missing the leading slash', () => {
        expect(safeReturnTo('share/abc123')).toBe('/');
    });

    it('returns fallback when value contains :// somewhere', () => {
        expect(safeReturnTo('/share/abc?u=http://x')).toBe('/');
    });

    it('respects a custom fallback when provided', () => {
        expect(safeReturnTo(null, '/login')).toBe('/login');
    });
});
