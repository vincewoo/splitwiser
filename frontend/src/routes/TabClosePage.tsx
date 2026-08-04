import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, UsersThree } from '@phosphor-icons/react';
import { Avatar, Button, Card, Money } from '../components/ui';
import TabBreakdown from '../components/tab/TabBreakdown';
import { useAuth } from '../AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { tabsApi } from '../services/api';
import { toShareItems, unclaimedTotal } from '../utils/tabShares';
import type { Tab } from '../types/tab';

/**
 * Closing a tab: resolve what nobody claimed, name the payer, show everyone
 * their number, then write it as one direct expense.
 */
const TabClosePage: React.FC = () => {
    usePageTitle('Close the tab');
    const { tabId } = useParams<{ tabId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { refreshAll } = useAppData();

    const [tab, setTab] = useState<Tab | null>(null);
    const [loading, setLoading] = useState(true);
    const [closing, setClosing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [payerId, setPayerId] = useState<number | null>(null);

    const id = tabId ? parseInt(tabId, 10) : undefined;

    useEffect(() => {
        if (id === undefined) return;
        let cancelled = false;
        tabsApi
            .getById(id)
            .then((data: Tab) => {
                if (cancelled) return;
                setTab(data);
                // Whoever was named on the board, else the person who opened
                // the tab. Naming happens there because the claim page needs
                // to know who to send people to long before anyone closes.
                const opener = data.participants.find(
                    (p) => p.user_id === data.created_by_id
                );
                setPayerId(data.payer_participant_id ?? opener?.id ?? null);
            })
            .catch(() => !cancelled && setError('Could not load this tab'))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [id]);

    const shareItems = useMemo(() => toShareItems(tab?.items ?? []), [tab]);

    /** The viewer's own seat, so their row in the breakdown reads "You". */
    const me = useMemo(
        () => (tab?.participants ?? []).find((p) => p.user_id === user?.id) ?? null,
        [tab, user?.id]
    );

    const orphans = (tab?.items ?? []).filter((i) => i.claimed_by.length === 0);
    const orphanTotal = unclaimedTotal(shareItems);
    const perHead =
        tab && tab.participants.length > 0
            ? Math.round(orphanTotal / tab.participants.length)
            : 0;

    const handleClose = async () => {
        if (id === undefined) return;
        setClosing(true);
        setError(null);
        try {
            await tabsApi.close(id, payerId);
            await refreshAll();
            navigate(`/tabs/${id}`);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Could not close the tab'
            );
        } finally {
            setClosing(false);
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

    const payer = tab.participants.find((p) => p.id === payerId) ?? null;
    /** Nobody in the app is owed, so closing records no expense. */
    const offAppPayer = Boolean(payer && payer.user_id === null);

    return (
        <>
            <div className="flex items-center gap-3 px-[18px] pb-3.5 pt-[max(1rem,env(safe-area-inset-top))] flex-none">
                <button
                    type="button"
                    onClick={() => navigate(`/tabs/${tab.id}`)}
                    aria-label="Back to the tab"
                    className="text-sw-muted flex-none"
                >
                    <ArrowLeft size={21} />
                </button>
                <div className="text-[17px] font-medium">Close the tab</div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 flex flex-col gap-4">
                {orphans.length > 0 && (
                    <Card radius="lg" className="px-4 py-[15px] shadow-[0_0_0_1px_var(--sw-accent)]">
                        <div className="text-[14.5px] font-medium mb-0.5">
                            {orphans.length}{' '}
                            {orphans.length === 1 ? 'thing' : 'things'} nobody claimed —{' '}
                            <Money amount={orphanTotal} currency={tab.currency} />
                        </div>
                        <div className="text-[12.5px] text-sw-muted mb-3">
                            {orphans.map((o) => o.description).join(', ')}.
                        </div>
                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[11px] bg-sw-accent-ghost shadow-[0_0_0_1px_var(--sw-accent)]">
                            <span className="w-[17px] h-[17px] rounded-full bg-sw-accent shadow-[inset_0_0_0_3.5px_var(--sw-bg)] flex-none" />
                            <span className="flex-1 text-[13.5px]">
                                Spread across the {tab.participants.length} of you
                            </span>
                            <Money
                                amount={perHead}
                                currency={tab.currency}
                                tone="muted"
                                className="text-[12.5px]"
                            />
                            <span className="text-[12.5px] text-sw-muted">each</span>
                        </div>
                        <p className="text-[11.5px] text-sw-dim mt-2">
                            Want them on someone in particular?{' '}
                            <button
                                type="button"
                                onClick={() => navigate(`/tabs/${tab.id}`)}
                                className="text-sw-accent hover:text-sw-text"
                            >
                                Go back and claim them
                            </button>
                            .
                        </p>
                    </Card>
                )}

                <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-sw-dim mb-2">
                        Who actually paid?
                    </div>
                    <div className="flex gap-[7px] flex-wrap">
                        {/*
                          * Everyone is eligible, including a seat with no
                          * account. That used to be barred on the grounds that
                          * only an account can carry a balance — true, but the
                          * conclusion was wrong: when the payer is not in the
                          * app there is no balance to carry, because everyone
                          * settles with them directly. The tab closes to a
                          * record instead. See the note under the picker.
                          */}
                        {tab.participants.map((participant) => {
                            const selected = participant.id === payerId;
                            return (
                                <button
                                    key={participant.id}
                                    type="button"
                                    onClick={() => setPayerId(participant.id)}
                                    className={`flex items-center gap-1.5 pl-1.5 pr-3 py-[7px] rounded-full text-[13px] ${
                                        selected
                                            ? 'bg-sw-accent-ghost text-sw-accent shadow-[0_0_0_1px_var(--sw-accent)]'
                                            : 'bg-sw-surface text-sw-muted shadow-[0_0_0_1px_var(--sw-line)]'
                                    }`}
                                >
                                    <Avatar
                                        name={participant.display_name}
                                        size={23}
                                        variant={selected ? 'accent' : 'neutral'}
                                    />
                                    {participant.user_id === user?.id
                                        ? 'You'
                                        : participant.display_name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-sw-dim mb-2">
                        {payer
                            ? `Everyone owes ${
                                  payer.user_id === user?.id ? 'you' : payer.display_name
                              }`
                            : 'Everyone owes'}
                    </div>
                    {/*
                      * Every row opens onto the lines behind it. This is the
                      * last screen before the money becomes real balances, so
                      * it is the last chance to notice that someone has been
                      * charged for a bottle they never claimed.
                      */}
                    <TabBreakdown
                        items={tab.items}
                        participants={tab.participants}
                        currency={tab.currency}
                        tax={tab.tax}
                        tip={tab.tip}
                        meId={me?.id ?? null}
                        payerId={payerId}
                    />
                </div>

                {/*
                  * Two quite different outcomes, so say which one this is
                  * before the button rather than after it.
                  */}
                <div className="flex items-start gap-2.5 px-3 py-3 rounded-sw-card shadow-[inset_0_0_0_1px_var(--sw-line)]">
                    <UsersThree size={17} className="text-sw-dim mt-0.5 flex-none" />
                    <p className="text-[12.5px] text-sw-muted leading-relaxed">
                        {offAppPayer ? (
                            <>
                                {payer?.display_name} isn&rsquo;t on Splitwiser, so
                                everyone settles with them directly and no balances
                                change. The tab stays as the record — keep ticking
                                people off as they pay.
                            </>
                        ) : (
                            <>
                                These land in your normal balances. Nothing new
                                appears under Groups.
                            </>
                        )}
                    </p>
                </div>

                {error && <p className="text-[12.5px] text-sw-neg">{error}</p>}
            </div>

            <div className="px-4 pt-3 pb-3.5 bg-sw-sunk border-t border-sw-line flex-none">
                <Button
                    variant="primary"
                    block
                    disabled={closing || !payer}
                    onClick={handleClose}
                    className="min-h-[46px]"
                >
                    {closing ? 'Closing…' : 'Close it and tell everyone'}
                </Button>
            </div>
        </>
    );
};

export default TabClosePage;
