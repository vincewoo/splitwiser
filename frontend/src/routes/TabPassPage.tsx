import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CaretDown, CaretRight, Check, Plus } from '@phosphor-icons/react';
import { Avatar, Button, Money } from '../components/ui';
import { TabWorking } from '../components/tab/TabBreakdown';
import AlertDialog from '../components/AlertDialog';
import { useAuth } from '../AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { tabsApi } from '../services/api';
import {
    computeTabBreakdowns,
    toShareItems,
    unclaimedTotal,
} from '../utils/tabShares';
import type { Tab } from '../types/tab';

/** How often the picker re-reads. Only while nobody is mid-turn. */
const POLL_MS = 5000;

/**
 * How long a turn survives with nobody touching it.
 *
 * The phone goes face-up on the table when Maya finishes, and the next person
 * picks it up. Falling back to the picker is what stops their order landing on
 * her seat — so idle returns to "who's got the phone?", never out of the mode.
 */
const IDLE_MS = 45_000;

/**
 * Passing the host's phone round a table where nobody else has one.
 *
 * This is the claim screen with a seat picker on top, not the board with a
 * person dropdown. The board is the *host's* surface — share link, close
 * button, the whole signed-in app beneath it — and handing that to somebody is
 * wrong on both focus and privacy. So the route renders outside the shell:
 * nothing here leads into the account.
 *
 * That is not a lock. A browser always has a back gesture, and this makes no
 * attempt to be a kiosk; what it removes is every path that *invites* you into
 * the account while the phone is in somebody else's hands.
 */
