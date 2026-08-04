import React, { useEffect, useRef } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Button } from './ui';
import { openVenmo } from '../utils/venmo';
import type { ButtonVariant } from './ui';
import type { VenmoAction, VenmoLinks } from '../utils/venmo';

export interface VenmoButtonProps {
    /** From `buildVenmoLinks`. Build it at the callsite so the surface can also
     *  decide what to say when there is no hand-off to offer. */
    links: VenmoLinks;
    /** 'pay' when the signed-in user owes, 'request' when they are owed. */
    action: VenmoAction;
    /** The other party, for the accessible label. */
    counterparty?: string;
    /** Just "Venmo", for rows that cannot spare the width. */
    compact?: boolean;
    variant?: ButtonVariant;
    block?: boolean;
    className?: string;
}

/**
 * The hand-off to Venmo, wherever settling up happens.
 *
 * A real anchor rather than a button, so it can be copied, middle-clicked and
 * opened in a new tab; the click handler upgrades a plain left click to try the
 * installed app first (see `openVenmo`). The pending fallback is cancelled on
 * unmount, which matters here because most of these live inside modals — a
 * sheet dismissed mid-hand-off should not yank the page to venmo.com behind it.
 *
 * Opening Venmo is never treated as payment. Every surface that renders this
 * keeps its own separate, deliberate "mark as paid" action, because we get no
 * callback telling us whether the money moved.
 */
const VenmoButton: React.FC<VenmoButtonProps> = ({
    links,
    action,
    counterparty,
    compact = false,
    variant = 'secondary',
    block = false,
    className = '',
}) => {
    const cancelRef = useRef<(() => void) | null>(null);
    useEffect(() => () => cancelRef.current?.(), []);

    const verb = action === 'pay' ? 'Pay with Venmo' : 'Ask on Venmo';
    const label = counterparty
        ? action === 'pay'
            ? `Pay ${counterparty} with Venmo`
            : `Ask ${counterparty} on Venmo`
        : verb;

    return (
        <Button
            href={links.web}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            onClick={(event) => {
                // Leave the modified clicks alone — those are the user asking
                // the browser for a new tab or window, not for the app.
                if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.button !== 0
                ) {
                    return;
                }
                event.preventDefault();
                cancelRef.current?.();
                cancelRef.current = openVenmo(links);
            }}
            variant={variant}
            block={block}
            icon={<ArrowSquareOut size={15} />}
            className={className}
        >
            {compact ? 'Venmo' : verb}
        </Button>
    );
};

export default VenmoButton;
