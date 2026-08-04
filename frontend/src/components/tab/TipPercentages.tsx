import React from 'react';

export interface TipPercentagesProps {
    /** What the percentages are taken on — the items, never the tax. */
    subtotal: number;
    /** The tip as it stands, in cents, so the matching button reads as chosen. */
    tip: number;
    onPick: (cents: number) => void;
}

/** The percentages worth one tap. Anything else is typed. */
const PERCENTAGES = [15, 18, 20];

/**
 * One-tap tips, shared by the two places a tab's tip is set: the sheet that
 * opens it and the sheet that corrects it afterwards.
 */
const TipPercentages: React.FC<TipPercentagesProps> = ({ subtotal, tip, onPick }) => (
    <div className="flex gap-2">
        {PERCENTAGES.map((percent) => {
            const cents = Math.round((subtotal * percent) / 100);
            const active = tip > 0 && cents === tip;
            return (
                <button
                    key={percent}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onPick(cents)}
                    className={`flex-1 py-2 rounded-sw-card text-[12.5px] border min-h-[38px] ${
                        active
                            ? 'bg-sw-accent-ghost border-sw-accent text-sw-accent'
                            : 'bg-sw-sunk border-sw-line text-sw-muted'
                    } focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2`}
                >
                    {percent}%
                </button>
            );
        })}
    </div>
);

export default TipPercentages;
