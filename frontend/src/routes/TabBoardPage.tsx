import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    Check,
    DeviceMobile,
    PencilSimple,
    Plus,
    QrCode as QrCodeIcon,
    ShareNetwork,
    Trash,
    UsersThree,
} from '@phosphor-icons/react';
import { Avatar, Button, Card, Money, SegmentedControl, Sheet } from '../components/ui';
import ReceiptViewer from '../components/ReceiptViewer';
import ClaimerStack from '../components/tab/ClaimerStack';
import TabBoardDesktop from '../components/tab/TabBoardDesktop';
import TabBreakdown from '../components/tab/TabBreakdown';
import QrCode from '../components/tab/QrCode';
import TabAmountsSheet from '../components/tab/TabAmountsSheet';
import WhoPaidSheet from '../components/tab/WhoPaidSheet';
import { useAuth } from '../AuthContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { usePageTitle } from '../hooks/usePageTitle';
import { tabsApi } from '../services/api';
import {
    claimedTotal,
    computeTabShares,
    payerParticipantId,
    toShareItems,
    unclaimedTotal,
} from '../utils/tabShares';
import type { Tab, TabItem } from '../types/tab';

/** How often the board re-reads while people are still claiming. */
const POLL_MS = 5000;

/**
 * The host's view of a live tab.
 *
 * The design's claim is that the host only ever looks at what nobody has
 * claimed, so unclaimed lines lead and everything settled is filed below.
 */
