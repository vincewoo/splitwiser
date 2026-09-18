import React, { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { Avatar, Button, Money, Notice, Sheet } from './ui';
import PaymentAmountField from './PaymentAmountField';
import VenmoButton from './VenmoButton';
import {
    centsToInput,
    classifySettleAmount,
    settleAmountNote,
    settleHeading,
} from '../utils/settleAmount';
import { buildVenmoLinks, venmoUnavailableNote } from '../utils/venmo';

export interface SettleAmountSheetProps {
    /** The figure the plan suggests, in cents. The field starts from it. */
    outstanding: number;
    /** The debt's currency. Fixed: a settlement in another currency would not
     *  cancel it exactly, since the round trip through USD is not the identity. */
    currency: string;
    /** The two parties, by name. */
    payer: string;
    payee: string;
    /**
     * Which side the signed-in user is on. Null for a payment between two
     * other people, which a group member may still record on their behalf.
     */
    you: 'payer' | 'payee' | null;
    /** What the payment clears — the group's name, for the subtitle and memo. */
    groupName: string;
    /** The other party's Venmo handle, when there is one to hand off to. Only
     *  meaningful when `you` is set: a payment between two other people is not
     *  this user's to make. */
    venmoUsername?: string | null;
    onClose: () => void;
    /** Record the payment for this many cents. */
    onRecord: (cents: number) => void;
    busy?: boolean;
    error?: string | null;
}

/**
 * Recording a settle-up for other than the figure the plan suggested.
 *
 * The plan is a suggestion; what actually changed hands is what the ledger
 * should hold. Somebody who rounded $54.35 to $50, paid $40 of it for now, or
 * sent $60 to be safe has settled *something*, and locking "Mark as paid" to
 * the exact figure left them with nothing honest to record. The field starts
 * from the suggested amount so the common correction is a couple of digits,
 * and the line under it says what the figure typed would leave behind —
 * including the overpayment case, where the payer ends up owed the excess,
 * which is allowed because it is what happened.
 *
 * The currency is not editable here. The debt is quoted in the group's
 * currency because that is the only currency a payment cancels it in exactly.
 *
 * Mount this only while it is open: the field is seeded at mount, so a fresh
 * open always starts from the current figure.
 */
const SettleAmountSheet: React.FC<SettleAmountSheetProps> = ({
    outstanding,
    currency,
    payer,
    payee,
    you,
    groupName,
    venmoUsername = null,
    onClose,
    onRecord,
    busy = false,
    error = null,
}) => {
    const [entry, setEntry] = useState(() => centsToInput(outstanding));

    const ctx = { currency, payer, payee, you };
    const status = classifySettleAmount(entry, outstanding);
    const cents = status.kind === 'empty' ? null : status.cents;
    const note = settleAmountNote(status, ctx);

    // The face on the sheet is whoever is not you; for somebody else's
    // payment, the one paying.
    const counterparty = you === 'payer' ? payee : payer;

    /**
     * The hand-off follows the typed figure, so "pay $40 with Venmo" and
     * "record $40" agree. Null until there is a figure to hand over, and
     * never for a payment the signed-in user is not party to.
     */
    const action = you === 'payer' ? 'pay' : 'request';
    const venmo =
        you && venmoUsername && cents
            ? buildVenmoLinks({
                  username: venmoUsername,
                  amountCents: cents,
                  currency,
                  action,
                  // Plain ASCII: this lands in a Venmo memo.
                  note: `Settling up: ${groupName}`,
              })
            : null;
    const venmoMissing =
        you && venmoUsername && cents && !venmo ? venmoUnavailableNote(currency) : null;

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (cents === null || busy) return;
        onRecord(cents);
    };

    return (
        <Sheet
            open
            onClose={onClose}
            label="Record a payment"
            title="Record a payment"
            className="lg:max-w-[420px] lg:rounded-b-sw-sheet lg:mb-6"
        >
            <form onSubmit={submit} className="flex flex-col gap-3.5">
                <div className="flex items-center gap-[11px]">
                    <Avatar
                        name={counterparty}
                        size={38}
                        variant={you === 'payee' ? 'accent' : 'neutral'}
                    />
                    <div className="flex-1 min-w-0">
                        <div className="text-[14.5px] font-medium truncate">
                            {settleHeading(ctx)}
                        </div>
                        <div className="text-xs text-sw-dim truncate">
                            {groupName} suggests{' '}
                            <Money amount={outstanding} currency={currency} />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <PaymentAmountField
                        value={entry}
                        onChange={setEntry}
                        currency={currency}
                        selectOnFocus
                        autoFocus
                    />
                    {/*
                      * Overpaying is worth a firmer tone than a partial: the
                      * payer comes out owed money, which the group will see.
                      */}
                    {note && status.kind === 'over' ? (
                        <Notice tone="info">{note}</Notice>
                    ) : (
                        <p className="text-[11.5px] text-sw-dim min-h-[1.25em]">
                            {note ?? 'Enter how much was actually paid.'}
                        </p>
                    )}
                </div>

                {error && <Notice tone="error">{error}</Notice>}

                <div className="flex gap-2">
                    {venmo && (
                        <VenmoButton
                            links={venmo}
                            action={action}
                            counterparty={counterparty}
                            className="min-h-[46px] flex-1"
                        />
                    )}
                    <Button
                        type="submit"
                        variant="primary"
                        block={!venmo}
                        icon={<Check size={15} />}
                        disabled={cents === null || busy}
                        className="min-h-[46px] flex-1"
                    >
                        {busy ? 'Recording…' : 'Record'}
                    </Button>
                </div>

                {/*
                  * Opening Venmo is not proof of payment — recording stays a
                  * separate, deliberate tap, as on every other settle surface.
                  */}
                {venmo && (
                    <p className="text-[11.5px] text-sw-dim">
                        Venmo opens with this amount filled in. Recording is what
                        changes the balance here.
                    </p>
                )}
                {venmoMissing && (
                    <p className="text-[11.5px] text-sw-dim">{venmoMissing}</p>
                )}
            </form>
        </Sheet>
    );
};

export default SettleAmountSheet;
