import { describe, it, expect, afterEach } from 'vitest';
import {
    MAX_PULL,
    PULL_THRESHOLD,
    canStartPull,
    pullDistance,
    pullProgress,
    scrollableAncestor,
} from '../pullToRefresh';

/** A scroll container: overflow-y auto with more content than height. */
function scroller(scrollTop = 0): HTMLDivElement {
    const el = document.createElement('div');
    el.style.overflowY = 'auto';
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    el.scrollTop = scrollTop;
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
    return el;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('pullDistance', () => {
    it('ignores an upward or stationary finger', () => {
        expect(pullDistance(0)).toBe(0);
        expect(pullDistance(-30)).toBe(0);
    });

    it('lags the finger rather than following it 1:1', () => {
        expect(pullDistance(40)).toBe(20);
        expect(pullDistance(PULL_THRESHOLD * 2)).toBe(PULL_THRESHOLD);
    });

    it('stops at the cap however far the drag goes', () => {
        expect(pullDistance(1000)).toBe(MAX_PULL);
    });
});

describe('pullProgress', () => {
    it('reaches 1 at the threshold and stays there', () => {
        expect(pullProgress(0)).toBe(0);
        expect(pullProgress(PULL_THRESHOLD / 2)).toBe(0.5);
        expect(pullProgress(PULL_THRESHOLD)).toBe(1);
        expect(pullProgress(MAX_PULL)).toBe(1);
    });
});

describe('scrollableAncestor', () => {
    it('finds the container that would scroll under the finger', () => {
        const root = document.createElement('div');
        const list = scroller();
        const row = document.createElement('div');
        list.appendChild(row);
        root.appendChild(list);
        document.body.appendChild(root);

        expect(scrollableAncestor(row, root)).toBe(list);
    });

    it('returns null when nothing between the target and the root scrolls', () => {
        const root = document.createElement('div');
        const header = document.createElement('div');
        root.appendChild(header);
        document.body.appendChild(root);

        expect(scrollableAncestor(header, root)).toBeNull();
    });

    it('does not count a container with nothing to scroll', () => {
        const root = document.createElement('div');
        const list = document.createElement('div');
        list.style.overflowY = 'auto';
        Object.defineProperty(list, 'scrollHeight', { value: 100 });
        Object.defineProperty(list, 'clientHeight', { value: 400 });
        const row = document.createElement('div');
        list.appendChild(row);
        root.appendChild(list);
        document.body.appendChild(root);

        expect(scrollableAncestor(row, root)).toBeNull();
    });

    it('stops at the root and never looks above it', () => {
        const outer = scroller();
        const root = document.createElement('div');
        const row = document.createElement('div');
        root.appendChild(row);
        outer.appendChild(root);
        document.body.appendChild(outer);

        expect(scrollableAncestor(row, root)).toBeNull();
    });
});

describe('canStartPull', () => {
    it('allows a pull from the top of a scroller, or from chrome', () => {
        const root = document.createElement('div');
        const list = scroller(0);
        const row = document.createElement('div');
        const header = document.createElement('div');
        list.appendChild(row);
        root.append(header, list);
        document.body.appendChild(root);

        expect(canStartPull(row, root)).toBe(true);
        expect(canStartPull(header, root)).toBe(true);
    });

    it('refuses while the scroller is scrolled down — that drag is a scroll', () => {
        const root = document.createElement('div');
        const list = scroller(120);
        const row = document.createElement('div');
        list.appendChild(row);
        root.appendChild(list);
        document.body.appendChild(root);

        expect(canStartPull(row, root)).toBe(false);
    });

    it('refuses inside a dialog — dragging a sheet down dismisses it', () => {
        const root = document.createElement('div');
        const sheet = document.createElement('div');
        sheet.setAttribute('role', 'dialog');
        const field = document.createElement('input');
        sheet.appendChild(field);
        root.appendChild(sheet);
        document.body.appendChild(root);

        expect(canStartPull(field, root)).toBe(false);
    });
});