const TabBoardPage: React.FC = () => {
    const { tabId } = useParams<{ tabId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isDesktop = useIsDesktop();

    const [tab, setTab] = useState<Tab | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [newDescription, setNewDescription] = useState('');
    const [newPrice, setNewPrice] = useState('');
    const [copied, setCopied] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [collectOpen, setCollectOpen] = useState(false);
    const [amountsOpen, setAmountsOpen] = useState(false);
    const [whoPaidOpen, setWhoPaidOpen] = useState(false);
    const [savingAmounts, setSavingAmounts] = useState(false);
    const [amountsError, setAmountsError] = useState<string | null>(null);
    const [view, setView] = useState<'items' | 'people'>('items');

    usePageTitle(tab?.name ?? 'Tab');

    const id = tabId ? parseInt(tabId, 10) : undefined;

    const load = useCallback(
        async (showSpinner = false) => {
            if (id === undefined) return;
            if (showSpinner) setLoading(true);
            try {
                setTab(await tabsApi.getById(id));
                setError(null);
            } catch {
                setError('Could not load this tab');
            } finally {
                if (showSpinner) setLoading(false);
            }
        },
        [id]
    );

    useEffect(() => {
        load(true);
    }, [load]);

    // Claims arrive from other people's phones, so the board polls while open.
    useEffect(() => {
        if (!tab || tab.status !== 'open') return;
        const timer = setInterval(() => load(), POLL_MS);
        return () => clearInterval(timer);
    }, [tab, load]);

    const participantsById = useMemo(
        () => new Map((tab?.participants ?? []).map((p) => [p.id, p])),
        [tab]
    );

    const me = useMemo(
        () => (tab?.participants ?? []).find((p) => p.user_id === user?.id) ?? null,
        [tab, user?.id]
    );

    const shareItems = useMemo(() => toShareItems(tab?.items ?? []), [tab]);

    const unclaimed = (tab?.items ?? []).filter((i) => i.claimed_by.length === 0);
    const sorted = (tab?.items ?? []).filter((i) => i.claimed_by.length > 0);
    // The toggle is only drawn once somebody is at the table, so an empty tab
    // cannot be left stranded on a view with nothing in it.
    const showPeople = view === 'people' && (tab?.participants.length ?? 0) > 0;
    const spokenFor = claimedTotal(shareItems);
    const outstanding = unclaimedTotal(shareItems);
    // The counter measures the picking, and tax and tip are not pickable — they
    // are spread over whoever ends up on the lines. Counting them in the
    // denominator would leave a fully claimed tab short of 100%.
    const itemsTotal = spokenFor + outstanding;

    // What each person would owe if the tab closed right now. The server runs
    // the same computation at close, so this is a preview and not a guess.
    const shares = useMemo(
        () =>
            computeTabShares(
                shareItems,
                (tab?.participants ?? []).map((p) => p.id),
                tab?.tax ?? 0,
                tab?.tip ?? 0
            ),
        [shareItems, tab?.participants, tab?.tax, tab?.tip]
    );

    /**
     * The seat that fronted the bill.
     *
     * Named while the tab is open when it is not the host — a friend with no
     * Splitwiser account picks up the cheque and everybody owes them directly.
     * Falls back to the host's own seat, which is the usual case and what the
     * server assumes too.
     */
    const payerSeatId = useMemo(() => {
        if (tab?.payer_participant_id != null) return tab.payer_participant_id;
        return payerParticipantId(
            tab?.participants ?? [],
            tab?.payer_id ?? tab?.created_by_id ?? null
        );
    }, [tab]);

    const payerSeat = payerSeatId != null ? participantsById.get(payerSeatId) : undefined;
    /** True once the bill is on somebody Splitwiser has never heard of. */
    const offAppPayer = Boolean(payerSeat && payerSeat.user_id === null);

    /** What is still owed to whoever paid, by everyone not yet ticked off. */
    const stillOwed = useMemo(
        () =>
            (tab?.participants ?? [])
                .filter((p) => p.id !== payerSeatId && !p.paid)
                .reduce((sum, p) => sum + (shares[p.id] ?? 0), 0),
        [tab, shares, payerSeatId]
    );
    const settledCount = (tab?.participants ?? []).filter(
        (p) => p.id !== payerSeatId && p.paid
    ).length;
    const owingCount = (tab?.participants ?? []).filter(
        (p) => p.id !== payerSeatId
    ).length;

    const setPayer = async (participantId: number | null) => {
        if (id === undefined) return;
        try {
            setTab(await tabsApi.setPayer(id, participantId));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not set who paid');
        }
    };

    const togglePaid = async (participantId: number, paid: boolean) => {
        if (id === undefined) return;
        try {
            setTab(await tabsApi.updateParticipant(id, participantId, { paid }));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save that');
        }
    };

    const setSeatVenmo = async (participantId: number, handle: string) => {
        if (id === undefined) return;
        try {
            setTab(
                await tabsApi.updateParticipant(id, participantId, {
                    venmo_username: handle,
                })
            );
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save that');
        }
    };

    const shareLink = tab?.share_token
        ? `${window.location.origin}/t/${tab.share_token}`
        : null;

    const handleShare = async () => {
        if (!shareLink || !tab) return;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: `${tab.name} — what did you have?`,
                    text: 'Claim what you ordered:',
                    url: shareLink,
                });
            } else {
                await navigator.clipboard.writeText(shareLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }
        } catch {
            // Dismissing the share sheet rejects; not worth surfacing.
        }
    };

    const handleAddItem = async (event: React.FormEvent) => {
        event.preventDefault();
        const cents = Math.round(parseFloat(newPrice || '0') * 100);
        if (!newDescription.trim() || !Number.isFinite(cents) || cents <= 0) return;

        await addItem(newDescription.trim(), cents);
        setNewDescription('');
        setNewPrice('');
        setAdding(false);
    };

    const toggleMine = async (itemId: number, claimed: boolean) => {
        if (id === undefined) return;
        try {
            setTab(await tabsApi.claimOwn(id, itemId, claimed));
            setError(null);
        } catch {
            setError('Could not update that item');
        }
    };

    /**
     * Tick any cell in the grid. Own claims go through the self-claim route so
     * the host is treated as a participant rather than an administrator of
     * themselves; everyone else's go through the owner route.
     */
    const setClaim = async (
        itemId: number,
        participantId: number,
        claimed: boolean
    ) => {
        if (id === undefined) return;
        try {
            setTab(
                participantId === me?.id
                    ? await tabsApi.claimOwn(id, itemId, claimed)
                    : await tabsApi.setClaim(id, itemId, participantId, claimed)
            );
            setError(null);
        } catch {
            setError('Could not update that item');
        }
    };

    const addItem = async (description: string, cents: number) => {
        if (id === undefined) return;
        try {
            setTab(await tabsApi.addItem(id, description, cents));
            setError(null);
        } catch {
            setError('Could not add that item');
        }
    };

    /**
     * Correct the tax or the tip. Everyone claiming from the link picks the
     * new figures up on their next poll, so a fix mid-meal reaches the table.
     */
    const saveAmounts = async (amounts: { tax: number; tip: number }) => {
        if (id === undefined) return;
        setSavingAmounts(true);
        setAmountsError(null);
        try {
            setTab(await tabsApi.updateAmounts(id, amounts));
            setAmountsOpen(false);
        } catch {
            setAmountsError('Could not save the tax and tip');
        } finally {
            setSavingAmounts(false);
        }
    };

    const handleDeleteItem = async (itemId: number) => {
        if (id === undefined) return;
        try {
            setTab(await tabsApi.deleteItem(id, itemId));
        } catch {
            setError('Could not remove that item');
        }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    if (!tab) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <p className="text-sm text-sw-muted">{error ?? 'Tab not found'}</p>
                <Button variant="secondary" onClick={() => navigate('/activity')}>
                    Back
                </Button>
            </div>
        );
    }

    /**
     * The link as something to point a phone at. Everyone is at the same table,
     * so a code on the host's screen beats sending four messages.
     */
    /**
     * How the others are claiming.
     *
     * Sending the link, showing a QR and passing the phone are different
     * mechanisms for one question — how do everyone's picks get in? — and the
     * answer depends on who at this table has a device on them. The header has
     * no room for three peer actions at 390px, so they share a sheet.
     */
    const collectSheet = (
        <Sheet
            open={collectOpen}
            onClose={() => setCollectOpen(false)}
            label="How are they claiming?"
            title="How are they claiming?"
            className="lg:max-w-[420px] lg:rounded-b-sw-sheet lg:mb-6"
        >
            <div className="flex flex-col gap-2">
                {shareLink && (
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                setCollectOpen(false);
                                handleShare();
                            }}
                            className="flex items-center gap-3 p-3.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <ShareNetwork size={18} className="text-sw-muted flex-none" />
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm">
                                    {copied ? 'Copied' : 'Send the link'}
                                </span>
                                <span className="block text-[11.5px] text-sw-dim">
                                    They claim on their own phones
                                </span>
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setCollectOpen(false);
                                setQrOpen(true);
                            }}
                            className="flex items-center gap-3 p-3.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <QrCodeIcon size={18} className="text-sw-muted flex-none" />
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm">Show a QR</span>
                                <span className="block text-[11.5px] text-sw-dim">
                                    Everyone&rsquo;s at the same table
                                </span>
                            </span>
                        </button>
                    </>
                )}

                <button
                    type="button"
                    onClick={() => navigate(`/tabs/${tab.id}/pass`)}
                    className="flex items-center gap-3 p-3.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                >
                    <DeviceMobile size={18} className="text-sw-muted flex-none" />
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm">Pass the phone round</span>
                        <span className="block text-[11.5px] text-sw-dim">
                            Nobody&rsquo;s got theirs on them
                        </span>
                    </span>
                </button>
            </div>
        </Sheet>
    );

    const qrSheet = shareLink && (
        <Sheet
            open={qrOpen}
            onClose={() => setQrOpen(false)}
            label="Tab link"
            title="Point a camera at this"
            className="lg:max-w-[420px] lg:rounded-b-sw-sheet lg:mb-6"
        >
            <div className="flex justify-center">
                <QrCode value={shareLink} size={224} />
            </div>
            <p className="text-[12.5px] text-sw-muted text-center break-all">
                {shareLink}
            </p>
            <Button variant="secondary" block onClick={handleShare}>
                {copied ? 'Copied' : 'Copy the link instead'}
            </Button>
        </Sheet>
    );

    const amountsSheet = amountsOpen && tab && (
        <TabAmountsSheet
            subtotal={itemsTotal}
            tax={tab.tax}
            tip={tab.tip}
            currency={tab.currency}
            onClose={() => setAmountsOpen(false)}
            onSave={saveAmounts}
            busy={savingAmounts}
            error={amountsError}
        />
    );

    const whoPaidSheet = tab && (
        <WhoPaidSheet
            open={whoPaidOpen}
            onClose={() => setWhoPaidOpen(false)}
            participants={tab.participants}
            payerId={payerSeatId}
            meId={me?.id ?? null}
            onSave={async (participantId, venmoUsername) => {
                await setPayer(participantId);
                if (venmoUsername !== undefined) {
                    await setSeatVenmo(participantId, venmoUsername);
                }
            }}
        />
    );

    if (isDesktop) {
        return (
            <>
                <TabBoardDesktop
                    tab={tab}
                    meId={me?.id ?? null}
                    shares={shares}
                    claimed={spokenFor}
                    unclaimed={outstanding}
                    itemsTotal={itemsTotal}
                    error={error}
                    onToggleClaim={setClaim}
                    onAddItem={addItem}
                    onDeleteItem={handleDeleteItem}
                    onShowQr={() => setQrOpen(true)}
                    onEditAmounts={() => setAmountsOpen(true)}
                    onClose={() => navigate(`/tabs/${tab.id}/close`)}
                    payerId={payerSeatId}
                    onEditPayer={() => setWhoPaidOpen(true)}
                    onTogglePaid={togglePaid}
                />
                {collectSheet}
                {qrSheet}
                {amountsSheet}
                {whoPaidSheet}
            </>
        );
    }

    const renderItem = (item: TabItem, orphan: boolean) => {
        const claimers = item.claimed_by
            .map((pid) => participantsById.get(pid))
            .filter((p): p is NonNullable<typeof p> => Boolean(p));

        const mine = me ? item.claimed_by.includes(me.id) : false;

        const names =
            claimers.length === 0
                ? null
                : claimers.length === tab.participants.length
                  ? 'Everyone'
                  : claimers
                        .map((p) => (p.id === me?.id ? 'You' : p.display_name))
                        .join(' and ');

        return (
            <div
                key={item.id}
                className={`flex items-center gap-[11px] p-3 rounded-sw-card ${
                    orphan
                        ? 'border border-dashed border-sw-accent bg-sw-accent-ghost'
                        : 'bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)]'
                }`}
            >
                <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{item.description}</div>
                    <div
                        className={`text-[11.5px] truncate ${
                            orphan ? 'text-sw-accent' : 'text-sw-dim'
                        }`}
                    >
                        {orphan ? "Nobody's grabbed this yet" : names}
                    </div>
                </div>

                {!orphan && (
                    <ClaimerStack
                        participants={claimers}
                        currentParticipantId={me?.id}
                    />
                )}

                <Money
                    amount={item.price}
                    currency={tab.currency}
                    tone="muted"
                    className="text-[13.5px] w-[62px] text-right flex-none"
                />

                {tab.status === 'open' && (
                    <button
                        type="button"
                        onClick={() => toggleMine(item.id, !mine)}
                        aria-pressed={mine}
                        aria-label={
                            mine
                                ? `Remove your claim on ${item.description}`
                                : `Claim ${item.description}`
                        }
                        className={`flex-none w-[22px] h-[22px] rounded-[7px] flex items-center justify-center ${
                            mine
                                ? 'bg-sw-accent text-sw-on-accent'
                                : 'shadow-[inset_0_0_0_1.5px_var(--sw-line)] hover:shadow-[inset_0_0_0_1.5px_var(--sw-accent)]'
                        } focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2`}
                    >
                        {mine && <Check size={14} weight="bold" />}
                    </button>
                )}

                {tab.status === 'open' && item.added_manually && (
                    <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id)}
                        aria-label={`Remove ${item.description}`}
                        className="text-sw-dim hover:text-sw-neg flex-none"
                    >
                        <Trash size={15} />
                    </button>
                )}
            </div>
        );
    };

    return (
        <>
            <div className="flex items-center gap-3 px-[18px] pb-3 pt-[max(1rem,env(safe-area-inset-top))] flex-none">
                <button
                    type="button"
                    onClick={() => navigate('/activity')}
                    aria-label="Back"
                    className="text-sw-muted flex-none"
                >
                    <ArrowLeft size={21} />
                </button>
                <div className="min-w-0">
                    <div className="text-base font-medium truncate">{tab.name}</div>
                    <div className="text-xs text-sw-dim flex items-center gap-1.5">
                        <span
                            className={`w-1.5 h-1.5 rounded-full ${
                                tab.status === 'open' ? 'bg-sw-pos' : 'bg-sw-dim'
                            }`}
                        />
                        {tab.status === 'open'
                            ? `${tab.participants.length} ${
                                  tab.participants.length === 1 ? 'person' : 'people'
                              } here now`
                            : 'Closed'}
                    </div>
                </div>
                {tab.status === 'open' && (
                    <div className="ml-auto flex-none">
                        <Button
                            variant="secondary"
                            onClick={() => setCollectOpen(true)}
                            icon={<UsersThree size={15} />}
                        >
                            Get picks
                        </Button>
                    </div>
                )}
            </div>

            <div className="px-4 pb-3.5 flex-none">
                <Card radius="lg" className="px-4 py-[15px]">
                    <div className="flex items-baseline gap-2 mb-2.5">
                        <Money
                            amount={spokenFor}
                            currency={tab.currency}
                            className="text-[25px] font-medium"
                        />
                        <span className="text-[13px] text-sw-muted">
                            of{' '}
                            <Money
                                amount={itemsTotal}
                                currency={tab.currency}
                                tone="muted"
                            />{' '}
                            in items spoken for
                        </span>
                    </div>

                    <div className="h-[7px] rounded bg-sw-sunk overflow-hidden mb-3">
                        <div
                            className="h-full rounded bg-sw-accent transition-[width] duration-300"
                            style={{
                                width: `${itemsTotal > 0 ? Math.round((spokenFor / itemsTotal) * 100) : 0}%`,
                            }}
                        />
                    </div>

                    <div className="flex gap-[7px] flex-wrap">
                        {tab.participants.map((participant) => {
                            const hasClaimed = tab.items.some((item) =>
                                item.claimed_by.includes(participant.id)
                            );
                            return (
                                <span
                                    key={participant.id}
                                    className={`flex items-center gap-1.5 pl-[5px] pr-[11px] py-[5px] rounded-full text-[12.5px] ${
                                        hasClaimed
                                            ? 'bg-sw-accent-ghost text-sw-accent shadow-[0_0_0_1px_var(--sw-accent)]'
                                            : 'bg-sw-surface text-sw-muted shadow-[0_0_0_1px_var(--sw-line)]'
                                    }`}
                                >
                                    <Avatar
                                        name={participant.display_name}
                                        size={21}
                                        variant={hasClaimed ? 'accent' : 'neutral'}
                                    />
                                    {participant.id === me?.id
                                        ? 'You'
                                        : participant.display_name}
                                    {!hasClaimed && (
                                        <span className="text-[11px] text-sw-dim">
                                            picking…
                                        </span>
                                    )}
                                </span>
                            );
                        })}
                    </div>
                </Card>
            </div>

            {/*
              * Items, or what everyone owes. A phone cannot hold both at once,
              * and the answer to "what do I owe?" used to live behind the close
              * flow — a button that reads like a commitment — so it is a toggle
              * here rather than a screen further in.
              */}
            {tab.participants.length > 0 && (
                <div className="px-4 pb-3 flex-none">
                    <SegmentedControl
                        label="What to show"
                        fill
                        value={view}
                        onChange={setView}
                        options={[
                            { value: 'items', label: 'Items' },
                            {
                                value: 'people',
                                label:
                                    tab.status === 'open'
                                        ? 'Who owes what'
                                        : 'What was owed',
                            },
                        ]}
                    />
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 flex flex-col gap-2">
                {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}

                {showPeople && (
                    <>
                        {tab.status === 'open' && outstanding > 0 && (
                            <p className="text-[11.5px] text-sw-accent pb-1">
                                <Money
                                    amount={outstanding}
                                    currency={tab.currency}
                                    tone="default"
                                />{' '}
                                is still nobody&rsquo;s — these totals already
                                spread it across everyone.
                            </p>
                        )}

                        {/*
                          * Who is owed, and how much is still out. Both matter
                          * most in the case this was built for: somebody with
                          * no account paid, everyone settles with them
                          * directly, and the only record of who has is here.
                          */}
                        <Card radius="lg" className="px-[15px] py-3 mb-1">
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13px] truncate">
                                        {payerSeat
                                            ? payerSeat.id === me?.id
                                                ? 'You paid the bill'
                                                : `${payerSeat.display_name} paid the bill`
                                            : 'Nobody has said who paid'}
                                    </div>
                                    <div className="text-[11.5px] text-sw-dim">
                                        {owingCount === 0 ? (
                                            'Nobody else at the table yet'
                                        ) : stillOwed > 0 ? (
                                            <>
                                                <Money
                                                    amount={stillOwed}
                                                    currency={tab.currency}
                                                    tone="muted"
                                                />{' '}
                                                still to come from{' '}
                                                {owingCount - settledCount} of{' '}
                                                {owingCount}
                                            </>
                                        ) : (
                                            'Everyone has settled up'
                                        )}
                                    </div>
                                </div>
                                {tab.status === 'open' && (
                                    <Button
                                        variant="secondary"
                                        onClick={() => setWhoPaidOpen(true)}
                                        className="flex-none text-[12.5px]"
                                    >
                                        {payerSeat ? 'Change' : 'Set'}
                                    </Button>
                                )}
                            </div>

                            {offAppPayer && !payerSeat?.venmo_username && (
                                <p className="text-[11.5px] text-sw-dim mt-2">
                                    {payerSeat?.display_name} has no Splitwiser
                                    account. Add their Venmo and the claim page can
                                    send everyone straight to them.
                                </p>
                            )}
                        </Card>

                        <TabBreakdown
                            items={tab.items}
                            participants={tab.participants}
                            currency={tab.currency}
                            tax={tab.tax}
                            tip={tab.tip}
                            meId={me?.id ?? null}
                            payerId={payerSeatId}
                            onTogglePaid={togglePaid}
                        />
                    </>
                )}

                {!showPeople && unclaimed.length > 0 && (
                    <>
                        <div className="flex items-center gap-2 pb-1">
                            <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                                Needs a home
                            </div>
                            <div className="ml-auto text-[11.5px] text-sw-dim">
                                {unclaimed.length}{' '}
                                {unclaimed.length === 1 ? 'item' : 'items'} ·{' '}
                                <Money
                                    amount={outstanding}
                                    currency={tab.currency}
                                    tone="muted"
                                />
                            </div>
                        </div>
                        {unclaimed.map((item) => renderItem(item, true))}
                    </>
                )}

                {!showPeople && sorted.length > 0 && (
                    <>
                        <div className="pt-2.5 pb-1 text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                            Sorted
                        </div>
                        {sorted.map((item) => renderItem(item, false))}
                    </>
                )}

                {!showPeople && tab.status === 'open' && (
                    adding ? (
                        <form
                            onSubmit={handleAddItem}
                            className="flex flex-col gap-2 p-3 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)]"
                        >
                            <input
                                autoFocus
                                value={newDescription}
                                onChange={(e) => setNewDescription(e.target.value)}
                                placeholder="Another round"
                                aria-label="Item name"
                                className="px-2.5 py-2 rounded-lg bg-sw-bg text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            />
                            <div className="flex gap-2">
                                <input
                                    value={newPrice}
                                    onChange={(e) => setNewPrice(e.target.value)}
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    aria-label="Price"
                                    className="sw-num flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-sw-bg text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                />
                                <Button variant="ghost" onClick={() => setAdding(false)}>
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
                            className="flex items-center justify-center gap-1.5 p-3 rounded-sw-card text-[13px] text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <Plus size={14} />
                            Add something the scan missed
                        </button>
                    )
                )}

                {/*
                  * Tax and tip are not claimable lines, so they sit under the
                  * items rather than among them — visible, because the scan is
                  * a convenience and the person holding the bill can see what
                  * it really says.
                  */}
                {!showPeople && tab.status === 'open' && (
                    <button
                        type="button"
                        onClick={() => setAmountsOpen(true)}
                        className="flex items-center gap-2 p-3 rounded-sw-card text-[13px] text-sw-muted shadow-[0_0_0_1px_var(--sw-line)] hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                    >
                        <PencilSimple size={14} className="flex-none" />
                        Tax and tip
                        <span className="ml-auto flex items-center gap-1.5 text-sw-text">
                            <Money amount={tab.tax} currency={tab.currency} tone="muted" />
                            <span className="text-sw-dim">·</span>
                            <Money amount={tab.tip} currency={tab.currency} tone="muted" />
                        </span>
                    </button>
                )}

                {/*
                  * Last, with the other "is this right?" affordances: the lines
                  * above are what the scan read, and this is what it read them
                  * from. Settling an argument about a price is worth a tap.
                  */}
                {!showPeople && tab.receipt_image_path && (
                    <div className="flex items-center gap-3 pt-1">
                        <ReceiptViewer path={tab.receipt_image_path} />
                        <p className="text-[11.5px] text-sw-dim">
                            The bill as photographed. Tap it to read the small
                            print.
                        </p>
                    </div>
                )}
            </div>

            {tab.status === 'open' ? (
                <div className="px-4 pt-3 pb-3.5 bg-sw-sunk border-t border-sw-line flex-none">
                    <Button
                        variant="primary"
                        block
                        onClick={() => navigate(`/tabs/${tab.id}/close`)}
                        className="min-h-[46px]"
                    >
                        Close the tab
                    </Button>
                </div>
            ) : (
                <div className="px-4 pt-3 pb-3.5 bg-sw-sunk border-t border-sw-line flex-none text-center">
                    <p className="text-[12.5px] text-sw-muted">
                        Closed — this landed in your normal balances.
                    </p>
                </div>
            )}

            {collectSheet}
            {qrSheet}
            {amountsSheet}
            {whoPaidSheet}
        </>
    );
};

export default TabBoardPage;
