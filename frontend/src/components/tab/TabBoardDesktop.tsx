import React, { useState } from 'react';
import {
    PencilSimple,
    Plus,
    QrCode as QrCodeIcon,
    Receipt,
    Trash,
} from '@phosphor-icons/react';
import { Button, Money, TagPill } from '../ui';
import ReceiptViewer from '../ReceiptViewer';
import ReceiptPaper from './ReceiptPaper';
import TabProgress from './TabProgress';
import TabMatrix from './TabMatrix';
import TabBreakdown from './TabBreakdown';
import { payerParticipantId } from '../../utils/tabShares';
import type { Tab } from '../../types/tab';

export interface TabBoardDesktopProps {
    tab: Tab;
    /** The viewer's participant id — they are a participant like anyone else. */
    meId?: number | null;
    shares: Record<number, number>;
    claimed: number;
    unclaimed: number;
    /** Claimed plus unclaimed lines — the bill without tax and tip. */
    itemsTotal: number;
    error: string | null;
    onToggleClaim: (itemId: number, participantId: number, claimed: boolean) => void;
    onAddItem: (description: string, cents: number) => void;
    onDeleteItem: (itemId: number) => void;
    onShowQr: () => void;
    /** Opens the tax-and-tip sheet: the scan is a starting point, not a verdict. */
    onEditAmounts: () => void;
    onClose: () => void;
    /** The seat that fronted the bill — not always the host, and not always an account. */
    payerId?: number | null;
    /** Opens the who-paid sheet. Omitted where the payer is not editable. */
    onEditPayer?: () => void;
    /** Tick somebody off as settled. See TabBreakdown for why this is a callback. */
    onTogglePaid?: (participantId: number, paid: boolean) => void;
}

