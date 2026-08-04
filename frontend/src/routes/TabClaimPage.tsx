import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CaretDown, Check, Percent, PencilSimple } from '@phosphor-icons/react';
import { Button, Money } from '../components/ui';
import VenmoButton from '../components/VenmoButton';
import { TabWorking } from '../components/tab/TabBreakdown';
import { useAuth } from '../AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { computeTabBreakdowns, toShareItems } from '../utils/tabShares';
import { publicTabsApi } from '../services/api';
import { buildVenmoLinks, venmoUnavailableNote } from '../utils/venmo';
import type { PublicTab, TabIdentityResponse, TabJoinResponse } from '../types/tab';

/**
 * Where the claim token lives. The person has no account, so this is the only
 * thing that lets them come back and change their mind — losing it would strand
 * their claims under a name they can no longer edit.
 */
const storageKey = (shareToken: string) => `sw.tab.${shareToken}`;

interface StoredIdentity {
    claimToken: string;
    participantId: number;
    displayName: string;
}

function loadIdentity(shareToken: string): StoredIdentity | null {
    try {
        const raw = localStorage.getItem(storageKey(shareToken));
        return raw ? (JSON.parse(raw) as StoredIdentity) : null;
    } catch {
        return null;
    }
}

function saveIdentity(shareToken: string, identity: StoredIdentity) {
    try {
        localStorage.setItem(storageKey(shareToken), JSON.stringify(identity));
    } catch {
        // A private-mode browser can refuse; claiming still works for this
        // session, it just will not survive a reload.
    }
}

/**
 * The guest side of a tab: a name, some taps, no signup.
 *
 * Rendered outside the app shell and without auth — the share token is the
 * only credential, and most people opening this will never have an account.
 * Somebody who does have one is recognised anyway: their seat carries their
 * account, so closing the tab puts the bill in their balances and on the
 * payer's person page instead of leaving a guest line to chase.
 */
