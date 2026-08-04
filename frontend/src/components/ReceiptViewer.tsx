import React, { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, FilePdf, MagnifyingGlassPlus, X } from '@phosphor-icons/react';
import { getApiUrl } from '../api';

export interface ReceiptViewerProps {
    /** The stored path, e.g. `/static/receipts/<uuid>.jpg`. */
    path: string;
    /**
     * 'tile' is a small square for a detail panel; 'strip' fills its column and
     * crops to the top of the paper, which is where the venue name is.
     */
    variant?: 'tile' | 'strip';
    className?: string;
}

/** A PDF cannot go in an `<img>`, so it is offered rather than shown. */
function isPdf(path: string): boolean {
    return /\.pdf(\?|#|$)/i.test(path);
}

const THUMB_CLASS: Record<'tile' | 'strip', string> = {
    tile: 'w-[86px] h-[110px]',
    strip: 'w-full h-[104px]',
};

/**
 * The receipt that was actually photographed.
 *
 * Everywhere else the app shows the bill as *data* — lines it parsed, totals it
 * computed. This is the one place the original is on screen, so it exists to
 * answer "did the scan get that right?": a thumbnail you can check at a glance,
 * and full size when the answer is in the small print.
 *
 * It renders the image inline rather than linking out. A link is worse here for
 * two reasons — the service worker owns navigation in the installed app, and a
 * new tab loses the expense you were reading.
 */
const ReceiptViewer: React.FC<ReceiptViewerProps> = ({
    path,
    variant = 'tile',
    className = '',
}) => {
    const url = getApiUrl(path);
    const pdf = isPdf(path);

    const [open, setOpen] = useState(false);
    // Full size means full size: the fitted view is for orientation, and reading
    // a total in 8pt print needs the pixels the camera captured.
    const [actualSize, setActualSize] = useState(false);
    const [failed, setFailed] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        closeRef.current?.focus();

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [open]);

    // A PDF, or an image whose file has gone: both are a link and nothing more.
    if (pdf || failed) {
        return (
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-sw-card text-[13px] text-sw-text no-underline shadow-[0_0_0_1px_var(--sw-line)] hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${className}`.trim()}
            >
                {pdf ? (
                    <FilePdf size={18} className="text-sw-muted flex-none" />
                ) : (
                    <ArrowSquareOut size={16} className="text-sw-muted flex-none" />
                )}
                <span className="flex-1 min-w-0">
                    <span className="block">
                        {pdf ? 'Open the receipt PDF' : 'Open the receipt'}
                    </span>
                    {!pdf && (
                        <span className="block text-[11.5px] text-sw-dim">
                            The image could not be shown here
                        </span>
                    )}
                </span>
            </a>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setActualSize(false);
                    setOpen(true);
                }}
                aria-label="View the receipt full size"
                className={`group relative block overflow-hidden rounded-sw-card bg-sw-sunk shadow-[0_0_0_1px_var(--sw-line)] cursor-zoom-in focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${THUMB_CLASS[variant]} ${className}`.trim()}
            >
                <img
                    src={url}
                    alt="Receipt"
                    onError={() => setFailed(true)}
                    className="w-full h-full object-cover object-top"
                />
                <span className="absolute inset-0 flex items-end justify-end p-1.5 bg-gradient-to-t from-black/45 to-transparent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                    <MagnifyingGlassPlus size={16} className="text-white" />
                </span>
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Receipt"
                    className="fixed inset-0 z-[60] bg-black/85"
                >
                    <div
                        className="absolute inset-0 overflow-auto flex items-start justify-center p-4 sm:p-8"
                        onClick={() => setOpen(false)}
                    >
                        <img
                            src={url}
                            alt="Receipt"
                            onClick={(event) => {
                                event.stopPropagation();
                                setActualSize((previous) => !previous);
                            }}
                            className={
                                actualSize
                                    ? 'max-w-none cursor-zoom-out'
                                    : 'max-w-full max-h-full object-contain cursor-zoom-in'
                            }
                        />
                    </div>

                    <div className="absolute top-0 inset-x-0 flex items-center gap-2 p-3 pointer-events-none">
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/55 text-white text-[12.5px] no-underline hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
                        >
                            <ArrowSquareOut size={15} />
                            Open the original
                        </a>
                        <button
                            ref={closeRef}
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close the receipt"
                            className="pointer-events-auto ml-auto w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default ReceiptViewer;