const TabPassPage: React.FC = () => {
    const { tabId } = useParams<{ tabId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [tab, setTab] = useState<Tab | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /** Whose turn it is. Null is the picker. */
    const [activeId, setActiveId] = useState<number | null>(null);
    const [seating, setSeating] = useState(false);
    const [newName, setNewName] = useState('');
    const [busy, setBusy] = useState(false);
    const [showWorking, setShowWorking] = useState(false);
    const [confirmStop, setConfirmStop] = useState(false);

    usePageTitle(tab ? `${tab.name} — pass the phone` : 'Pass the phone');

    const id = tabId ? parseInt(tabId, 10) : undefined;

    const load = useCallback(async () => {
        if (id === undefined) return;
        try {
            setTab(await tabsApi.getById(id));
            setError(null);
        } catch {
            setError('Could not load this tab');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

    // Somebody at the table may still be claiming from their own phone, so the
    // picker stays fresh — but never mid-turn, where a poll landing between
    // taps would move the list under the person using it.
    useEffect(() => {
        if (!tab || tab.status !== 'open' || activeId !== null) return;
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') load();
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [tab, activeId, load]);

    // A tab closed from another device has nothing left to claim.
    useEffect(() => {
        if (tab && tab.status !== 'open') {
            navigate(`/tabs/${tab.id}`, { replace: true });
        }
    }, [tab, navigate]);

    // Hand the phone back to the picker when a turn goes quiet.
    useEffect(() => {
        if (activeId === null) return;
        let timer = 0;
        const reset = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setActiveId(null), IDLE_MS);
        };
        reset();
        window.addEventListener('pointerdown', reset);
        window.addEventListener('keydown', reset);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('pointerdown', reset);
            window.removeEventListener('keydown', reset);
        };
    }, [activeId]);

    const shareItems = useMemo(() => toShareItems(tab?.items ?? []), [tab]);

    const breakdowns = useMemo(
        () =>
            computeTabBreakdowns(
                shareItems,
                (tab?.participants ?? []).map((p) => p.id),
                tab?.tax ?? 0,
                tab?.tip ?? 0
            ),
        [shareItems, tab?.participants, tab?.tax, tab?.tip]
    );

    const outstanding = unclaimedTotal(shareItems);

    const active = (tab?.participants ?? []).find((p) => p.id === activeId) ?? null;

    const openTurn = (participantId: number) => {
        setActiveId(participantId);
        setShowWorking(false);
        setError(null);
    };

    /**
     * Tick a line for whoever is holding the phone.
     *
     * The host's own seat goes through the self-claim route, keeping the
     * existing line that they are a participant rather than an administrator
     * of themselves; everyone else's goes through the owner route.
     */
    const toggle = async (itemId: number, claimed: boolean) => {
        if (id === undefined || !active) return;
        setBusy(true);
        try {
            setTab(
                active.user_id === user?.id
                    ? await tabsApi.claimOwn(id, itemId, claimed)
                    : await tabsApi.setClaim(id, itemId, active.id, claimed)
            );
            setError(null);
        } catch {
            setError('Could not update that item');
        } finally {
            setBusy(false);
        }
    };

    const seatSomeone = async (event: React.FormEvent) => {
        event.preventDefault();
        const name = newName.trim();
        if (id === undefined || !name) return;
        setBusy(true);
        try {
            const updated: Tab = await tabsApi.addParticipant(id, name);
            setTab(updated);
            setNewName('');
            setSeating(false);
            setError(null);
            // Straight into their list: seating somebody is only ever a
            // prelude to handing them the phone.
            const seated = updated.participants.find(
                (p) => p.display_name.toLowerCase() === name.toLowerCase()
            );
            if (seated) openTurn(seated.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add that person');
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    if (!tab) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col items-center justify-center gap-3 px-8 text-center">
                <p className="text-sm text-sw-muted">{error ?? 'Tab not found'}</p>
                <Button variant="secondary" onClick={() => navigate('/activity')}>
                    Back
                </Button>
            </div>
        );
    }

    const stopDialog = (
        <AlertDialog
            isOpen={confirmStop}
            onClose={() => setConfirmStop(false)}
            onConfirm={() => navigate(`/tabs/${tab.id}`)}
            type="confirm"
            // Nothing is lost by stopping — a red warning would say otherwise.
            destructive={false}
            title="Stop passing it round?"
            message="Everything claimed so far is saved. You can start passing it again any time."
            confirmText="Stop"
            cancelText="Keep going"
        />
    );

    /* ------------------------------------------------------ one person's turn */
    if (active) {
        const breakdown = breakdowns[active.id];
        const participantsById = new Map(tab.participants.map((p) => [p.id, p]));
        // The host takes a turn like anyone else, and is addressed like one.
        const isMe = active.user_id === user?.id;
        const turnLabel = isMe ? 'Your turn' : `${active.display_name}’s turn`;
        const switchLabel = isMe
            ? 'Not you? Tap to switch'
            : `Not ${active.display_name}? Tap to switch`;
        const bitLabel = isMe ? 'Your bit' : `${active.display_name}’s bit`;

        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col">
                <div className="w-full max-w-[520px] mx-auto flex-1 flex flex-col min-h-0">
                    {/*
                      * The one failure mode of this mode is ticking items onto
                      * the wrong person, so the name is a band you cannot miss
                      * rather than a control you have to read.
                      */}
                    <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 flex-none">
                        <button
                            type="button"
                            onClick={() => setActiveId(null)}
                            className="w-full flex items-center gap-3 px-3.5 py-3 rounded-sw-card bg-sw-accent-ghost shadow-[0_0_0_1px_var(--sw-accent)] text-left focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <Avatar name={active.display_name} size={38} variant="accent" />
                            <span className="flex-1 min-w-0">
                                <span className="block text-[15px] font-semibold text-sw-accent truncate">
                                    {turnLabel}
                                </span>
                                <span className="block text-[11.5px] text-sw-accent/85">
                                    {switchLabel}
                                </span>
                            </span>
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-auto px-4 flex flex-col gap-2">
                        {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}

                        {tab.items.map((item) => {
                            const mine = item.claimed_by.includes(active.id);
                            const others = item.claimed_by
                                .filter((pid) => pid !== active.id)
                                .map((pid) => participantsById.get(pid)?.display_name)
                                .filter(Boolean) as string[];

                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => toggle(item.id, !mine)}
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
                                            {mine && others.length > 0 &&
                                                `Splitting with ${others.join(', ')}`}
                                            {mine && others.length === 0 &&
                                                (isMe ? 'All yours' : 'All theirs')}
                                            {!mine && others.length > 0 &&
                                                `${others.join(', ')} took this`}
                                            {!mine && others.length === 0 &&
                                                'Still going spare'}
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
                    </div>

                    <div
                        className="px-4 pt-3.5 bg-sw-sunk border-t border-sw-line flex-none"
                        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                    >
                        {showWorking && breakdown && (
                            <div className="mb-2.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] max-h-[40vh] overflow-auto">
                                <TabWorking
                                    breakdown={breakdown}
                                    currency={tab.currency}
                                    tax={tab.tax}
                                    tip={tab.tip}
                                    possessive={isMe ? 'Your' : `${active.display_name}’s`}
                                />
                            </div>
                        )}

                        <button
                            type="button"
                            aria-expanded={showWorking}
                            onClick={() => setShowWorking((shown) => !shown)}
                            className="w-full flex items-baseline gap-1.5 mb-2.5 rounded focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <span className="text-[13px] text-sw-muted">{bitLabel}</span>
                            <CaretDown
                                size={13}
                                className={`text-sw-dim self-center transition-transform ${
                                    showWorking ? 'rotate-180' : ''
                                }`}
                                aria-hidden="true"
                            />
                            <Money
                                amount={breakdown?.total ?? 0}
                                currency={tab.currency}
                                className="ml-auto text-2xl font-medium"
                            />
                        </button>

                        <Button
                            variant="primary"
                            block
                            onClick={() => setActiveId(null)}
                            className="min-h-[46px]"
                        >
                            Done — pass it on
                        </Button>
                    </div>
                </div>
                {stopDialog}
            </div>
        );
    }

    /* ------------------------------------------------------------- the picker */
    return (
        <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col">
            <div className="w-full max-w-[520px] mx-auto flex-1 flex flex-col min-h-0">
                <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-3.5 flex-none">
                    <div className="text-xs uppercase tracking-[0.08em] text-sw-dim">
                        {tab.name}
                    </div>
                    <h1 className="text-[21px] font-medium mt-1 tracking-[-0.01em]">
                        Who&rsquo;s got the phone?
                    </h1>

                    {/*
                      * The finish condition is the orphan count, not whether
                      * everyone has had a turn: an unclaimed line is what gets
                      * spread across the whole table at close.
                      */}
                    <div
                        className={`flex items-center gap-2 mt-2.5 px-3 py-2 rounded-[10px] text-[11.5px] ${
                            outstanding > 0
                                ? 'bg-sw-accent-ghost shadow-[inset_0_0_0_1px_var(--sw-accent)] text-sw-accent'
                                : 'bg-sw-pos-soft text-sw-pos'
                        }`}
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-current flex-none" />
                        {outstanding > 0 ? (
                            <>
                                <Money
                                    amount={outstanding}
                                    currency={tab.currency}
                                    tone="default"
                                />{' '}
                                still unclaimed
                            </>
                        ) : (
                            'Everything is claimed'
                        )}
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto px-4 flex flex-col gap-2">
                    {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}

                    {tab.participants.map((participant) => {
                        const picked = tab.items.some((item) =>
                            item.claimed_by.includes(participant.id)
                        );
                        const count = tab.items.filter((item) =>
                            item.claimed_by.includes(participant.id)
                        ).length;
                        const isMe = participant.user_id === user?.id;

                        return (
                            <button
                                key={participant.id}
                                type="button"
                                onClick={() => openTurn(participant.id)}
                                className="flex items-center gap-3 p-3.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <Avatar
                                    name={participant.display_name}
                                    size={34}
                                    variant={isMe ? 'accent' : 'neutral'}
                                />
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm truncate">
                                        {isMe ? 'You' : participant.display_name}
                                    </span>
                                    <span
                                        className={`block text-[11.5px] truncate ${
                                            picked ? 'text-sw-dim' : 'text-sw-accent'
                                        }`}
                                    >
                                        {picked
                                            ? `${count} ${count === 1 ? 'item' : 'items'}`
                                            : "Hasn't picked yet"}
                                    </span>
                                </span>
                                {picked ? (
                                    <Money
                                        amount={breakdowns[participant.id]?.total ?? 0}
                                        currency={tab.currency}
                                        className="text-sm flex-none"
                                    />
                                ) : (
                                    <span className="text-sm text-sw-dim flex-none">
                                        &mdash;
                                    </span>
                                )}
                                <CaretRight
                                    size={15}
                                    className="text-sw-dim flex-none"
                                    aria-hidden="true"
                                />
                            </button>
                        );
                    })}

                    {/*
                      * Half the table never opened the link, so seating them
                      * cannot be a detour — a first name, and straight into
                      * their list.
                      */}
                    {seating ? (
                        <form
                            onSubmit={seatSomeone}
                            className="flex flex-col gap-2 p-3 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)]"
                        >
                            <label
                                className="text-[11px] uppercase tracking-[0.09em] text-sw-dim"
                                htmlFor="seat-name"
                            >
                                Who else is here?
                            </label>
                            <input
                                id="seat-name"
                                autoFocus
                                value={newName}
                                onChange={(event) => setNewName(event.target.value)}
                                placeholder="Priya"
                                className="px-3 py-2.5 rounded-lg bg-sw-bg text-sw-text border border-sw-line placeholder:text-sw-dim focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            />
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setSeating(false);
                                        setNewName('');
                                        setError(null);
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={busy || !newName.trim()}
                                    className="flex-1"
                                >
                                    Seat them
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setSeating(true)}
                            className="flex items-center justify-center gap-1.5 p-3.5 rounded-sw-card text-[13px] text-sw-muted shadow-[inset_0_0_0_1px_var(--sw-line)] hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <Plus size={14} />
                            Someone else
                        </button>
                    )}
                </div>

                <div
                    className="px-4 pt-3 bg-sw-sunk border-t border-sw-line flex-none"
                    style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                >
                    {/*
                      * Deliberately not "Done": that is what ends a turn, one
                      * screen over, and somebody finishing their items must not
                      * drop the host back into their own account by reflex.
                      */}
                    <Button
                        variant="secondary"
                        block
                        onClick={() => setConfirmStop(true)}
                        className="min-h-[46px]"
                    >
                        Stop passing it round
                    </Button>
                </div>
            </div>
            {stopDialog}
        </div>
    );
};

export default TabPassPage;
