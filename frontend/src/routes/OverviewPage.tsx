import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Handshake, Lightning } from '@phosphor-icons/react';
import {
    Avatar,
    Badge,
    Button,
    Card,
    Money,
    SegmentedControl,
    StatTile,
} from '../components/ui';
import PageHeader from './PageHeader';
import ExpenseFeedRow from '../components/ExpenseFeedRow';
import ExpenseDetailModal from '../ExpenseDetailModal';
import OpenTabsList from '../components/tab/OpenTabsList';
import VenmoButton from '../components/VenmoButton';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth } from '../AuthContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useShellActions } from '../layouts/shellActions';
import { usePageTitle } from '../hooks/usePageTitle';
import { useExpenseFeed } from '../hooks/useExpenseFeed';
import { useExpenseLabels } from '../hooks/useExpenseLabels';
import { useOpenExpense } from '../hooks/useOpenExpense';
import { useOpenTabs } from '../hooks/useOpenTabs';
import { useSettlement } from '../hooks/useSettlement';
import { netForGroup } from '../utils/groupBalances';
import { participantKey, partyName, settlementTotal } from '../utils/settlement';
import { buildVenmoLinks } from '../utils/venmo';
import type { Counterparty } from '../utils/settlement';
import type { VenmoLinks } from '../utils/venmo';

/** "Friday evening" — the greeting line above the mobile home header. */
function timeOfDayGreeting(now = new Date()): string {
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const hour = now.getHours();
    let part = 'evening';
    if (hour < 12) part = 'morning';
    else if (hour < 17) part = 'afternoon';
    return `${weekday} ${part}`;
}

/**
 * The landing screen, in both postures: the number first, then how to fix it.
 *
 * Two cards from the mockup are not built, because the API cannot answer them:
 *  - the "who owes who" matrix (needs full pairwise debts between every pair of
 *    members, not just the ones involving the current user)
 *  - "where the money went" (needs 30-day spend per group in one call)
 */
