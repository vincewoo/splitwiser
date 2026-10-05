import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Handshake, Plus } from '@phosphor-icons/react';
import {
    Avatar,
    Button,
    Card,
    IconTile,
    Money,
    SegmentedControl,
    TagPill,
} from '../components/ui';
import AddExpenseModal from '../AddExpenseModal';
import ExpenseDetailModal from '../ExpenseDetailModal';
import SettleUpModal from '../SettleUpModal';
import { useAuth } from '../AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { usePageTitle } from '../hooks/usePageTitle';
import { getApiUrl } from '../api';
import { friendsApi } from '../services/api';
import { formatDate } from '../utils/formatters';
import { payerVerb } from '../utils/expenseKind';
import type {
    Friend,
    FriendBalance,
    FriendExpenseWithSplits,
} from '../types/friend';

type Filter = 'all' | 'direct' | 'group';

/**
 * One person: what stands between you and them, and every expense you share.
 *
 * The redesign has no mockup for this screen, so it is assembled from the same
 * primitives and rhythm as the group workspace rather than inventing a new
 * layout.
 *
 * Unit note: friend balances come back from the API in whole currency units,
 * not cents — unlike everything else in the app. They are converted at the
 * boundary here so nothing downstream has to know.
 */
const PersonPage: React.FC = () => {
    const { friendId } = useParams<{ friendId: string }>();
    const navigate = useNavigate();
    const isDesktop = useIsDesktop();
    const { user } = useAuth();
    const { friends, groups, refreshAll } = useAppData();

    const [friend, setFriend] = useState<Friend | null>(null);
    const [expenses, setExpenses] = useState<FriendExpenseWithSplits[]>([]);
    const [balances, setBalances] = useState<FriendBalance[]>([]);
    const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [filter, setFilter] = useState<Filter>('all');
    const [expanded, setExpanded] = useState(false);
    const [addExpenseOpen, setAddExpenseOpen] = useState(false);
    const [settleUpOpen, setSettleUpOpen] = useState(false);
    const [openExpenseId, setOpenExpenseId] = useState<number | null>(null);
    const [inUSD, setInUSD] = useState(false);

    usePageTitle(friend?.full_name ?? 'Person');

    const load = React.useCallback(async () => {
        if (!friendId) return;
        setLoading(true);
        setError(null);
        try {
            const id = parseInt(friendId, 10);
            const [friendData, expensesData, balanceData, ratesRes] = await Promise.all([
                friendsApi.getById(id),
                friendsApi.getExpenses(id),
                friendsApi.getBalance(id),
                fetch(getApiUrl('exchange_rates')),
            ]);
            setFriend(friendData);
            setExpenses(expensesData);
            setBalances(balanceData);
            if (ratesRes.ok) setRates(await ratesRes.json());
        } catch (err) {
            console.error('Failed to fetch person data:', err);
            setError('Failed to load this person');
        } finally {
            setLoading(false);
        }
    }, [friendId]);

    useEffect(() => {
        load();
    }, [load]);

    /** Balances in cents, so they render through the same Money component. */
    const balancesInCents = useMemo(
        () =>
            balances.map((b) => ({
                amount: Math.round(b.amount * 100),
                currency: b.currency,
            })),
        [balances]
    );

    const totalUSDCents = useMemo(
        () =>
            Math.round(
                balances.reduce((sum, b) => sum + b.amount / (rates[b.currency] || 1), 0) *
                    100
            ),
        [balances, rates]
    );

    const filtered = useMemo(() => {
        if (filter === 'direct') return expenses.filter((e) => !e.group_id);
        if (filter === 'group') return expenses.filter((e) => !!e.group_id);
        return expenses;
    }, [expenses, filter]);

    const visible = expanded ? filtered : filtered.slice(0, 10);

    const payerName = (expense: FriendExpenseWithSplits): string => {
        const verb = payerVerb(expense);
        if (expense.payer_is_guest) return `A guest ${verb}`;
        if (expense.payer_id === user?.id) return `You ${verb}`;
        if (expense.payer_id === friend?.id) return `${friend.full_name} ${verb}`;
        return `Someone ${verb}`;
    };

    if (loading && !friend) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    if (error || !friend) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <p className="text-sm text-sw-muted">{error ?? 'Person not found'}</p>
                <Button variant="secondary" onClick={() => navigate('/people')}>
                    Back to people
                </Button>
            </div>
        );
    }

    /** One line stating the standing, in the design's conversational register. */
    const standing = (amount: number, currency: string) => (
        <div className="flex items-baseline gap-2 flex-wrap">
            <Money
                amount={Math.abs(amount)}
                currency={currency}
                tone={amount >= 0 ? 'positive' : 'negative'}
                className="text-[32px] font-medium"
            />
            <span className="text-[13px] text-sw-muted">
                {amount >= 0
                    ? `${friend.full_name.split(' ')[0]} owes you`
                    : `you owe ${friend.full_name.split(' ')[0]}`}
            </span>
        </div>
    );

    return (
        <>
            <div className="flex items-center gap-3 px-4 lg:px-[22px] py-4 border-b border-sw-line flex-none pt-[max(1rem,env(safe-area-inset-top))] lg:pt-4">
                {!isDesktop && (
                    <button
                        type="button"
                        onClick={() => navigate('/people')}
                        aria-label="Back to people"
                        className="text-sw-muted flex-none"
                    >
                        <ArrowLeft size={21} />
                    </button>
                )}
                <Avatar name={friend.full_name} size={34} variant="accent" />
                <div className="min-w-0">
                    <div className="text-[19px] font-medium truncate">
                        {friend.full_name}
                    </div>
                    <div className="text-[12.5px] text-sw-dim truncate">{friend.email}</div>
                </div>
                <div className="ml-auto flex items-center gap-2 flex-none">
                    <Button
                        variant="secondary"
                        icon={<Handshake size={15} />}
                        onClick={() => setSettleUpOpen(true)}
                    >
                        Settle up
                    </Button>
                    <Button
                        variant="primary"
                        icon={<Plus size={15} />}
                        onClick={() => setAddExpenseOpen(true)}
                    >
                        Add expense
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-4 lg:px-[22px] py-4 flex flex-col gap-4 max-w-4xl">
                <Card radius="lg" className="px-[18px] py-4">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                            Between you
                        </div>
                        {balancesInCents.length > 1 && (
                            <div className="ml-auto">
                                <SegmentedControl
                                    label="Balance currency"
                                    size="sm"
                                    value={inUSD ? 'usd' : 'native'}
                                    onChange={(value) => setInUSD(value === 'usd')}
                                    options={[
                                        { value: 'usd', label: 'In USD' },
                                        { value: 'native', label: 'By currency' },
                                    ]}
                                />
                            </div>
                        )}
                    </div>

                    {balancesInCents.length === 0 ? (
                        <p className="text-[13px] text-sw-dim">
                            You're all square with {friend.full_name.split(' ')[0]}.
                        </p>
                    ) : inUSD ? (
                        standing(totalUSDCents, 'USD')
                    ) : (
                        <div className="flex flex-col gap-2">
                            {balancesInCents.map((balance) => (
                                <React.Fragment key={balance.currency}>
                                    {standing(balance.amount, balance.currency)}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                </Card>

                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <div className="text-[15px] font-medium">Shared expenses</div>
                        {expenses.length > 0 && (
                            <div className="ml-auto">
                                <SegmentedControl
                                    label="Filter expenses"
                                    size="sm"
                                    value={filter}
                                    onChange={setFilter}
                                    options={[
                                        { value: 'all', label: 'All' },
                                        { value: 'direct', label: 'Direct' },
                                        { value: 'group', label: 'Group' },
                                    ]}
                                />
                            </div>
                        )}
                    </div>

                    {filtered.length === 0 ? (
                        <p className="text-[12.5px] text-sw-dim py-8 text-center">
                            {expenses.length === 0
                                ? 'No shared expenses yet.'
                                : 'Nothing matches that filter.'}
                        </p>
                    ) : (
                        <div className="flex flex-col">
                            {visible.map((expense) => (
                                <button
                                    key={expense.id}
                                    type="button"
                                    onClick={() => setOpenExpenseId(expense.id)}
                                    className="flex items-center gap-3 py-[11px] border-b border-sw-line text-left hover:bg-sw-surface focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                >
                                    <IconTile tone="surface" size={38}>
                                        {expense.icon || '🧾'}
                                    </IconTile>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-sm font-medium truncate">
                                                {expense.description}
                                            </span>
                                            {!expense.group_id && (
                                                <TagPill tone="accent" className="flex-none">
                                                    direct
                                                </TagPill>
                                            )}
                                        </div>
                                        <div className="text-xs text-sw-dim truncate">
                                            {payerName(expense)}
                                            {expense.group_name && ` · ${expense.group_name}`}
                                        </div>
                                    </div>
                                    <div className="text-right flex-none">
                                        <Money
                                            amount={expense.amount}
                                            currency={expense.currency}
                                            className="text-sm"
                                        />
                                        <div className="text-[11.5px] text-sw-dim">
                                            {formatDate(expense.date, {
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </div>
                                    </div>
                                    {expense.balance_impact != null &&
                                        expense.balance_impact !== 0 && (
                                            <Money
                                                amount={expense.balance_impact}
                                                currency={expense.currency}
                                                sign="always"
                                                tone="auto"
                                                className="w-[84px] text-right text-[13px] font-semibold flex-none hidden sm:block"
                                            />
                                        )}
                                </button>
                            ))}

                            {filtered.length > 10 && (
                                <button
                                    type="button"
                                    onClick={() => setExpanded(!expanded)}
                                    className="pt-3 text-[12.5px] text-sw-accent hover:text-sw-text"
                                >
                                    {expanded
                                        ? 'Show less'
                                        : `${filtered.length - 10} more expenses`}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <AddExpenseModal
                isOpen={addExpenseOpen}
                onClose={() => setAddExpenseOpen(false)}
                onExpenseAdded={() => {
                    load();
                    refreshAll();
                }}
                friends={friends}
                groups={groups}
                preselectedFriendId={friend.id}
            />

            <SettleUpModal
                isOpen={settleUpOpen}
                onClose={() => setSettleUpOpen(false)}
                onSettled={() => {
                    load();
                    refreshAll();
                }}
                friends={friends}
                preselectedFriendId={friend.id}
            />

            {openExpenseId !== null && (
                <ExpenseDetailModal
                    isOpen
                    expenseId={openExpenseId}
                    onClose={() => setOpenExpenseId(null)}
                    onExpenseUpdated={() => {
                        load();
                        refreshAll();
                    }}
                    onExpenseDeleted={() => {
                        setOpenExpenseId(null);
                        load();
                        refreshAll();
                    }}
                    groupMembers={[]}
                    groupGuests={[]}
                    currentUserId={user?.id ?? 0}
                />
            )}
        </>
    );
};

export default PersonPage;
