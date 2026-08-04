/**
 * Venmo hand-off for settling up.
 *
 * Splitwiser records that a debt was settled; it never moves money. This builds
 * the link that hands the payment to Venmo with the recipient, amount and note
 * already filled in, so the person paying does not retype a figure they might
 * get wrong.
 *
 * Opening the link is NOT the same as being paid. Nothing here marks anything
 * settled — recording stays a separate, deliberate action, because we have no
 * way to learn whether the payment actually went through.
 */

/** Venmo settles in US dollars only. */
export const VENMO_CURRENCY = 'USD';

/** Venmo truncates long notes; keep well inside whatever the current limit is. */
const NOTE_MAX = 180;

export type VenmoAction = 'pay' | 'request';

export interface VenmoLinkInput {
    /** Handle without the leading @. */
    username: string;
    /** Amount in cents, as stored throughout the app. Must be positive. */
    amountCents: number;
    /** ISO currency of the debt — anything but USD is refused. */
    currency: string;
    /** 'pay' when you owe them, 'request' when they owe you. */
    action: VenmoAction;
    /** What the payment is for. Trimmed and truncated. */
    note?: string;
}

/**
 * Normalise a handle the way the server does: drop a leading @ and surrounding
 * whitespace. Exported so the settings field can show the stored form as you
 * type rather than surprising you after a save.
 */
export function normalizeVenmoUsername(raw: string): string {
    return raw.trim().replace(/^@+/, '').trim();
}

/** The character set Venmo handles use. Length is checked separately. */
const HANDLE = /^[A-Za-z0-9_-]+$/;

/**
 * Why a handle is unusable, or null when it is fine. The message is shown to
 * the person typing it.
 */
export function venmoUsernameError(raw: string): string | null {
    const handle = normalizeVenmoUsername(raw);
    if (!handle) return null; // empty means "remove mine", not an error
    if (handle.length > 30) return 'Venmo usernames are at most 30 characters.';
    if (!HANDLE.test(handle)) {
        return 'Use letters, numbers, dashes and underscores only.';
    }
    return null;
}

/** Cents to the plain decimal string Venmo expects: 4235 → "42.35". */
export function centsToVenmoAmount(cents: number): string {
    return (Math.round(cents) / 100).toFixed(2);
}

export interface VenmoLinks {
    /** `venmo://` — opens the installed app directly, and nothing else. */
    app: string;
    /** `https://venmo.com/…` — the app on a phone, the website anywhere else. */
    web: string;
}

/**
 * Build both Venmo links, or null when we should not offer one.
 *
 * Returns null rather than a broken link when the currency is not USD: Venmo
 * has no notion of the other currencies this app supports, and handing it
 * "52.14" from a EUR debt would pre-fill the wrong number of dollars. The
 * caller is expected to explain the omission rather than silently drop it.
 *
 * Two links because they fail differently. The `venmo://` scheme reaches the
 * installed app with no interstitial, but on a device without Venmo it either
 * does nothing or raises a browser error. The https form always resolves — as
 * a universal link into the app on a phone, as the website otherwise — but on
 * some Android browsers it lands on the web page even when the app is present.
 * `openVenmo` below tries the first and falls back to the second.
 */
export function buildVenmoLinks(input: VenmoLinkInput): VenmoLinks | null {
    const username = normalizeVenmoUsername(input.username);
    if (!username || venmoUsernameError(username)) return null;
    if (input.currency !== VENMO_CURRENCY) return null;
    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) return null;

    const params = new URLSearchParams({
        txn: input.action === 'pay' ? 'pay' : 'charge',
        audience: 'private',
        recipients: username,
        amount: centsToVenmoAmount(input.amountCents),
    });

    const note = input.note?.trim();
    if (note) params.set('note', note.slice(0, NOTE_MAX));

    const query = params.toString();
    return {
        app: `venmo://paycharge?${query}`,
        web: `https://venmo.com/?${query}`,
    };
}

/**
 * Why there is no hand-off for a debt, when the reason is worth saying.
 *
 * Only the currency earns an explanation: it is a fact about Venmo the viewer
 * can act on by settling another way. A counterparty who has published no
 * handle, or who is a guest with no account at all, is not something to
 * announce — that is their business, not a fault in the debt. Returns null
 * when there is nothing useful to add.
 */
export function venmoUnavailableNote(currency: string): string | null {
    if (currency === VENMO_CURRENCY) return null;
    return `Venmo only sends US dollars, so there’s no shortcut for a ${currency} debt.`;
}

/** How long to wait for the app to take over before falling back, in ms. */
export const APP_HANDOFF_TIMEOUT_MS = 1200;

/**
 * True when this looks like a device that can have apps installed.
 *
 * A coarse pointer is the honest signal: it is asking "is this a touchscreen",
 * not "is the window narrow". A desktop browser has no Venmo app to reach, so
 * firing the custom scheme there only risks an error dialog before the
 * fallback fires.
 */
export function canOpenApps(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Open Venmo, preferring the installed app.
 *
 * There is no way to ask a browser whether a scheme is registered, so this
 * uses the standard proxy: fire the scheme, then fall back to the web link
 * unless the page gets hidden first — being backgrounded is what actually
 * happens when another app takes over. Any of `visibilitychange`, `pagehide`
 * or `blur` counts, because which one fires varies by browser.
 *
 * On a device that cannot hold apps this skips the scheme entirely, since the
 * only possible outcome there is a wasted delay.
 *
 * Returns a cleanup function, so a caller unmounting mid-flight can cancel the
 * pending fallback rather than yanking the page out from under someone.
 */
export function openVenmo(
    links: VenmoLinks,
    options: { canOpenApps?: () => boolean; timeoutMs?: number } = {}
): () => void {
    const detect = options.canOpenApps ?? canOpenApps;
    const timeoutMs = options.timeoutMs ?? APP_HANDOFF_TIMEOUT_MS;

    if (!detect()) {
        window.open(links.web, '_blank', 'noopener,noreferrer');
        return () => {};
    }

    let settled = false;
    const events = ['visibilitychange', 'pagehide', 'blur'] as const;

    const cleanup = () => {
        settled = true;
        window.clearTimeout(timer);
        for (const event of events) {
            document.removeEventListener(event, onLeave);
            window.removeEventListener(event, onLeave);
        }
    };

    function onLeave() {
        // visibilitychange also fires on the way *back*; only a hide counts.
        if (document.visibilityState === 'visible') return;
        cleanup();
    }

    const timer = window.setTimeout(() => {
        if (settled) return;
        cleanup();
        // Still here, so nothing took the scheme. Same tab: a popup opened
        // this late is what popup blockers exist to stop.
        window.location.href = links.web;
    }, timeoutMs);

    for (const event of events) {
        document.addEventListener(event, onLeave);
        window.addEventListener(event, onLeave);
    }

    window.location.href = links.app;
    return cleanup;
}
