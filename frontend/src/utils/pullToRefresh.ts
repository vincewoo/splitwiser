/**
 * The arithmetic behind pull-to-refresh, kept apart from the component so
 * the thresholds and the scroller lookup can be tested without touch events.
 *
 * Installed as a PWA the app owns the whole viewport: the shell is
 * `overflow-hidden` and each screen scrolls inside its own container, so the
 * browser's own pull-to-refresh never fires (and would reload the entire app
 * if it did). This is the replacement — a drag down from the top of whatever
 * is scrolling, past a threshold, refreshes the data in place.
 */

/** How far the finger has to drag before letting go refreshes, in px. */
export const PULL_THRESHOLD = 64;

/** The indicator never travels further than this, however far the drag. */
export const MAX_PULL = 96;

/** Where the indicator rests while a refresh is in flight. */
export const REFRESHING_PULL = 48;

/**
 * Finger travel to indicator travel. Damped so the indicator lags the finger
 * — a 1:1 drag reads as the page tearing off — and capped so a long drag
 * does not push it into the content.
 */
export function pullDistance(fingerDy: number): number {
    if (fingerDy <= 0) return 0;
    return Math.min(MAX_PULL, fingerDy * 0.5);
}

/** 0 at rest, 1 at the threshold; drives the indicator's fade and rotation. */
export function pullProgress(pull: number): number {
    return Math.min(1, pull / PULL_THRESHOLD);
}

/**
 * The element that would scroll if the finger moved: the nearest ancestor of
 * `target` (up to and excluding `root`) that overflows and is scrollable.
 * Null when nothing between them scrolls, which means the drag lands on
 * chrome — a header, an empty page — and the pull can proceed freely.
 */
export function scrollableAncestor(target: Element, root: Element): Element | null {
    let el: Element | null = target;
    while (el && el !== root) {
        const { overflowY } = getComputedStyle(el);
        if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight
        ) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
}

/**
 * Whether a touch that landed on `target` may start a pull.
 *
 * Not from inside a dialog — a sheet dragged down is a sheet being dismissed,
 * not a page being refreshed — and not while the scroller under the finger
 * is scrolled away from the top, since that drag is just scrolling up.
 */
export function canStartPull(target: Element, root: Element): boolean {
    if (target.closest('[role="dialog"], [role="alertdialog"]')) return false;
    const scroller = scrollableAncestor(target, root);
    return scroller === null || scroller.scrollTop <= 0;
}
