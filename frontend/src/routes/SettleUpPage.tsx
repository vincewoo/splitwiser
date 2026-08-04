import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CaretRight, Check, Lightning } from '@phosphor-icons/react';
import { Avatar, Button, Card, Money } from '../components/ui';
import VenmoButton from '../components/VenmoButton';
import { useAuth } from '../AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSettlement } from '../hooks/useSettlement';
import { api } from '../services/api';
import { formatDateForInput } from '../utils/formatters';
import { participantKey, partyName, settlementTotal } from '../utils/settlement';
import { buildVenmoLinks, venmoUnavailableNote } from '../utils/venmo';
import type { SettlementParty, SuggestedPayment } from '../utils/settlement';
import type { VenmoLinks } from '../utils/venmo';

/**
 * Settle up, with the simplification up front rather than behind a button.
 *
 * Each row is one payment inside one group, which is what the app can actually
 * record: a settlement is an expense, and an expense belongs to a group. The
 * merged per-person figures on the overview are for reading, not writing.
 */
const SettleUpPage: React.FC = () => {
    usePageTitle('Settle up');
    const navigate = useNavigate();
    const isDesktop = useIsDesktop();
    const { user } = useAuth();
    const { friends, refreshAll } = useAppData();
    const { counterparties, payments, directory, loading, reload } = useSettlement();

    const [recording, setRecording] = useState<string | null>(null);
    const [done, setDone] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    /**
     * Names come from the directory the debt simplification returns, which
     * covers everyone in the group. The friends list is only a fallback now —
     * before, a group member you had not befriended read as "Person 7".
     */
    const nameFor = useMemo(() => {
        const friendNames = new Map(friends.map((f) => [f.id, f.full_name]));
        return (party: SettlementParty) => partyName(directory, party, friendNames);
    }, [friends, directory]);

    /**
     * The Venmo hand-off for a payment, or null when we cannot offer one:
     * the other party is a guest with no account, has published no handle, or
     * the debt is not in dollars.
     */
    const venmoFor = useMemo(() => {
        const handles = new Map(
            friends.map((friend) => [friend.id, friend.venmo_username ?? null])
        );
        return (payment: SuggestedPayment): VenmoLinks | null => {
            if (payment.isGuest) return null;
            // Fellow group members are offered the hand-off too, whether or
            // not you have befriended them.
            const known = directory.get(
                participantKey(payment.groupId, payment.userId, false)
            );
            const username =
                known?.venmo_username ?? handles.get(payment.userId) ?? null;
            if (!username) return null;
            return buildVenmoLinks({
                username,
                amountCents: payment.amount,
                currency: payment.currency,
                // I owe them → pay. They owe me → ask.
                action: payment.iPay ? 'pay' : 'request',
                // Plain ASCII: this lands in a Venmo memo, and a middot only
                // arrives there as %C2%B7 noise.
                note: `Settling up: ${payment.groupName}`,
            });
        };
    }, [friends, directory]);

    const outstanding = payments.filter((p) => !done.has(p.key));
    const total = useMemo(() => settlementTotal(counterparties), [counterparties]);

    /**
     * Record a settlement the same way Simplify Debts does — an expense flagged
     * is_settlement, paid by the payer, with the payee carrying the full amount
     * so it cancels the existing debt.
     */
    const markPaid = async (payment: SuggestedPayment) => {
        // One side of every settlement is the signed-in user, so without an id
        // there is nothing to record. Guarded here so the payload stays fully
        // typed rather than smuggling an undefined into payer_id.
        if (!user?.id) return;

        setRecording(payment.key);
        setError(null);

        const payerId = payment.iPay ? user.id : payment.userId;
        const payerIsGuest = payment.iPay ? false : payment.isGuest;
        const payeeId = payment.iPay ? payment.userId : user.id;
        const payeeIsGuest = payment.iPay ? payment.isGuest : false;
        const other = nameFor(payment);

        try {
            const response = await api.expenses.create({
                description: payment.iPay
                    ? `Payment (You → ${other})`
                    : `Payment (${other} → You)`,
                amount: Math.round(payment.amount),
                currency: payment.currency,
                date: formatDateForInput(new Date()),
                group_id: payment.groupId,
                payer_id: payerId,
                payer_is_guest: payerIsGuest,
                split_type: 'EQUAL',
                icon: '🏦',
                notes: 'Recorded from Settle up',
                is_settlement: true,
                splits: [
                    {
                        user_id: payeeId,
                        is_guest: payeeIsGuest,
                        amount_owed: Math.round(payment.amount),
                    },
                ],
            });

            if (!response.ok) {
                setError('Could not record that payment. Please try again.');
                return;
            }

            setDone((prev) => new Set(prev).add(payment.key));
            await refreshAll();
            reload();
        } catch (err) {
            console.error('Failed to record settlement:', err);
            setError('Could not record that payment. Please try again.');
        } finally {
            setRecording(null);
        }
    };

    return (
        <>
            <div className="flex items-center gap-3 px-4 lg:px-[22px] py-4 border-b border-sw-line flex-none pt-[max(1rem,env(safe-area-inset-top))] lg:pt-4">
                {!isDesktop && (
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        aria-label="Back"
                        className="text-sw-muted flex-none"
                    >
                        <ArrowLeft size={21} />
                    </button>
                )}
                <div className="text-[17px] lg:text-[19px] font-medium">Settle up</div>
            </div>

            <div className="flex-1 overflow-auto px-4 lg:px-[22px] py-4 flex flex-col gap-4 max-w-3xl">
                {loading ? (
                    <p className="text-sm text-sw-dim py-8 text-center">Loading…</p>
                ) : outstanding.length === 0 ? (
                    <Card radius="lg" className="p-5 text-center">
                        <p className="text-[15px] font-medium mb-1">
                            {payments.length === 0
                                ? "You're all square"
                                : 'All settled'}
                        </p>
                        <p className="text-[12.5px] text-sw-muted">
                            {payments.length === 0
                                ? 'Nothing outstanding across your groups.'
                                : 'Every suggested payment has been recorded.'}
                        </p>
                    </Card>
                ) : (
                    <>
                        <Card radius="lg" tone="accent" className="p-4">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Lightning size={17} className="text-sw-accent" />
                                <div className="text-[15px] font-medium">
                                    {outstanding.length}{' '}
                                    {outstanding.length === 1 ? 'payment' : 'payments'} and
                                    you're done
                                </div>
                            </div>
                            <div className="text-[12.5px] text-sw-muted">
                                Collapsed to the fewest transfers across{' '}
                                {new Set(outstanding.map((p) => p.groupName)).size === 1
                                    ? outstanding[0].groupName
                                    : `${new Set(outstanding.map((p) => p.groupName)).size} groups`}
                                {total && total.amount !== 0 && (
                                    <>
                                        {' · net '}
                                        <Money
                                            amount={total.amount}
                                            currency={total.currency}
                                            sign="always"
                                            tone="auto"
                                        />
                                    </>
                                )}
                                .
                            </div>
                        </Card>

                        {error && (
                            <p className="text-[12.5px] text-sw-neg px-1">{error}</p>
                        )}

                        <div className="flex flex-col gap-[11px]">
                            {outstanding.map((payment) => {
                                const other = nameFor(payment);
                                return (
                                    <Card
                                        key={payment.key}
                                        radius="lg"
                                        className="p-[15px]"
                                    >
                                        <div className="flex items-center gap-[11px] mb-3">
                                            <Avatar
                                                name={other}
                                                size={38}
                                                variant={payment.iPay ? 'neutral' : 'accent'}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[14.5px] font-medium truncate">
                                                    {payment.iPay
                                                        ? `You pay ${other}`
                                                        : `${other} pays you`}
                                                </div>
                                                <div className="text-xs text-sw-dim truncate">
                                                    clears {payment.groupName}
                                                </div>
                                            </div>
                                            <Money
                                                amount={payment.amount}
                                                currency={payment.currency}
                                                tone={payment.iPay ? 'negative' : 'positive'}
                                                className="text-xl font-medium flex-none"
                                            />
                                        </div>
                                        {(() => {
                                            const venmo = venmoFor(payment);
                                            /*
                                             * Only currency is worth explaining. A
                                             * guest has no account to pay into, so
                                             * the dollars line would be a
                                             * non-sequitur there.
                                             */
                                            const missing =
                                                !venmo && !payment.isGuest
                                                    ? venmoUnavailableNote(
                                                          payment.currency
                                                      )
                                                    : null;
                                            return (
                                                <>
                                                    <div className="flex gap-2">
                                                        {venmo && (
                                                            <VenmoButton
                                                                links={venmo}
                                                                action={
                                                                    payment.iPay
                                                                        ? 'pay'
                                                                        : 'request'
                                                                }
                                                                counterparty={other}
                                                                className="min-h-[42px] flex-1"
                                                            />
                                                        )}
                                                        <Button
                                                            variant="primary"
                                                            block={!venmo}
                                                            icon={<Check size={15} />}
                                                            disabled={
                                                                recording === payment.key
                                                            }
                                                            onClick={() =>
                                                                markPaid(payment)
                                                            }
                                                            className="min-h-[42px] flex-1"
                                                        >
                                                            {recording === payment.key
                                                                ? 'Recording…'
                                                                : 'Mark as paid'}
                                                        </Button>
                                                    </div>

                                                    {/*
                                                      * Venmo opening is not proof of
                                                      * payment — we never learn whether
                                                      * it went through, so recording
                                                      * stays a separate, deliberate tap.
                                                      */}
                                                    {venmo && (
                                                        <p className="text-[11.5px] text-sw-dim mt-2">
                                                            Venmo opens with the amount
                                                            filled in. Come back and mark
                                                            it paid once it&rsquo;s sent.
                                                        </p>
                                                    )}

                                                    {missing && (
                                                        <p className="text-[11.5px] text-sw-dim mt-2">
                                                            {missing}
                                                        </p>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </Card>
                                );
                            })}
                        </div>
                    </>
                )}

                {counterparties.length > 0 && (
                    <div>
                        <div className="text-xs uppercase tracking-[0.08em] text-sw-dim mb-2">
                            Where you stand
                        </div>
                        {counterparties.map((counterparty) => {
                            const name = nameFor(counterparty);
                            const owesYou = counterparty.amount > 0;
                            return (
                                <button
                                    key={counterparty.key}
                                    type="button"
                                    onClick={() =>
                                        !counterparty.isGuest &&
                                        navigate(`/friends/${counterparty.userId}`)
                                    }
                                    className="w-full flex items-center gap-[11px] py-[11px] border-b border-sw-line text-left hover:bg-sw-surface focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                >
                                    <Avatar name={name} size={34} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm truncate">{name}</div>
                                        <div className="text-[11.5px] text-sw-dim">
                                            {owesYou ? 'owes you' : 'you owe'}
                                            {counterparty.currency !== 'USD' &&
                                                ` · ${counterparty.currency}`}
                                        </div>
                                    </div>
                                    <Money
                                        amount={Math.abs(counterparty.amount)}
                                        currency={counterparty.currency}
                                        tone={owesYou ? 'positive' : 'negative'}
                                        className="text-sm flex-none"
                                    />
                                    <CaretRight size={16} className="text-sw-dim flex-none" />
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
};

export default SettleUpPage;
