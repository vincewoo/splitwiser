import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    DotsThree,
    Handshake,
    Lightning,
    Plus,
    PlusCircle,
    ShareNetwork,
    UserPlus,
} from '@phosphor-icons/react';
import {
    Avatar,
    Button,
    Card,
    Money,
    SegmentedControl,
    TagPill,
} from '../components/ui';
import GroupExpenseList from '../components/group/GroupExpenseList';
import GroupBalanceBars from '../components/group/GroupBalanceBars';
import OpenExpensePane from '../components/group/OpenExpensePane';
import GroupPersonSheet from '../components/group/GroupPersonSheet';
import type { GroupPerson } from '../components/group/GroupPersonSheet';
import SummarySection from '../components/summary/SummarySection';
import AddExpenseModal from '../AddExpenseModal';
import ExpenseDetailModal from '../ExpenseDetailModal';
import EditGroupModal from '../EditGroupModal';
import DeleteGroupConfirm from '../DeleteGroupConfirm';
import AddMemberModal from '../AddMemberModal';
import AddGuestModal from '../AddGuestModal';
import SimplifyDebtsModal from '../SimplifyDebtsModal';
import { useAuth } from '../AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { useGroupData } from '../hooks/useGroupData';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';
import { netForGroup } from '../utils/groupBalances';
import type { GroupExpense } from '../hooks/useGroupData';

type ExpenseFilter = 'all' | 'expenses' | 'settlements' | 'mine';

/** What the panel beside the expenses is showing. */
type GroupView = 'balances' | 'spending';
type MobileTab = 'expenses' | 'balances' | 'spending' | 'people';

/**
 * The group workspace.
 *
 * Desktop is the three-pane posture the redesign argues for: the groups list,
 * the expense list, and the open expense all stay on screen together, so
 * opening an expense never covers what you were reading. Mobile keeps the same
 * content behind a segmented control.
 */