/** Friday · $212.35 · link live for 5 more days */
function caption(tab: Tab, expiresAt: string | null | undefined): string | null {
    if (tab.status !== 'open') return 'Closed — this landed in everyone’s balances.';
    if (!expiresAt) return null;

    const days = Math.ceil(
        (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (days <= 0) return 'The link has expired';
    return `Link live for ${days} more ${days === 1 ? 'day' : 'days'}`;
}

/**
 * The tab, with room for both axes at once.
 *
 * Two panes: the bill as it was printed, and every item against every person.
 * The phone has to ask "which lines are spare?" and "who is this line for?" one
 * at a time; here they are the same picture, so hovering a row in the grid
 * lights the same line on the paper.
 */
const TabBoardDesktop: React.FC<TabBoardDesktopProps> = ({
    tab,
    meId,
    shares,
    claimed,
    unclaimed,
    itemsTotal,
    error,
    onToggleClaim,
    onAddItem,
    onDeleteItem,
    onShowQr,
    onEditAmounts,
    onClose,
    payerId,
    onEditPayer,
    onTogglePaid,
}) => {
    const [hovered, setHovered] = useState<number | null>(null);
    const [adding, setAdding] = useState(false);
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');

    const open = tab.status === 'open';

    // Whoever the caller named, else the account on the closed expense — the
    // same fallback the phone layout and the server both use.
    const resolvedPayerId =
        payerId ?? payerParticipantId(tab.participants, tab.payer_id);
    const payerSeat = tab.participants.find((p) => p.id === resolvedPayerId) ?? null;
    const unclaimedIds = new Set(
        tab.items.filter((item) => item.claimed_by.length === 0).map((item) => item.id)
    );
    const manual = tab.items.filter((item) => item.added_manually);

    const submitItem = (event: React.FormEvent) => {
        event.preventDefault();
        const cents = Math.round(parseFloat(price || '0') * 100);
        if (!description.trim() || !Number.isFinite(cents) || cents <= 0) return;
        onAddItem(description.trim(), cents);
        setDescription('');
        setPrice('');
        setAdding(false);
    };

    const subtitle = caption(tab, tab.token_expires_at);

    return (
        <>
            <div className="flex items-center gap-[13px] px-[22px] py-[15px] border-b border-sw-line flex-none">
                <div className="w-[34px] h-[34px] rounded-[10px] bg-sw-raise flex items-center justify-center flex-none">
                    <Receipt size={18} className="text-sw-muted" />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-[9px]">
                        <h1 className="text-[18px] font-medium truncate">{tab.name}</h1>
                        <TagPill tone="outline">Tab · not a group</TagPill>
                    </div>
                    <div className="text-xs text-sw-dim">
                        {tab.participants.length}{' '}
                        {tab.participants.length === 1 ? 'person' : 'people'} here
                        {subtitle ? ` · ${subtitle}` : ''}
                    </div>
                </div>

                <div className="ml-auto flex items-center gap-2 flex-none">
                    {open && tab.share_token && (
                        <Button
                            variant="secondary"
                            icon={<QrCodeIcon size={15} />}
                            onClick={onShowQr}
                        >
                            Show QR
                        </Button>
                    )}
                    {open && (
                        <Button variant="primary" onClick={onClose}>
                            Close the tab
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-[330px_1fr]">
                {/* --------------------------------------------- the bill */}
                <div className="border-r border-sw-line bg-sw-sunk p-[18px] overflow-auto flex flex-col gap-3.5">
                    <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                        The receipt
                    </div>

                    {/*
                      * The paper below is printed from the tab's own lines, which
                      * is what you need to see which are spare — but it is the
                      * app's word for the bill. The photograph is the bill, so it
                      * sits above it, a thumbnail away from full size.
                      */}
                    {tab.receipt_image_path && (
                        <ReceiptViewer path={tab.receipt_image_path} variant="strip" />
                    )}

                    <ReceiptPaper
                        title={tab.name}
                        items={tab.items}
                        tax={tab.tax}
                        tip={tab.tip}
                        total={tab.total}
                        currency={tab.currency}
                        highlightItemId={hovered}
                        unclaimedItemIds={unclaimedIds}
                    />

                    {open && (
                        <button
                            type="button"
                            onClick={onEditAmounts}
                            className="flex items-center gap-2 p-2.5 rounded-sw-card text-[12.5px] text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <PencilSimple size={14} className="flex-none" />
                            Tax and tip
                            <span className="ml-auto flex items-center gap-1.5">
                                <Money amount={tab.tax} currency={tab.currency} tone="muted" />
                                <span className="text-sw-dim">·</span>
                                <Money amount={tab.tip} currency={tab.currency} tone="muted" />
                            </span>
                        </button>
                    )}

                    <TabProgress
                        claimed={claimed}
                        itemsTotal={itemsTotal}
                        unclaimed={unclaimed}
                        unclaimedCount={unclaimedIds.size}
                        currency={tab.currency}
                    />

                    {open &&
                        (adding ? (
                            <form
                                onSubmit={submitItem}
                                className="flex flex-col gap-2 p-3 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)]"
                            >
                                <input
                                    autoFocus
                                    value={description}
                                    onChange={(event) =>
                                        setDescription(event.target.value)
                                    }
                                    placeholder="Another round"
                                    aria-label="Item name"
                                    className="px-2.5 py-2 rounded-lg bg-sw-bg text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                />
                                <div className="flex gap-2">
                                    <input
                                        value={price}
                                        onChange={(event) => setPrice(event.target.value)}
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        aria-label="Price"
                                        className="sw-num flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-sw-bg text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                    />
                                    <Button
                                        variant="ghost"
                                        onClick={() => setAdding(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button type="submit" variant="primary">
                                        Add
                                    </Button>
                                </div>
                            </form>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setAdding(true)}
                                className="flex items-center justify-center gap-1.5 p-2.5 rounded-sw-card text-[12.5px] text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <Plus size={14} />
                                Add something the scan missed
                            </button>
                        ))}

                    {/*
                      * Only hand-added lines can be removed — deleting a scanned
                      * line would put the grid out of step with the paper next
                      * to it.
                      */}
                    {open && manual.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                                Added by hand
                            </div>
                            {manual.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 text-[12.5px] text-sw-muted"
                                >
                                    <span className="flex-1 truncate">
                                        {item.description}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteItem(item.id)}
                                        aria-label={`Remove ${item.description}`}
                                        className="text-sw-dim hover:text-sw-neg flex-none focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                    >
                                        <Trash size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ------------------------------------------- the matrix */}
                <div className="min-w-0 overflow-auto px-[22px] py-[18px]">
                    {error && (
                        <p className="text-[12.5px] text-sw-neg mb-3" role="alert">
                            {error}
                        </p>
                    )}

                    {tab.participants.length === 0 ? (
                        <p className="text-[13px] text-sw-dim">
                            Nobody has opened the link yet.
                        </p>
                    ) : (
                        <TabMatrix
                            items={tab.items}
                            participants={tab.participants}
                            currency={tab.currency}
                            meId={meId}
                            shares={shares}
                            claimed={claimed}
                            unclaimed={unclaimed}
                            editable={open}
                            onToggle={onToggleClaim}
                            onHoverItem={setHovered}
                        />
                    )}

                    {open && tab.participants.length > 0 && (
                        <p className="text-[11.5px] text-sw-dim mt-4">
                            Tick on someone&rsquo;s behalf if they&rsquo;ve left or
                            never opened the link — everything here is yours to
                            correct until you close the tab.
                        </p>
                    )}

                    {/*
                      * The grid's footer says what each person owes; this says
                      * why. Same numbers, one walk of the same items — it is
                      * the working, not a second opinion, and it is here rather
                      * than a click away because "why is mine that much?" is
                      * the question the host gets asked at the table.
                      */}
                    {tab.participants.length > 0 && (
                        <div className="mt-6 max-w-[560px]">
                            <div className="flex items-baseline gap-2 mb-2">
                                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                                    {open ? 'If you closed now' : 'What everyone owed'}
                                </div>
                                {/*
                                  * Who is owed. Worth saying out loud because
                                  * it is not always the host: somebody with no
                                  * account can front the bill, and then this is
                                  * the only place the table learns who to pay.
                                  */}
                                <div className="ml-auto flex items-baseline gap-2 text-[11.5px] text-sw-dim">
                                    <span className="truncate">
                                        {payerSeat
                                            ? payerSeat.id === meId
                                                ? 'You paid'
                                                : `${payerSeat.display_name} paid`
                                            : 'Nobody has said who paid'}
                                    </span>
                                    {open && onEditPayer && (
                                        <button
                                            type="button"
                                            onClick={onEditPayer}
                                            className="text-sw-accent hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 rounded"
                                        >
                                            {payerSeat ? 'Change' : 'Set'}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <TabBreakdown
                                items={tab.items}
                                participants={tab.participants}
                                currency={tab.currency}
                                tax={tab.tax}
                                tip={tab.tip}
                                meId={meId}
                                payerId={resolvedPayerId}
                                onTogglePaid={onTogglePaid}
                            />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default TabBoardDesktop;