const OverviewPage: React.FC = () => {
    usePageTitle('Overview');
    const navigate = useNavigate();
    const { openAddExpense, openSettleUp, openProfile } = useShellActions();
    const isDesktop = useIsDesktop();
    const { user } = useAuth();
    const {
        groups,
        friends,
        balances,
        showInMyCurrency,
        setShowInMyCurrency,
        displayCurrency,
        pendingRequests,
    } = useAppData();
    const { expenses, loading, reload } = useExpenseFeed();
    const { payerName, groupName } = useExpenseLabels();
    const openExpense = useOpenExpense();
    const { openTabs } = useOpenTabs();

    const { counterparties, directory } = useSettlement();

    /**
     * Names come from the directory the debt simplification returns, which
     * covers everyone in your groups — guests included. The friends list is
     * only a fallback.
     */
    const nameFor = useMemo(() => {
        const names = new Map(friends.map((f) => [f.id, f.full_name]));
        return (counterparty: Counterparty) =>
            partyName(directory, counterparty, names);
    }, [friends, directory]);

    /**
     * The Venmo hand-off for a merged per-person figure, or null when there is
     * none to offer — a guest, nobody who has published a handle, or a debt in
     * a currency Venmo cannot send.
     *
     * The figure here is netted across groups, which is exactly what somebody
     * paying wants to hand over: one transfer, not one per group. Recording it
     * still has to happen per group, which is what Settle up is for.
     */
    const venmoFor = useMemo(() => {
        const handles = new Map(
            friends.map((friend) => [friend.id, friend.venmo_username ?? null])
        );
        return (counterparty: Counterparty): VenmoLinks | null => {
            if (counterparty.isGuest) return null;
            // Registered people key on their id alone, so a counterparty merged
            // across groups still resolves.
            const known = directory.get(
                participantKey(counterparty.groupId ?? 0, counterparty.userId, false)
            );
            const username =
                known?.venmo_username ?? handles.get(counterparty.userId) ?? null;
            if (!username) return null;
            return buildVenmoLinks({
                username,
                amountCents: Math.abs(counterparty.amount),
                currency: counterparty.currency,
                // Negative means I owe them.
                action: counterparty.amount < 0 ? 'pay' : 'request',
                note:
                    counterparty.groups.length === 1
                        ? `Settling up: ${counterparty.groups[0]}`
                        : 'Settling up',
            });
        };
    }, [friends, directory]);

    const owedBy = useMemo(
        () => counterparties.filter((c) => c.amount > 0),
        [counterparties]
    );
    const owedTo = useMemo(
        () => counterparties.filter((c) => c.amount < 0),
        [counterparties]
    );
    const owedTotal = useMemo(() => settlementTotal(owedBy), [owedBy]);
    const owingTotal = useMemo(() => settlementTotal(owedTo), [owedTo]);

    /**
     * A single net figure only means something once everything is in one
     * currency, which is what "in my currency" mode asks the server for.
     */
    const net = useMemo(() => {
        if (!showInMyCurrency) return null;
        return balances.reduce((total, b) => total + b.amount, 0);
    }, [balances, showInMyCurrency]);

    const groupRows = useMemo(
        () =>
            groups
                .map((group) => ({ group, net: netForGroup(balances, group.id) }))
                .sort((a, b) => {
                    const aMag = a.net ? Math.abs(a.net.amount) : 0;
                    const bMag = b.net ? Math.abs(b.net.amount) : 0;
                    if (aMag !== bMag) return bMag - aMag;
                    return a.group.name.localeCompare(b.group.name);
                })
                .slice(0, 3),
        [groups, balances]
    );

    // The desktop card sits in a full-height column beside the settlement list,
    // so it has room for more of the feed than the mobile section does.
    const recent = expenses.slice(0, isDesktop ? 8 : 4);

    const currencyToggle = (
        <SegmentedControl
            label="Balance currency"
            size={isDesktop ? 'md' : 'sm'}
            value={showInMyCurrency ? 'converted' : 'native'}
            onChange={(value) => setShowInMyCurrency(value === 'converted')}
            options={
                isDesktop
                    ? [
                          { value: 'native', label: 'Group currencies' },
                          { value: 'converted', label: `In ${displayCurrency}` },
                      ]
                    : [
                          { value: 'converted', label: displayCurrency },
                          { value: 'native', label: 'Per group' },
                      ]
            }
        />
    );

    /**
     * A tab has no page listing it and disappears from view the moment you
     * navigate away, so it gets its own card above the feed rather than a row
     * inside it. Hidden entirely when there are none.
     */
    const openTabsCard = openTabs.length > 0 && (
        <Card className="overflow-hidden">
            <div className="flex items-baseline gap-2.5 px-[18px] pt-3.5 pb-1.5">
                <div className="text-[15px] font-medium">Open tabs</div>
                <div className="ml-auto text-[12.5px] text-sw-dim">
                    {openTabs.length}
                </div>
            </div>
            <div className="px-2.5 pt-1 pb-3">
                <OpenTabsList tabs={openTabs} size="sm" />
            </div>
        </Card>
    );

    const latelyCard = (
        <Card className="overflow-hidden">
            <div className="flex items-baseline gap-2.5 px-[18px] pt-3.5 pb-1.5">
                <div className="text-[15px] font-medium">Lately</div>
                <button
                    type="button"
                    onClick={() => navigate('/activity')}
                    className="ml-auto text-[12.5px] text-sw-accent hover:text-sw-text"
                >
                    See all activity
                </button>
            </div>
            <div className="px-2 pt-1 pb-3">
                {loading ? (
                    <p className="text-sm text-sw-dim py-6 text-center">Loading…</p>
                ) : recent.length === 0 ? (
                    <p className="text-[12.5px] text-sw-dim py-6 text-center">
                        Nothing yet — add an expense to get started.
                    </p>
                ) : (
                    recent.map((expense) => (
                        <ExpenseFeedRow
                            key={expense.id}
                            size="sm"
                            expense={expense}
                            payerName={payerName}
                            groupName={groupName(expense)}
                            onClick={() => openExpense.open(expense)}
                        />
                    ))
                )}
            </div>
        </Card>
    );

    /**
     * "Clear it in N payments" — the simplified settlement, straight from the
     * per-group debt simplification.
     */
    const settleCard = counterparties.length > 0 && (
        <Card className="px-[18px] py-4">
            <div className="flex items-center gap-2">
                <Lightning size={16} className="text-sw-accent" />
                <div className="text-[15px] font-medium">
                    Clear it in {counterparties.length}{' '}
                    {counterparties.length === 1 ? 'payment' : 'payments'}
                </div>
            </div>
            <div className="text-[12.5px] text-sw-muted mt-1 mb-3">
                Simplified across your groups.
            </div>

            <div className="flex flex-col gap-2">
                {counterparties.map((counterparty) => {
                    const theyPayYou = counterparty.amount > 0;
                    const name = nameFor(counterparty);
                    const venmo = venmoFor(counterparty);

                    return (
                        <div
                            key={counterparty.key}
                            className="bg-sw-sunk rounded-sw-row px-[13px] py-3 flex items-center gap-[11px]"
                        >
                            <Avatar
                                name={theyPayYou ? name : (user?.full_name ?? 'You')}
                                size={28}
                                variant={theyPayYou ? 'accent' : 'neutral'}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] truncate">
                                    {theyPayYou ? (
                                        <>
                                            <span className="font-medium">{name}</span> pays you
                                        </>
                                    ) : (
                                        <>
                                            You pay <span className="font-medium">{name}</span>
                                        </>
                                    )}
                                </div>
                                <Money
                                    amount={Math.abs(counterparty.amount)}
                                    currency={counterparty.currency}
                                    tone={theyPayYou ? 'positive' : 'negative'}
                                    className="text-base font-medium"
                                />
                            </div>
                            <div className="flex items-center gap-1.5 flex-none">
                                {venmo && (
                                    <VenmoButton
                                        links={venmo}
                                        action={theyPayYou ? 'request' : 'pay'}
                                        counterparty={name}
                                        compact
                                        className="text-[12.5px]"
                                    />
                                )}
                                <Button
                                    variant="secondary"
                                    onClick={openSettleUp}
                                    className="text-[12.5px]"
                                >
                                    Settle
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );

    const groupsStrip = (
        <div>
            <div className="flex items-baseline mb-2.5">
                <div className="text-[15px] font-medium">Your groups</div>
                <button
                    type="button"
                    onClick={() => navigate('/groups')}
                    className="ml-auto text-[12.5px] text-sw-accent hover:text-sw-text"
                >
                    {groups.length > 3 ? `All ${groups.length}` : 'See all'}
                </button>
            </div>
            {groupRows.length === 0 ? (
                <Card radius="lg" className="p-4 text-[12.5px] text-sw-dim">
                    No groups yet — create one to split expenses with the same people
                    regularly.
                </Card>
            ) : (
                <div className="flex gap-2.5">
                    {groupRows.map(({ group, net: groupNet }) => (
                        <Card
                            key={group.id}
                            radius="lg"
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate(`/groups/${group.id}`)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    navigate(`/groups/${group.id}`);
                                }
                            }}
                            className="flex-1 min-w-0 p-[13px] cursor-pointer hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <div className="text-[22px]" aria-hidden="true">
                                {group.icon || '👥'}
                            </div>
                            <div className="mt-2 text-[13px] font-medium truncate">
                                {group.name}
                            </div>
                            {groupNet && groupNet.amount !== 0 ? (
                                <Money
                                    amount={groupNet.amount}
                                    currency={groupNet.currency}
                                    sign="always"
                                    tone="auto"
                                    className="mt-0.5 block text-[13px]"
                                />
                            ) : (
                                <div className="mt-0.5 text-[13px] text-sw-dim">
                                    all square
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );

    if (isDesktop) {
        return (
            <>
                <PageHeader
                    title="Overview"
                    caption="Everything you're part of, in one place"
                    actions={
                        <>
                            {currencyToggle}
                            <Button
                                variant="secondary"
                                icon={<Handshake size={15} />}
                                onClick={openSettleUp}
                            >
                                Settle up
                            </Button>
                            <Button
                                variant="primary"
                                icon={<Plus size={15} />}
                                onClick={openAddExpense}
                            >
                                Add expense
                            </Button>
                        </>
                    }
                />

                <div className="flex-1 overflow-auto px-[22px] py-5 flex flex-col gap-[18px]">
                    <div className="grid grid-cols-3 gap-3.5">
                        <StatTile
                            label="You're owed"
                            value={
                                owedTotal ? (
                                    <Money
                                        amount={owedTotal.amount}
                                        currency={owedTotal.currency}
                                        tone="positive"
                                    />
                                ) : (
                                    <span className="text-sw-dim">—</span>
                                )
                            }
                            caption={
                                owedBy.length === 0
                                    ? 'Nobody owes you right now'
                                    : `from ${owedBy.length} ${
                                          owedBy.length === 1 ? 'person' : 'people'
                                      }`
                            }
                        />
                        <StatTile
                            label="You owe"
                            value={
                                owingTotal ? (
                                    <Money
                                        amount={Math.abs(owingTotal.amount)}
                                        currency={owingTotal.currency}
                                        tone="negative"
                                    />
                                ) : (
                                    <span className="text-sw-dim">—</span>
                                )
                            }
                            caption={
                                owedTo.length === 0
                                    ? "You're all clear"
                                    : `to ${owedTo.length} ${
                                          owedTo.length === 1 ? 'person' : 'people'
                                      }`
                            }
                        />
                        <StatTile
                            tone="accent"
                            label={`Net, in ${displayCurrency}`}
                            value={
                                net === null ? (
                                    <span className="text-sw-dim text-[19px]">
                                        Switch to {displayCurrency}
                                    </span>
                                ) : (
                                    <Money
                                        amount={net}
                                        currency={displayCurrency}
                                        sign="always"
                                        tone="default"
                                    />
                                )
                            }
                            caption={
                                net === null
                                    ? 'A single total needs one currency'
                                    : net >= 0
                                      ? "You're up overall"
                                      : "You're down overall"
                            }
                        />
                    </div>

                    <div className="grid grid-cols-[1.5fr_1fr] gap-[18px] items-start">
                        <div className="flex flex-col gap-[18px] min-w-0">
                            {openTabsCard}
                            {latelyCard}
                        </div>
                        <div className="flex flex-col gap-[18px] min-w-0">
                            {settleCard}
                            {groupsStrip}
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // Mobile home: greeting, the number, then how to fix it.
    return (
        <>
            <div className="flex items-center gap-3 px-5 pb-3.5 pt-[max(1rem,env(safe-area-inset-top))] flex-none">
                <div className="min-w-0">
                    <div className="text-[13px] text-sw-dim">{timeOfDayGreeting()}</div>
                    <div className="text-[22px] font-medium tracking-[-0.015em] truncate">
                        Hey, {user?.full_name?.split(' ')[0] ?? 'there'}
                    </div>
                </div>
                {/*
                  * The only route to account, help, theme and sign-out on
                  * mobile: the tab bar's five slots are all destinations.
                  */}
                <button
                    type="button"
                    onClick={openProfile}
                    aria-label="Your account"
                    className="ml-auto flex-none relative rounded-full focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                >
                    <Avatar name={user?.full_name || ''} size={34} variant="accent" />
                    <Badge
                        count={pendingRequests}
                        label={`${pendingRequests} friend request${
                            pendingRequests === 1 ? '' : 's'
                        } waiting`}
                        className="absolute top-0 right-0"
                    />
                </button>
            </div>

            <div className="flex-1 overflow-auto px-4 pb-4 flex flex-col gap-4">
                <Card radius="lg" className="p-[18px]">
                    <div className="flex items-center gap-2">
                        <div className="text-xs uppercase tracking-[0.08em] text-sw-dim">
                            {net === null
                                ? 'Your balances'
                                : net >= 0
                                  ? "Overall, you're up"
                                  : 'Overall, you owe'}
                        </div>
                        <div className="ml-auto flex-none">{currencyToggle}</div>
                    </div>

                    {net === null ? (
                        <div className="text-[13px] text-sw-dim my-3">
                            Each group is shown in its own currency. Switch to{' '}
                            {displayCurrency} for a single total.
                        </div>
                    ) : (
                        <Money
                            amount={Math.abs(net)}
                            currency={displayCurrency}
                            tone={net >= 0 ? 'positive' : 'negative'}
                            className="block text-[44px] font-medium tracking-[-0.02em] my-2 mb-3.5"
                        />
                    )}

                    <div className="flex gap-2.5">
                        <StatTile
                            size="sm"
                            label="Owed to you"
                            value={
                                owedTotal ? (
                                    <Money
                                        amount={owedTotal.amount}
                                        currency={owedTotal.currency}
                                        tone="positive"
                                    />
                                ) : (
                                    <span className="text-sw-dim">—</span>
                                )
                            }
                        />
                        <StatTile
                            size="sm"
                            label="You owe"
                            value={
                                owingTotal ? (
                                    <Money
                                        amount={Math.abs(owingTotal.amount)}
                                        currency={owingTotal.currency}
                                        tone="negative"
                                    />
                                ) : (
                                    <span className="text-sw-dim">—</span>
                                )
                            }
                        />
                    </div>

                    {owedTo.length + owedBy.length > 0 && (
                        <Button
                            variant="primary"
                            block
                            icon={<Handshake size={16} />}
                            onClick={openSettleUp}
                            className="mt-3 min-h-11"
                        >
                            Settle up
                        </Button>
                    )}
                </Card>

                {openTabs.length > 0 && (
                    <div>
                        <div className="flex items-baseline mb-1.5">
                            <div className="text-[15px] font-medium">Open tabs</div>
                            <div className="ml-auto text-[12.5px] text-sw-dim">
                                {openTabs.length}
                            </div>
                        </div>
                        <OpenTabsList tabs={openTabs} size="sm" />
                    </div>
                )}

                {groupsStrip}

                <div>
                    <div className="flex items-baseline mb-1.5">
                        <div className="text-[15px] font-medium">Lately</div>
                        <button
                            type="button"
                            onClick={() => navigate('/activity')}
                            className="ml-auto text-[12.5px] text-sw-accent"
                        >
                            See all
                        </button>
                    </div>
                    <div className="flex flex-col">
                        {loading ? (
                            <p className="text-sm text-sw-dim py-6 text-center">Loading…</p>
                        ) : recent.length === 0 ? (
                            <p className="text-[12.5px] text-sw-dim py-6 text-center">
                                Nothing yet — tap + to add an expense.
                            </p>
                        ) : (
                            recent.map((expense) => (
                                <ExpenseFeedRow
                                    key={expense.id}
                                    expense={expense}
                                    payerName={payerName}
                                    groupName={groupName(expense)}
                                    onClick={() => openExpense.open(expense)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {openExpense.expenseId !== null && (
                <ExpenseDetailModal
                    isOpen
                    expenseId={openExpense.expenseId}
                    onClose={openExpense.close}
                    onExpenseUpdated={reload}
                    onExpenseDeleted={() => {
                        openExpense.close();
                        reload();
                    }}
                    groupMembers={openExpense.members}
                    groupGuests={openExpense.guests}
                    currentUserId={user?.id ?? 0}
                />
            )}
        </>
    );
};

export default OverviewPage;
