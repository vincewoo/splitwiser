import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PullToRefresh from '../PullToRefresh';
import { PULL_THRESHOLD } from '../../utils/pullToRefresh';

const onRefresh = vi.fn();

/** A screen: a header and a list that scrolls, like every routed page. */
function mount(scrollTop = 0) {
    render(
        <PullToRefresh onRefresh={onRefresh}>
            <div data-testid="header">Tahoe</div>
            <div data-testid="list" style={{ overflowY: 'auto' }}>
                <div data-testid="row">Cabin</div>
            </div>
            <div role="dialog" aria-label="A sheet">
                <input aria-label="Amount" />
            </div>
        </PullToRefresh>
    );
    const list = screen.getByTestId('list');
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
}

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

/** Drag from (0, 0) straight down by `dy` and let go. */
function pull(target: HTMLElement, dy: number) {
    fireEvent.touchStart(target, touch(0, 0));
    fireEvent.touchMove(target, touch(0, dy));
    fireEvent.touchEnd(target);
}

/** A finger drag that translates to exactly the threshold (travel is damped 2:1). */
const ENOUGH = PULL_THRESHOLD * 2;

beforeEach(() => {
    onRefresh.mockReset();
    onRefresh.mockResolvedValue(undefined);
});

describe('PullToRefresh', () => {
    it('refreshes when released past the threshold', async () => {
        mount();
        pull(screen.getByTestId('row'), ENOUGH);
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('does nothing when let go short of it', () => {
        mount();
        pull(screen.getByTestId('row'), ENOUGH - 4);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('works from chrome as well as from the list', async () => {
        mount();
        pull(screen.getByTestId('header'), ENOUGH);
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('leaves a scrolled list alone — that drag is scrolling up', () => {
        mount(80);
        pull(screen.getByTestId('row'), ENOUGH);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('leaves a sheet alone — that drag dismisses it', () => {
        mount();
        pull(screen.getByLabelText('Amount'), ENOUGH);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('lets a sideways swipe through', () => {
        mount();
        const row = screen.getByTestId('row');
        fireEvent.touchStart(row, touch(0, 0));
        fireEvent.touchMove(row, touch(200, 40));
        fireEvent.touchMove(row, touch(220, ENOUGH));
        fireEvent.touchEnd(row);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('resets instead of refreshing when the gesture is cancelled', async () => {
        mount();
        const row = screen.getByTestId('row');
        fireEvent.touchStart(row, touch(0, 0));
        fireEvent.touchMove(row, touch(0, ENOUGH));
        // The OS took the touch — a notification shade, an app switch. An
        // interruption past the threshold is not an intent to refresh.
        fireEvent.touchCancel(row);
        expect(onRefresh).not.toHaveBeenCalled();
        // The indicator has gone back behind the top edge…
        expect(screen.getByRole('status', { hidden: true })).toHaveStyle({ opacity: '0' });
        // …and the next pull starts clean.
        pull(row, ENOUGH);
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('takes over the drag once a pull is under way, so the page does not bounce too', () => {
        mount();
        const row = screen.getByTestId('row');
        fireEvent.touchStart(row, touch(0, 0));
        // fireEvent returns false when the handler called preventDefault.
        expect(fireEvent.touchMove(row, touch(0, 30))).toBe(false);
        // An ordinary scroll (upward drag) is left to the browser.
        fireEvent.touchEnd(row);
        fireEvent.touchStart(row, touch(0, 100));
        expect(fireEvent.touchMove(row, touch(0, 60))).toBe(true);
    });

    it('hooks the non-passive touchmove per gesture, not for the component lifetime', () => {
        mount();
        const row = screen.getByTestId('row');
        const root = screen.getByTestId('header').parentElement as HTMLElement;
        const added = vi.spyOn(root, 'addEventListener');
        const removed = vi.spyOn(root, 'removeEventListener');

        // Mounted and idle, nothing is listening for moves.
        expect(added).not.toHaveBeenCalled();
        // An eligible touch attaches it — non-passively, so it can take over —
        // and letting go takes it off again.
        fireEvent.touchStart(row, touch(0, 0));
        expect(added).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false });
        fireEvent.touchEnd(row);
        expect(removed).toHaveBeenCalledWith('touchmove', expect.any(Function));
    });

    it('never hooks touchmove for a touch that cannot start a pull', () => {
        mount(80);
        const root = screen.getByTestId('header').parentElement as HTMLElement;
        const added = vi.spyOn(root, 'addEventListener');
        fireEvent.touchStart(screen.getByTestId('row'), touch(0, 0));
        expect(added).not.toHaveBeenCalled();
    });

    it('shows a status while the refresh is running, then clears it', async () => {
        let finish!: () => void;
        onRefresh.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
        mount();
        pull(screen.getByTestId('row'), ENOUGH);

        await screen.findByRole('status', { name: 'Refreshing' });
        await act(async () => finish());
        await waitFor(() =>
            expect(screen.queryByRole('status', { name: 'Refreshing' })).toBeNull()
        );
    });

    it('ignores a second pull while one is refreshing', async () => {
        let finish!: () => void;
        onRefresh.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
        mount();
        pull(screen.getByTestId('row'), ENOUGH);
        await screen.findByRole('status', { name: 'Refreshing' });
        pull(screen.getByTestId('row'), ENOUGH);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        await act(async () => finish());
    });

    it('recovers when the refresh fails', async () => {
        onRefresh.mockRejectedValue(new Error('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mount();
        pull(screen.getByTestId('row'), ENOUGH);
        await waitFor(() =>
            expect(screen.queryByRole('status', { name: 'Refreshing' })).toBeNull()
        );
        // And the next pull works again.
        onRefresh.mockResolvedValue(undefined);
        pull(screen.getByTestId('row'), ENOUGH);
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
    });
});
