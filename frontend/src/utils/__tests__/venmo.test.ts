import { describe, it, expect, vi } from 'vitest';
import {
    buildVenmoLinks,
    centsToVenmoAmount,
    normalizeVenmoUsername,
    openVenmo,
    venmoUnavailableNote,
    venmoUsernameError,
} from '../venmo';

describe('venmoUnavailableNote', () => {
    it('says nothing for dollars — the hand-off is available there', () => {
        expect(venmoUnavailableNote('USD')).toBeNull();
    });

    it('names the currency Venmo cannot send', () => {
        expect(venmoUnavailableNote('EUR')).toContain('EUR');
        expect(venmoUnavailableNote('JPY')).toMatch(/only sends US dollars/);
    });
});

describe('normalizeVenmoUsername', () => {
    it('drops a leading @', () => {
        expect(normalizeVenmoUsername('@maya-chen')).toBe('maya-chen');
    });

    it('drops surrounding whitespace', () => {
        expect(normalizeVenmoUsername('  maya-chen  ')).toBe('maya-chen');
    });

    it('handles whitespace around the @', () => {
        expect(normalizeVenmoUsername(' @maya ')).toBe('maya');
    });

    it('leaves a clean handle alone', () => {
        expect(normalizeVenmoUsername('maya_chen1')).toBe('maya_chen1');
    });
});

describe('venmoUsernameError', () => {
    it('accepts letters, numbers, dashes and underscores', () => {
        expect(venmoUsernameError('Maya-Chen_1')).toBeNull();
    });

    it('treats empty as fine — it means "remove mine"', () => {
        expect(venmoUsernameError('')).toBeNull();
        expect(venmoUsernameError('   ')).toBeNull();
    });

    it('rejects spaces inside the handle', () => {
        expect(venmoUsernameError('maya chen')).toMatch(/letters, numbers/);
    });

    it('rejects anything over 30 characters', () => {
        expect(venmoUsernameError('a'.repeat(31))).toMatch(/30 characters/);
        expect(venmoUsernameError('a'.repeat(30))).toBeNull();
    });

    it('measures length after stripping the @', () => {
        expect(venmoUsernameError(`@${'a'.repeat(30)}`)).toBeNull();
    });
});

describe('centsToVenmoAmount', () => {
    it('renders cents as decimal dollars', () => {
        expect(centsToVenmoAmount(4235)).toBe('42.35');
    });

    it('always keeps two decimal places', () => {
        expect(centsToVenmoAmount(4200)).toBe('42.00');
        expect(centsToVenmoAmount(5)).toBe('0.05');
    });

    it('rounds a fractional cent rather than truncating', () => {
        expect(centsToVenmoAmount(4235.6)).toBe('42.36');
    });
});

describe('buildVenmoLinks', () => {
    const base = {
        username: 'maya-chen',
        amountCents: 8420,
        currency: 'USD',
        action: 'pay' as const,
    };

    it('builds a pay link with the amount pre-filled', () => {
        const url = new URL(buildVenmoLinks(base)!.web);
        expect(url.origin + url.pathname).toBe('https://venmo.com/');
        expect(url.searchParams.get('txn')).toBe('pay');
        expect(url.searchParams.get('recipients')).toBe('maya-chen');
        expect(url.searchParams.get('amount')).toBe('84.20');
    });

    it('asks rather than pays when they owe you', () => {
        const url = new URL(buildVenmoLinks({ ...base, action: 'request' })!.web);
        expect(url.searchParams.get('txn')).toBe('charge');
    });

    it('keeps the transaction private by default', () => {
        const url = new URL(buildVenmoLinks(base)!.web);
        expect(url.searchParams.get('audience')).toBe('private');
    });

    it('carries the note', () => {
        const url = new URL(buildVenmoLinks({ ...base, note: 'Tahoe Weekend' })!.web);
        expect(url.searchParams.get('note')).toBe('Tahoe Weekend');
    });

    it('truncates a very long note', () => {
        const url = new URL(
            buildVenmoLinks({ ...base, note: 'x'.repeat(500) })!.web
        );
        expect(url.searchParams.get('note')!.length).toBe(180);
    });

    it('omits an empty note rather than sending a blank one', () => {
        const url = new URL(buildVenmoLinks({ ...base, note: '   ' })!.web);
        expect(url.searchParams.has('note')).toBe(false);
    });

    it('normalises a handle that still has its @', () => {
        const url = new URL(buildVenmoLinks({ ...base, username: '@maya-chen' })!.web);
        expect(url.searchParams.get('recipients')).toBe('maya-chen');
    });

    it('percent-encodes a note with punctuation', () => {
        const link = buildVenmoLinks({ ...base, note: 'Dinner & drinks' })!.web;
        expect(link).toContain('note=Dinner+%26+drinks');
        expect(new URL(link).searchParams.get('note')).toBe('Dinner & drinks');
    });

    // Venmo is USD-only. Pre-filling a euro figure as dollars would ask for
    // the wrong amount of money, which is worse than not offering the button.
    it('refuses any currency but USD', () => {
        expect(buildVenmoLinks({ ...base, currency: 'EUR' })).toBeNull();
        expect(buildVenmoLinks({ ...base, currency: 'GBP' })).toBeNull();
    });

    it('refuses a missing or unusable handle', () => {
        expect(buildVenmoLinks({ ...base, username: '' })).toBeNull();
        expect(buildVenmoLinks({ ...base, username: 'maya chen' })).toBeNull();
    });

    it('refuses a zero or negative amount', () => {
        expect(buildVenmoLinks({ ...base, amountCents: 0 })).toBeNull();
        expect(buildVenmoLinks({ ...base, amountCents: -500 })).toBeNull();
    });
});

