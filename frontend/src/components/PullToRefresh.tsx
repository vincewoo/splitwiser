import React, { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import {
    PULL_THRESHOLD,
    REFRESHING_PULL,
    canStartPull,
    pullDistance,
    pullProgress,
    scrollableAncestor,
} from '../utils/pullToRefresh';

export interface PullToRefreshProps {
    /** Runs when the pull is released past the threshold. Awaited, so the
     *  indicator stays until the data has actually landed. */
    onRefresh: () => Promise<unknown> | void;
    children: React.ReactNode;
    className?: string;
}

/**
 * Pull down from the top of any screen to refresh it.
 *
 * Mounted once, around the shell's routed content, rather than per screen:
 * the gesture is the same everywhere and the refresh it triggers is the
 * global one, which every screen-local fetch already follows through
 * `refreshGeneration`. The wrapper only listens; it finds whatever is
 * scrolling under the finger and stays out of the way unless that scroller
 * is at the top and the drag is downward.
 *
 * Touch only. The listeners are attached by hand so `touchmove` can be
 * non-passive — once a pull is under way the page must not scroll or
 * rubber-band alongside it — while an ordinary scroll keeps the passive
 * fast path.
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({
    onRefresh,
    children,
    className = '',
}) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const onRefreshRef = useRef(onRefresh);
    useEffect(() => {
        onRefreshRef.current = onRefresh;
    }, [onRefresh]);

    const [pull, setPull] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        // Gesture state lives in refs: the listeners are attached once and
        // must see the current values, not the ones from their first render.
        let tracking = false;
        let startX = 0;
        let startY = 0;
        let scroller: Element | null = null;
        let current = 0;
        let busy = false;

        const reset = () => {
            tracking = false;
            current = 0;
            setPull(0);
        };

        const onStart = (event: TouchEvent) => {
            if (busy || event.touches.length !== 1) return;
            const target = event.target as Element;
            if (!canStartPull(target, root)) return;
            scroller = scrollableAncestor(target, root);
            startX = event.touches[0].clientX;
            startY = event.touches[0].clientY;
            tracking = true;
        };

        const onMove = (event: TouchEvent) => {
            if (!tracking) return;
            const dy = event.touches[0].clientY - startY;
            const dx = Math.abs(event.touches[0].clientX - startX);

            // Scrolled away, or a sideways swipe: not a pull after all.
            if ((scroller && scroller.scrollTop > 0) || (current === 0 && dx > dy)) {
                reset();
                return;
            }
            if (dy <= 0) {
                current = 0;
                setPull(0);
                return;
            }
            // From here the drag is ours; the scroller must not bounce with it.
            event.preventDefault();
            current = pullDistance(dy);
            setPull(current);
        };

        const onEnd = async () => {
            if (!tracking) return;
            const release = current;
            tracking = false;
            if (release < PULL_THRESHOLD) {
                reset();
                return;
            }
            busy = true;
            current = REFRESHING_PULL;
            setPull(REFRESHING_PULL);
            setRefreshing(true);
            try {
                await onRefreshRef.current();
            } catch (err) {
                // The refresh's own failure handling has already spoken; the
                // gesture just needs to let go.
                console.error('Pull to refresh failed:', err);
            } finally {
                busy = false;
                setRefreshing(false);
                reset();
            }
        };

        root.addEventListener('touchstart', onStart, { passive: true });
        root.addEventListener('touchmove', onMove, { passive: false });
        root.addEventListener('touchend', onEnd);
        root.addEventListener('touchcancel', onEnd);
        return () => {
            root.removeEventListener('touchstart', onStart);
            root.removeEventListener('touchmove', onMove);
            root.removeEventListener('touchend', onEnd);
            root.removeEventListener('touchcancel', onEnd);
        };
    }, []);

    const progress = pullProgress(pull);
    const visible = pull > 0;

    return (
        <div ref={rootRef} className={`relative ${className}`.trim()}>
            {children}
            {/*
              * The indicator rides the pull down from behind the top edge and
              * spins once the refresh is running. It never takes pointer
              * events: it is feedback, not a control.
              */}
            <div
                role="status"
                aria-label={refreshing ? 'Refreshing' : undefined}
                aria-hidden={!refreshing}
                className="pointer-events-none absolute left-1/2 top-0 z-30"
                style={{
                    transform: `translate(-50%, ${pull - 40}px)`,
                    opacity: visible ? Math.max(0.35, progress) : 0,
                    transition: refreshing || !visible ? 'transform 180ms ease-out, opacity 180ms' : 'none',
                }}
            >
                <div className="w-[34px] h-[34px] rounded-full bg-sw-surface text-sw-accent shadow-[0_0_0_1px_var(--sw-line),0_4px_14px_rgba(0,0,0,.14)] flex items-center justify-center">
                    <ArrowsClockwise
                        size={18}
                        weight="bold"
                        className={refreshing ? 'animate-spin' : ''}
                        style={refreshing ? undefined : { transform: `rotate(${progress * 180}deg)` }}
                    />
                </div>
            </div>
        </div>
    );
};

export default PullToRefresh;