const TabClaimPage: React.FC = () => {
    const { shareToken = '' } = useParams<{ shareToken: string }>();
    const { user, loading: authLoading } = useAuth();

    const [tab, setTab] = useState<PublicTab | null>(null);
    const [identity, setIdentity] = useState<StoredIdentity | null>(null);
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [seating, setSeating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [showWorking, setShowWorking] = useState(false);
    // One shot: if seating this account fails — their name is already at the
    // table, say — fall back to the form rather than retrying on every poll.
    const seatingAttempted = useRef(false);

    usePageTitle(tab ? `${tab.name} — what did you have?` : 'Claim your items');

    const load = useCallback(async () => {
        try {
            setTab(await publicTabsApi.get(shareToken));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'This link is not valid');
        } finally {
            setLoading(false);
        }
    }, [shareToken]);

    useEffect(() => {
        setIdentity(loadIdentity(shareToken));
        load();
    }, [shareToken, load]);

    // Other people are claiming at the same table; keep the board fresh.
    useEffect(() => {
        if (!tab || tab.status !== 'open') return;
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, [tab, load]);

    /**
     * Seat a signed-in visitor as themselves, without asking.
     *
     * They already told us who they are by being logged in, and the account on
     * the seat is what makes their share a real debt at close rather than a
     * guest line. If they have been claiming anonymously on this device, the
     * seat they are using is adopted so their picks come with them.
     */
    useEffect(() => {
        if (authLoading || !user || !tab || tab.status !== 'open') return;
        if (seatingAttempted.current) return;

        const seat = identity
            ? tab.participants.find((p) => p.id === identity.participantId)
            : undefined;
        if (seat?.user_id === user.id) return; // Already sitting here as me.

        seatingAttempted.current = true;
        const claimToken =
            seat && seat.user_id === null ? identity?.claimToken : undefined;

        (async () => {
            setSeating(true);
            try {
                const result: TabJoinResponse = await publicTabsApi.join(shareToken, {
                    claimToken,
                    withAuth: true,
                });
                const next = {
                    claimToken: result.claim_token,
                    participantId: result.participant.id,
                    displayName: result.participant.display_name,
                };
                saveIdentity(shareToken, next);
                setIdentity(next);
                setTab(result.tab);
            } catch (err) {
                // Usually their account name is already at the table. The name
                // form below takes it from here, and joining from it still
                // carries the account.
                setError(err instanceof Error ? err.message : 'Could not join');
            } finally {
                setSeating(false);
            }
        })();
    }, [authLoading, user, tab, identity, shareToken]);

    const shareItems = useMemo(() => toShareItems(tab?.items ?? []), [tab]);

    /**
     * Your own total, itemised, recomputed on every tap.
     *
     * The bare figure was the whole answer while the screen was just a row of
     * checkboxes, but it cannot show the two things people actually query: the
     * share of a line they split with someone, and the tax and tip that landed
     * on top without ever being ticked.
     */
    const myBreakdown = useMemo(() => {
        if (!tab || !identity) return null;
        const breakdowns = computeTabBreakdowns(
            shareItems,
            tab.participants.map((p) => p.id),
            tab.tax,
            tab.tip
        );
        return breakdowns[identity.participantId] ?? null;
    }, [tab, identity, shareItems]);

    const myShare = myBreakdown?.total ?? 0;

    /**
     * Pay the host, right here.
     *
     * This is the surface where the hand-off earns the most: the people at a
     * tab often owe somebody they have only just met, with no shared group, no
     * friendship and no other way to send the money. Everywhere else in the app
     * a debt eventually resolves through balances — here the link is all there
     * is, so an amount typed by hand is an amount typed wrong.
     *
     * The host is whoever fronted the bill, never another claimer.
     */
    const venmo = useMemo(() => {
        if (!tab?.host_venmo_username || myShare <= 0) return null;
        return buildVenmoLinks({
            username: tab.host_venmo_username,
            amountCents: myShare,
            currency: tab.currency,
            // The claimer always owes the host, never the other way round.
            action: 'pay',
            note: tab.name,
        });
    }, [tab, myShare]);

    /** Explained only once there is a share to pay and a host to pay it to. */
    const venmoMissing =
        tab?.host_venmo_username && !venmo && myShare > 0
            ? venmoUnavailableNote(tab.currency)
            : null;

    /**
     * Take a name — for the first time, or instead of the one already held.
     *
     * Renaming goes to a different endpoint on purpose. Joining again would
     * seat a second person with the same face, and every item ticked so far
     * would stay behind on the abandoned row: the tab would owe money to a
     * name nobody at the table answers to.
     */
    const handleName = async (event: React.FormEvent) => {
        event.preventDefault();
        const wanted = name.trim();
        if (!wanted) return;
        setBusy(true);
        setError(null);
        try {
            if (identity) {
                const result: TabIdentityResponse = await publicTabsApi.rename(
                    shareToken,
                    identity.claimToken,
                    wanted
                );
                const next = {
                    ...identity,
                    displayName: result.participant.display_name,
                };
                saveIdentity(shareToken, next);
                setIdentity(next);
                setTab(result.tab);
            } else {
                const result: TabJoinResponse = await publicTabsApi.join(
                    shareToken,
                    // Signed in but typing a name — because the account's name
                    // was taken, usually. The seat is still theirs.
                    { displayName: wanted, withAuth: Boolean(user) }
                );
                const next = {
                    claimToken: result.claim_token,
                    participantId: result.participant.id,
                    displayName: result.participant.display_name,
                };
                saveIdentity(shareToken, next);
                setIdentity(next);
                setTab(result.tab);
            }
            setRenaming(false);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : identity
                      ? 'Could not change your name'
                      : 'Could not join'
            );
        } finally {
            setBusy(false);
        }
    };

    const toggleItem = async (itemId: number, claimed: boolean) => {
        if (!identity) return;
        setBusy(true);
        try {
            setTab(
                await publicTabsApi.claim(
                    shareToken,
                    itemId,
                    identity.claimToken,
                    claimed
                )
            );
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update that');
        } finally {
            setBusy(false);
        }
    };

    // Seating a signed-in visitor counts as loading: flashing the name form at
    // someone who is about to be recognised would ask a question we can answer.
    if (loading || authLoading || seating) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    if (!tab) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col items-center justify-center gap-2 px-8 text-center">
                <p className="text-[17px] font-medium">This link isn't working</p>
                <p className="text-[13px] text-sw-muted">
                    {error ?? 'It may have expired, or the tab is already closed.'}
                </p>
            </div>
        );
    }

    // Not joined yet: ask for a first name and nothing else. Same form does
    // the rename, but it renames the person already here rather than adding one.
    if (!identity || renaming) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col">
                <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-3.5">
                    <div className="text-xs uppercase tracking-[0.08em] text-sw-dim">
                        {tab.name}
                    </div>
                    <h1 className="text-[21px] font-medium mt-1 tracking-[-0.01em]">
                        {identity
                            ? 'What should we call you?'
                            : 'Someone got the bill. What did you have?'}
                    </h1>
                </div>

                <form onSubmit={handleName} className="px-4 flex flex-col gap-3">
                    <label className="text-[13px] text-sw-muted" htmlFor="claim-name">
                        Your first name
                    </label>
                    <input
                        id="claim-name"
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Maya"
                        className="px-3 py-3 rounded-sw-card bg-sw-surface text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                    />
                    {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}
                    <Button
                        type="submit"
                        variant="primary"
                        block
                        disabled={busy || !name.trim()}
                        className="min-h-[46px]"
                    >
                        {busy
                            ? 'One moment…'
                            : identity
                              ? 'Save this name'
                              : 'Start claiming'}
                    </Button>
                    {identity ? (
                        <>
                            <Button
                                type="button"
                                variant="secondary"
                                block
                                disabled={busy}
                                onClick={() => {
                                    setRenaming(false);
                                    setError(null);
                                }}
                                className="min-h-[46px]"
                            >
                                Never mind
                            </Button>
                            <p className="text-[11.5px] text-sw-dim text-center">
                                Your picks stay with you — this only changes the name
                                on them.
                            </p>
                        </>
                    ) : user ? (
                        <p className="text-[11.5px] text-sw-dim text-center">
                            This still goes on your account — the name is just what
                            the table sees.
                        </p>
                    ) : (
                        <p className="text-[11.5px] text-sw-dim text-center">
                            No account needed — just this bill, just once.
                        </p>
                    )}
                </form>
            </div>
        );
    }

    const participantsById = new Map(tab.participants.map((p) => [p.id, p]));

    // The server holds the name; what is in localStorage is a stale copy of it
    // as soon as the host renames someone from the board.
    const mySeat = participantsById.get(identity.participantId);
    const myName = mySeat?.display_name ?? identity.displayName;
    const onMyAccount = Boolean(user) && mySeat?.user_id === user?.id;

    return (
        <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col">
            <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-3.5 flex-none">
                <div className="text-xs uppercase tracking-[0.08em] text-sw-dim">
                    {tab.name}
                </div>
                <h1 className="text-[21px] font-medium mt-1 tracking-[-0.01em]">
                    What did you have?
                </h1>
            </div>

            <div className="px-4 pb-3.5 flex-none">
                <button
                    type="button"
                    onClick={() => {
                        setName(myName);
                        setError(null);
                        setRenaming(true);
                    }}
                    className="w-full flex items-center gap-[11px] px-3.5 py-3 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left"
                >
                    <span className="w-8 h-8 rounded-full bg-sw-accent-soft text-sw-accent flex items-center justify-center text-xs font-semibold flex-none">
                        {myName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm">
                            You're claiming as{' '}
                            <span className="font-medium">{myName}</span>
                        </span>
                        <span className="block text-[11.5px] text-sw-dim">
                            {onMyAccount
                                ? 'Goes on your account — tap to use a different name'
                                : 'No account needed — tap to use a different name'}
                        </span>
                    </span>
                    <PencilSimple size={16} className="text-sw-dim flex-none" />
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-4 flex flex-col gap-2">
                {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}

                {tab.items.map((item) => {
                    const mine = item.claimed_by.includes(identity.participantId);
                    const others = item.claimed_by
                        .filter((pid) => pid !== identity.participantId)
                        .map((pid) => participantsById.get(pid)?.display_name)
                        .filter(Boolean) as string[];

                    const yourBit = mine
                        ? Math.round(item.price / item.claimed_by.length)
                        : null;

                    return (
                        <button
                            key={item.id}
                            type="button"
                            disabled={busy || tab.status !== 'open'}
                            onClick={() => toggleItem(item.id, !mine)}
                            aria-pressed={mine}
                            className={`flex items-center gap-3 p-3 rounded-sw-card text-left disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${
                                mine
                                    ? 'bg-sw-accent-ghost shadow-[0_0_0_1px_var(--sw-accent)]'
                                    : 'bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)]'
                            }`}
                        >
                            <span
                                className={`w-[22px] h-[22px] rounded-[7px] flex items-center justify-center flex-none ${
                                    mine
                                        ? 'bg-sw-accent text-sw-on-accent'
                                        : 'shadow-[inset_0_0_0_1.5px_var(--sw-line)]'
                                }`}
                            >
                                {mine && <Check size={14} weight="bold" />}
                            </span>

                            <span className="flex-1 min-w-0">
                                <span className="block text-sm truncate">
                                    {item.description}
                                </span>
                                <span
                                    className={`block text-[11.5px] truncate ${
                                        mine ? 'text-sw-accent' : 'text-sw-dim'
                                    }`}
                                >
                                    {mine && others.length > 0 && (
                                        <>
                                            Splitting with {others.join(', ')} ·{' '}
                                            <Money
                                                amount={yourBit ?? 0}
                                                currency={tab.currency}
                                                tone="default"
                                            />{' '}
                                            you
                                        </>
                                    )}
                                    {mine && others.length === 0 && 'All yours'}
                                    {!mine && others.length > 0 &&
                                        `${others.join(', ')} took this`}
                                    {!mine && others.length === 0 && 'Still going spare'}
                                </span>
                            </span>

                            <Money
                                amount={item.price}
                                currency={tab.currency}
                                tone="muted"
                                className="text-[13.5px] flex-none"
                            />
                        </button>
                    );
                })}

                {(tab.tax > 0 || tab.tip > 0) && (
                    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-sw-card shadow-[inset_0_0_0_1px_var(--sw-line)] text-[13px] text-sw-muted">
                        <Percent size={16} className="flex-none" />
                        Tax and tip get added on, in proportion to what you ordered.
                    </div>
                )}
            </div>

            <div
                className="px-4 pt-3.5 bg-sw-sunk border-t border-sw-line flex-none"
                style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
                {/*
                  * The total, and — a tap away — how it got there. Folded shut
                  * by default: most taps are just another item, and the number
                  * moving is the only feedback wanted. It is worth opening when
                  * the number is not the one expected, which is exactly when
                  * having to ask the host would be worst.
                  */}
                {showWorking && myBreakdown && (
                    <div className="mb-2.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] max-h-[45vh] overflow-auto">
                        <TabWorking
                            breakdown={myBreakdown}
                            currency={tab.currency}
                            tax={tab.tax}
                            tip={tab.tip}
                            possessive="Your"
                        />
                    </div>
                )}

                <button
                    type="button"
                    aria-expanded={showWorking}
                    onClick={() => setShowWorking((shown) => !shown)}
                    className="w-full flex items-baseline gap-1.5 mb-2.5 focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 rounded"
                >
                    <span className="text-[13px] text-sw-muted">Your bit</span>
                    <CaretDown
                        size={13}
                        className={`text-sw-dim self-center transition-transform ${
                            showWorking ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                    />
                    <Money
                        amount={myShare}
                        currency={tab.currency}
                        className="ml-auto text-2xl font-medium"
                    />
                </button>

                {venmo && (
                    <VenmoButton
                        links={venmo}
                        action="pay"
                        counterparty={tab.host_name ?? undefined}
                        block
                        variant="primary"
                        className="min-h-[46px] mb-2.5"
                    />
                )}

                <p className="text-[11.5px] text-sw-dim text-center">
                    {venmo && tab.status === 'open' && (
                        /*
                          * Said before the reassurance below, because it is the
                          * one thing that costs money to get wrong: a share sent
                          * halfway through claiming is a share sent short.
                          */
                        <>
                            Tap everything you had first — the amount goes over as it
                            stands.{' '}
                        </>
                    )}
                    {venmo && tab.status === 'closed' && (
                        <>
                            Sends {tab.host_name ?? 'the host'} your share. Splitwiser
                            never sees the payment.{' '}
                        </>
                    )}
                    {venmoMissing && <>{venmoMissing} </>}
                    {tab.status === 'open'
                        ? 'Your picks save as you tap. Come back any time before the tab closes.'
                        : "This tab has been closed — that's your final share."}
                </p>
            </div>
        </div>
    );
};

export default TabClaimPage;