describe('buildVenmoLinks — the app scheme', () => {
    const base = {
        username: 'maya-chen',
        amountCents: 8420,
        currency: 'USD',
        action: 'pay' as const,
    };

    it('carries the same query as the web link', () => {
        const links = buildVenmoLinks({ ...base, note: 'Tahoe' })!;
        expect(links.app.startsWith('venmo://paycharge?')).toBe(true);
        expect(links.app.split('?')[1]).toBe(links.web.split('?')[1]);
    });

    it('is refused alongside the web link, never on its own', () => {
        expect(buildVenmoLinks({ ...base, currency: 'EUR' })).toBeNull();
    });
});

describe('openVenmo', () => {
    const links = { app: 'venmo://paycharge?txn=pay', web: 'https://venmo.com/?txn=pay' };

    /**
     * jsdom refuses real navigation, so `location.href` is swapped for a
     * recorder. Restored by the returned function.
     */
    function captureNavigation() {
        const seen: string[] = [];
        const original = Object.getOwnPropertyDescriptor(window, 'location');
        delete (window as { location?: unknown }).location;
        (window as unknown as { location: unknown }).location = {
            get href() {
                return 'http://localhost/';
            },
            set href(value: string) {
                seen.push(value);
            },
        };
        return {
            seen,
            restore: () => {
                delete (window as { location?: unknown }).location;
                if (original) Object.defineProperty(window, 'location', original);
            },
        };
    }

    it('goes straight to the web link when apps are impossible', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        openVenmo(links, { canOpenApps: () => false });
        expect(open).toHaveBeenCalledWith(
            links.web,
            '_blank',
            'noopener,noreferrer'
        );
        open.mockRestore();
    });

    it('tries the app scheme first on a touch device', () => {
        vi.useFakeTimers();
        const nav = captureNavigation();
        openVenmo(links, { canOpenApps: () => true });
        expect(nav.seen).toEqual([links.app]);
        nav.restore();
        vi.useRealTimers();
    });

    it('falls back to the web link when nothing takes the scheme', () => {
        vi.useFakeTimers();
        const nav = captureNavigation();
        openVenmo(links, { canOpenApps: () => true, timeoutMs: 1000 });
        vi.advanceTimersByTime(1000);
        expect(nav.seen).toEqual([links.app, links.web]);
        nav.restore();
        vi.useRealTimers();
    });

    it('does not fall back once the page is hidden — the app took over', () => {
        vi.useFakeTimers();
        const nav = captureNavigation();
        const visibility = vi
            .spyOn(document, 'visibilityState', 'get')
            .mockReturnValue('hidden');

        openVenmo(links, { canOpenApps: () => true, timeoutMs: 1000 });
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(5000);

        expect(nav.seen).toEqual([links.app]);
        visibility.mockRestore();
        nav.restore();
        vi.useRealTimers();
    });

    it('ignores a visibilitychange that reports the page still visible', () => {
        vi.useFakeTimers();
        const nav = captureNavigation();
        openVenmo(links, { canOpenApps: () => true, timeoutMs: 1000 });
        // jsdom reports 'visible' by default — this is the return trip.
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(1000);
        expect(nav.seen).toEqual([links.app, links.web]);
        nav.restore();
        vi.useRealTimers();
    });

    it('cancels the pending fallback when the caller cleans up', () => {
        vi.useFakeTimers();
        const nav = captureNavigation();
        const cancel = openVenmo(links, { canOpenApps: () => true, timeoutMs: 1000 });
        cancel();
        vi.advanceTimersByTime(5000);
        expect(nav.seen).toEqual([links.app]);
        nav.restore();
        vi.useRealTimers();
    });
});