const GroupPage: React.FC = () => {
    const { groupId } = useParams<{ groupId: string }>();
    const navigate = useNavigate();
    const isDesktop = useIsDesktop();
    const { user } = useAuth();
    const {
        groups,
        balances: allBalances,
        friends,
        refreshAll,
        refreshGroups,
    } = useAppData();

    const id = groupId ? parseInt(groupId, 10) : undefined;
    const {
        group,
        expenses,
        balances,
        loading,
        error,
        inGroupCurrency,
        setInGroupCurrency,
        reload,
    } = useGroupData(id);

    usePageTitle(group?.name ?? 'Group');

    const [filter, setFilter] = useState<ExpenseFilter>('all');
    const [mobileTab, setMobileTab] = useState<MobileTab>('expenses');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
    const [addExpenseOpen, setAddExpenseOpen] = useState(false);
    const [editGroupOpen, setEditGroupOpen] = useState(false);
    const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
    const [addMemberOpen, setAddMemberOpen] = useState(false);
    const [addGuestOpen, setAddGuestOpen] = useState(false);
    const [openPerson, setOpenPerson] = useState<GroupPerson | null>(null);
    const [groupView, setGroupView] = useState<GroupView>('balances');
    const [simplifyOpen, setSimplifyOpen] = useState(false);

    const refreshEverything = useCallback(async () => {
        await Promise.all([reload(), refreshAll()]);
    }, [reload, refreshAll]);

    const payerName = useCallback(
        (expense: GroupExpense): string => {
            if (expense.payer_is_guest) {
                const guest = group?.guests?.find((g) => g.id === expense.payer_id);
                return guest ? `${guest.name} paid` : 'A guest paid';
            }
            if (expense.payer_id === user?.id) return 'You paid';
            const member = group?.members?.find((m) => m.user_id === expense.payer_id);
            return member ? `${member.full_name} paid` : 'Someone paid';
        },
        [group, user?.id]
    );

    const filtered = useMemo(() => {
        switch (filter) {
            case 'expenses':
                return expenses.filter((e) => !e.is_settlement);
            case 'settlements':
                return expenses.filter((e) => e.is_settlement);
            case 'mine':
                return expenses.filter(
                    (e) =>
                        (e.payer_id === user?.id && !e.payer_is_guest) ||
                        e.splits?.some((s) => !s.is_guest && s.user_id === user?.id)
                );
            default:
                return expenses;
        }
    }, [expenses, filter, user?.id]);

    const selected = useMemo(
        () => expenses.find((e) => e.id === selectedId) ?? null,
        [expenses, selectedId]
    );

    /** The current user's own net in this group. */
    const myBalance = useMemo(
        () =>
            balances.find((b) => !b.is_guest && b.user_id === user?.id) ?? null,
        [balances, user?.id]
    );

    const peopleCount =
        (group?.members?.length ?? 0) + (group?.guests?.length ?? 0);

    const handleShare = async () => {
        if (!group || id === undefined) return;
        try {
            const response = await api.groups.share(id);
            if (!response.ok) return;
            const updated = await response.json();
            const url = `${window.location.origin}/share/${updated.share_link_id}`;
            if (navigator.share) {
                await navigator.share({
                    title: `Join "${group.name}" on Splitwiser`,
                    text: `View expenses and balances for ${group.name}`,
                    url,
                });
            } else {
                await navigator.clipboard.writeText(url);
            }
            await reload();
        } catch (err) {
            // A user dismissing the share sheet rejects the promise; that is not
            // an error worth surfacing.
            console.error('Share failed:', err);
        }
    };

    const handleSelect = (expense: GroupExpense) => {
        if (isDesktop) {
            // Desktop shows it in the pane beside the list.
            setSelectedId(expense.id);
        } else {
            setEditingExpenseId(expense.id);
        }
    };

    if (loading && !group) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    if (error || !group) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <p className="text-sm text-sw-muted">{error ?? 'Group not found'}</p>
                <Button variant="secondary" onClick={() => navigate('/groups')}>
                    Back to groups
                </Button>
            </div>
        );
    }

    const modals = (
        <>
            <AddExpenseModal
                isOpen={addExpenseOpen}
                onClose={() => setAddExpenseOpen(false)}
                onExpenseAdded={refreshEverything}
                friends={friends}
                groups={groups}
                preselectedGroupId={id ?? null}
            />

            <ExpenseDetailModal
                isOpen={editingExpenseId !== null}
                expenseId={editingExpenseId}
                onClose={() => setEditingExpenseId(null)}
                onExpenseUpdated={refreshEverything}
                onExpenseDeleted={() => {
                    setSelectedId(null);
                    refreshEverything();
                }}
                groupMembers={group.members ?? []}
                groupGuests={group.guests ?? []}
                currentUserId={user?.id ?? 0}
                groupDefaultCurrency={group.default_currency}
            />

            <EditGroupModal
                isOpen={editGroupOpen}
                onClose={() => setEditGroupOpen(false)}
                group={group}
                onGroupUpdated={() => {
                    reload();
                    refreshGroups();
                }}
            />

            <DeleteGroupConfirm
                isOpen={deleteGroupOpen}
                onClose={() => setDeleteGroupOpen(false)}
                group={group}
                onDeleted={() => {
                    refreshGroups();
                    navigate('/groups');
                }}
            />

            <AddMemberModal
                isOpen={addMemberOpen}
                onClose={() => setAddMemberOpen(false)}
                onMemberAdded={refreshEverything}
                groupId={String(id)}
                friends={friends}
            />

            <AddGuestModal
                isOpen={addGuestOpen}
                onClose={() => setAddGuestOpen(false)}
                onGuestAdded={refreshEverything}
                groupId={String(id)}
            />

            <SimplifyDebtsModal
                isOpen={simplifyOpen}
                onClose={() => setSimplifyOpen(false)}
                groupId={id!}
                groupName={group.name}
                members={group.members ?? []}
                guests={group.guests ?? []}
                onPaymentCreated={refreshEverything}
            />

            <GroupPersonSheet
                person={openPerson}
                onClose={() => setOpenPerson(null)}
                groupId={id!}
                members={group.members ?? []}
                guests={group.guests ?? []}
                currentUserId={user?.id}
                onChanged={refreshEverything}
            />
        </>
    );

    const currencyToggle = (
        <SegmentedControl
            label="Balance currency"
            size="sm"
            value={inGroupCurrency ? 'group' : 'native'}
            onChange={(value) => setInGroupCurrency(value === 'group')}
            options={[
                { value: 'group', label: `In ${group.default_currency}` },
                { value: 'native', label: 'By currency' },
            ]}
        />
    );

    const peopleSection = (
        <div className="p-[18px]">
            <div className="flex items-center gap-2 mb-2.5">
                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                    People · {peopleCount}
                </div>
                <div className="ml-auto flex gap-1">
                    <Button
                        variant="ghost"
                        onClick={() => setAddMemberOpen(true)}
                        icon={<UserPlus size={14} />}
                        className="text-[12.5px]"
                    >
                        Add
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setAddGuestOpen(true)}
                        className="text-[12.5px]"
                    >
                        Guest
                    </Button>
                </div>
            </div>
            <div className="flex flex-wrap gap-[7px]">
                {/*
                  * Each chip opens the sheet holding everything you can do to
                  * that person: claim, link their balance, remove, befriend.
                  */}
                {group.members?.map((member) => {
                    const isMe = member.user_id === user?.id;
                    return (
                        <button
                            type="button"
                            key={`m-${member.id}`}
                            onClick={() => setOpenPerson({ kind: 'member', member })}
                            aria-label={`Manage ${member.full_name}`}
                            className="flex items-center gap-[7px] pl-[5px] pr-[11px] py-[5px] rounded-full bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-[12.5px] hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                        >
                            <Avatar
                                name={member.full_name}
                                size={22}
                                variant={isMe ? 'accent' : 'neutral'}
                            />
                            {isMe ? 'You' : member.full_name}
                            {member.managed_by_name && (
                                <span className="text-sw-dim">
                                    → {member.managed_by_name}
                                </span>
                            )}
                        </button>
                    );
                })}
                {group.guests?.map((guest) => (
                    <button
                        type="button"
                        key={`g-${guest.id}`}
                        onClick={() => setOpenPerson({ kind: 'guest', guest })}
                        aria-label={`Manage ${guest.name}`}
                        className="flex items-center gap-[7px] pl-[5px] pr-[11px] py-[5px] rounded-full bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-[12.5px] text-sw-muted hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                    >
                        <Avatar name={guest.name} size={22} />
                        {guest.name} · guest
                        {guest.managed_by_name && (
                            <span className="text-sw-dim">
                                → {guest.managed_by_name}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );

    /*
     * Balances and spending answer different questions off the same expenses:
     * balances net to zero and go quiet once everyone has settled, spending
     * never nets. They share this slot rather than stacking, so neither buries
     * the other.
     */
    const balancesSection = (
        <div className="p-[18px] border-b border-sw-line">
            <div className="flex items-center gap-2 mb-3">
                <SegmentedControl
                    label="Group view"
                    size="sm"
                    value={groupView}
                    onChange={(value) => setGroupView(value as GroupView)}
                    options={[
                        { value: 'balances', label: 'Balances' },
                        { value: 'spending', label: 'Spending' },
                    ]}
                />
                {groupView === 'balances' && (
                    <div className="ml-auto">{currencyToggle}</div>
                )}
            </div>

            {groupView === 'balances' ? (
                <>
                    <GroupBalanceBars balances={balances} currentUserId={user?.id} />
                    <Button
                        variant="primary"
                        block
                        icon={<Lightning size={15} />}
                        onClick={() => setSimplifyOpen(true)}
                        className="mt-3.5"
                    >
                        Simplify debts
                    </Button>
                </>
            ) : (
                <SummarySection groupId={id} currentUserId={user?.id ?? null} />
            )}
        </div>
    );

    if (isDesktop) {
        return (
            <div className="flex flex-1 min-h-0">
                {/* Groups list pane — stays mounted beside the workspace. */}
                <div className="w-[268px] flex-none bg-sw-bg border-r border-sw-line flex flex-col">
                    <div className="flex items-center gap-2 px-3.5 pt-4 pb-2.5">
                        <div className="text-xs uppercase tracking-[0.09em] text-sw-dim">
                            Your groups
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/groups')}
                            aria-label="All groups"
                            className="ml-auto text-sw-accent hover:text-sw-text"
                        >
                            <PlusCircle size={17} />
                        </button>
                    </div>
                    <div className="px-2 flex flex-col gap-0.5 overflow-auto pb-3">
                        {groups.map((candidate) => {
                            const net = netForGroup(allBalances, candidate.id);
                            const active = candidate.id === id;
                            return (
                                <button
                                    key={candidate.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedId(null);
                                        navigate(`/groups/${candidate.id}`);
                                    }}
                                    className={`flex items-center gap-[11px] p-2.5 rounded-sw-row text-left ${
                                        active
                                            ? 'bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)]'
                                            : 'hover:bg-sw-surface'
                                    } focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2`}
                                >
                                    <span className="w-8 h-8 rounded-[9px] bg-sw-raise flex items-center justify-center text-base flex-none">
                                        {candidate.icon || '👥'}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[13.5px] font-medium truncate">
                                            {candidate.name}
                                        </span>
                                        <span className="block text-[11.5px] text-sw-dim truncate">
                                            {candidate.default_currency}
                                        </span>
                                    </span>
                                    {net && net.amount !== 0 ? (
                                        <Money
                                            amount={net.amount}
                                            currency={net.currency}
                                            sign="always"
                                            tone="auto"
                                            className="text-[12.5px] font-semibold flex-none"
                                        />
                                    ) : (
                                        <span className="text-[12.5px] text-sw-dim flex-none">
                                            even
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Workspace */}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <div className="flex items-center gap-3 px-[22px] py-[15px] border-b border-sw-line flex-none">
                        <span className="w-[34px] h-[34px] rounded-[10px] bg-sw-raise flex items-center justify-center text-lg flex-none">
                            {group.icon || '👥'}
                        </span>
                        <div className="min-w-0">
                            <div className="text-lg font-medium truncate">{group.name}</div>
                            <div className="text-xs text-sw-dim truncate">
                                {peopleCount} {peopleCount === 1 ? 'person' : 'people'} ·{' '}
                                {expenses.length}{' '}
                                {expenses.length === 1 ? 'expense' : 'expenses'} · settles in{' '}
                                {group.default_currency}
                            </div>
                        </div>
                        {myBalance && myBalance.amount !== 0 && (
                            <TagPill
                                tone={myBalance.amount > 0 ? 'positive' : 'negative'}
                                className="ml-2 flex-none"
                            >
                                {myBalance.amount > 0 ? "You're owed " : 'You owe '}
                                <Money
                                    amount={Math.abs(myBalance.amount)}
                                    currency={myBalance.currency}
                                    tone={myBalance.amount > 0 ? 'positive' : 'negative'}
                                />
                            </TagPill>
                        )}
                        <div className="ml-auto flex items-center gap-2 flex-none">
                            <Button
                                variant="secondary"
                                icon={<ShareNetwork size={15} />}
                                onClick={handleShare}
                            >
                                Share
                            </Button>
                            <Button
                                variant="secondary"
                                icon={<Handshake size={15} />}
                                onClick={() => setSimplifyOpen(true)}
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

                    <div className="flex-1 min-h-0 grid grid-cols-[1.25fr_1fr]">
                        <div className="flex flex-col min-w-0 border-r border-sw-line overflow-hidden">
                            <div className="flex items-center gap-2 px-5 py-3.5 flex-none">
                                <SegmentedControl
                                    label="Filter expenses"
                                    value={filter}
                                    onChange={setFilter}
                                    options={[
                                        { value: 'all', label: 'All' },
                                        { value: 'expenses', label: 'Expenses' },
                                        { value: 'settlements', label: 'Settlements' },
                                        { value: 'mine', label: 'Mine' },
                                    ]}
                                />
                            </div>
                            <div className="flex-1 overflow-auto px-3 pb-4">
                                <GroupExpenseList
                                    expenses={filtered}
                                    currentUserId={user?.id}
                                    payerName={payerName}
                                    selectedId={selectedId}
                                    onSelect={handleSelect}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col min-w-0 overflow-auto">
                            {selected && (
                                <OpenExpensePane
                                    expense={selected}
                                    currentUserId={user?.id}
                                    payerName={payerName}
                                    onEdit={() => setEditingExpenseId(selected.id)}
                                    onDelete={() => setEditingExpenseId(selected.id)}
                                />
                            )}
                            {balancesSection}
                            {peopleSection}
                        </div>
                    </div>
                </div>

                {modals}
            </div>
        );
    }

    // Mobile: balance up top, then the same content behind a segmented control.
    return (
        <>
            <div className="flex items-center gap-3 px-[18px] pb-3 pt-[max(1rem,env(safe-area-inset-top))] flex-none">
                <button
                    type="button"
                    onClick={() => navigate('/groups')}
                    aria-label="Back to groups"
                    className="text-sw-muted flex-none"
                >
                    <ArrowLeft size={21} />
                </button>
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[19px] flex-none">{group.icon || '👥'}</span>
                    <span className="text-[17px] font-medium truncate">{group.name}</span>
                </div>
                <button
                    type="button"
                    onClick={() => setEditGroupOpen(true)}
                    aria-label="Group settings"
                    className="ml-auto text-sw-muted flex-none"
                >
                    <DotsThree size={22} />
                </button>
            </div>

            <div className="px-4 pb-3.5 flex-none">
                <Card radius="lg" className="px-4 py-[15px]">
                    <div className="text-xs text-sw-dim">
                        {!myBalance || myBalance.amount === 0
                            ? "In this group you're all square"
                            : myBalance.amount > 0
                              ? "In this group you're owed"
                              : 'In this group you owe'}
                    </div>
                    {myBalance && myBalance.amount !== 0 && (
                        <Money
                            amount={Math.abs(myBalance.amount)}
                            currency={myBalance.currency}
                            tone={myBalance.amount > 0 ? 'positive' : 'negative'}
                            className="block text-[32px] font-medium mt-1 mb-3"
                        />
                    )}
                    <div className="flex gap-2 mt-3">
                        <Button
                            variant="primary"
                            icon={<Lightning size={15} />}
                            onClick={() => setSimplifyOpen(true)}
                            className="flex-1 min-h-[42px]"
                        >
                            Settle up
                        </Button>
                        <Button
                            variant="secondary"
                            icon={<ShareNetwork size={15} />}
                            onClick={handleShare}
                            className="flex-1 min-h-[42px]"
                        >
                            Share
                        </Button>
                    </div>
                </Card>
            </div>

            <div className="px-4 pb-3 flex-none">
                <SegmentedControl
                    label="Group section"
                    fill
                    value={mobileTab}
                    onChange={setMobileTab}
                    options={[
                        { value: 'expenses', label: 'Expenses' },
                        { value: 'balances', label: 'Balances' },
                        { value: 'spending', label: 'Spending' },
                        { value: 'people', label: 'People' },
                    ]}
                    className="w-full"
                />
            </div>

            <div className="flex-1 overflow-auto px-4 pb-4">
                {mobileTab === 'expenses' && (
                    <GroupExpenseList
                        variant="full"
                        expenses={expenses}
                        currentUserId={user?.id}
                        payerName={payerName}
                        onSelect={handleSelect}
                    />
                )}
                {mobileTab === 'balances' && (
                    <div className="pt-3">
                        <div className="flex justify-end mb-3">{currencyToggle}</div>
                        <GroupBalanceBars balances={balances} currentUserId={user?.id} />
                    </div>
                )}
                {mobileTab === 'spending' && (
                    <div className="pt-3">
                        <SummarySection groupId={id} currentUserId={user?.id ?? null} />
                    </div>
                )}
                {mobileTab === 'people' && (
                    <div className="-mx-[18px]">{peopleSection}</div>
                )}
            </div>

            {modals}
        </>
    );
};

export default GroupPage;
