import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SignIn, UserPlus } from '@phosphor-icons/react';
import { Avatar, Button, Card, SegmentedControl } from '../components/ui';
import GroupExpenseList from '../components/group/GroupExpenseList';
import GroupBalanceBars from '../components/group/GroupBalanceBars';
import SummarySection from '../components/summary/SummarySection';
import { useAuth } from '../AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePublicGroupData } from '../hooks/usePublicGroupData';
import { api } from '../services/api';
import { payerVerb } from '../utils/expenseKind';
import type { GroupExpense } from '../hooks/useGroupData';

type Section = 'expenses' | 'balances' | 'spending' | 'people';

/**
 * A group opened from a share link.
 *
 * Rendered outside the app shell: whoever follows the link may have no account
 * and no relationship to this app yet, so there is no rail, no tab bar and
 * nothing to navigate to. Read-only throughout — the only actions are joining
 * (which needs an account) and claiming a guest profile (which creates one).
 */
const PublicGroupPage: React.FC = () => {
    const { shareLinkId } = useParams<{ shareLinkId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { group, expenses, balances, loading, error, inGroupCurrency, setInGroupCurrency } =
        usePublicGroupData(shareLinkId);

    const [section, setSection] = useState<Section>('expenses');
    const [joining, setJoining] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);

    usePageTitle(group?.name ?? 'Shared group');

    // A member who follows their own link belongs in the real group view.
    useEffect(() => {
        if (!user || !group) return;
        if (group.members?.some((member) => member.user_id === user.id)) {
            navigate(`/groups/${group.id}`, { replace: true });
        }
    }, [user, group, navigate]);

    const payerName = useMemo(
        () =>
            (expense: GroupExpense): string => {
                const verb = payerVerb(expense);
                if (expense.payer_is_guest) {
                    const guest = group?.guests?.find((g) => g.id === expense.payer_id);
                    return guest ? `${guest.name} ${verb}` : `A guest ${verb}`;
                }
                const member = group?.members?.find(
                    (m) => m.user_id === expense.payer_id
                );
                return member ? `${member.full_name} ${verb}` : `Someone ${verb}`;
            },
        [group]
    );

    const handleJoin = async () => {
        if (!shareLinkId) return;
        setJoining(true);
        setJoinError(null);
        try {
            const response = await api.groups.joinPublic(shareLinkId);
            if (response.ok) {
                const result = await response.json();
                navigate(`/groups/${result.group_id}`, { replace: true });
            } else {
                const detail = await response.json().catch(() => ({}));
                setJoinError(detail.detail || 'Could not join this group');
            }
        } catch {
            setJoinError('Could not join this group');
        } finally {
            setJoining(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    if (error || !group) {
        return (
            <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col items-center justify-center gap-2 px-8 text-center">
                <p className="text-[17px] font-medium">This link isn't working</p>
                <p className="text-[13px] text-sw-muted">
                    {error ?? 'It may have been turned off by the group owner.'}
                </p>
            </div>
        );
    }

    const peopleCount = (group.members?.length ?? 0) + (group.guests?.length ?? 0);

    return (
        <div className="min-h-screen bg-sw-bg text-sw-text font-sans flex flex-col">
            <div className="flex items-center gap-3 px-[18px] pb-3.5 pt-[max(1.5rem,env(safe-area-inset-top))] flex-none max-w-3xl w-full mx-auto">
                <span className="text-[22px] flex-none" aria-hidden="true">
                    {group.icon || '👥'}
                </span>
                <div className="min-w-0">
                    <div className="text-[19px] font-medium truncate">{group.name}</div>
                    <div className="text-[12.5px] text-sw-dim">
                        {peopleCount} {peopleCount === 1 ? 'person' : 'people'} ·{' '}
                        {expenses.length}{' '}
                        {expenses.length === 1 ? 'expense' : 'expenses'} · shared with you
                    </div>
                </div>
            </div>

            <div className="px-4 pb-3.5 flex-none max-w-3xl w-full mx-auto">
                {user ? (
                    <Card radius="lg" tone="accent" className="p-4">
                        <div className="text-[14.5px] font-medium mb-1">
                            Join {group.name}?
                        </div>
                        <p className="text-[12.5px] text-sw-muted mb-3">
                            You'll be able to add expenses and settle up with everyone
                            here.
                        </p>
                        {joinError && (
                            <p className="text-[12.5px] text-sw-neg mb-2">{joinError}</p>
                        )}
                        <Button
                            variant="primary"
                            icon={<UserPlus size={15} />}
                            disabled={joining}
                            onClick={handleJoin}
                            className="min-h-[42px]"
                        >
                            {joining ? 'Joining…' : 'Join this group'}
                        </Button>
                    </Card>
                ) : (
                    <Card radius="lg" className="p-4">
                        <div className="text-[14.5px] font-medium mb-1">
                            You're viewing a shared group
                        </div>
                        <p className="text-[12.5px] text-sw-muted mb-3">
                            Anyone with this link can see the expenses and balances. Sign
                            in to join in.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="primary"
                                icon={<SignIn size={15} />}
                                onClick={() => navigate('/login')}
                                className="min-h-[42px]"
                            >
                                Sign in
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => navigate('/register')}
                                className="min-h-[42px]"
                            >
                                Create an account
                            </Button>
                        </div>
                    </Card>
                )}
            </div>

            <div className="px-4 pb-3 flex-none max-w-3xl w-full mx-auto">
                <SegmentedControl
                    label="Group section"
                    fill
                    value={section}
                    onChange={setSection}
                    options={[
                        { value: 'expenses', label: 'Expenses' },
                        { value: 'balances', label: 'Balances' },
                        { value: 'spending', label: 'Spending' },
                        { value: 'people', label: 'People' },
                    ]}
                    className="w-full"
                />
            </div>

            <div className="flex-1 overflow-auto px-4 pb-8 max-w-3xl w-full mx-auto">
                {section === 'expenses' && (
                    <GroupExpenseList
                        variant="full"
                        expenses={expenses}
                        payerName={payerName}
                        // No viewer identity on a public link: no "you owe" line, and
                        // nothing to open, so the rows are not interactive.
                    />
                )}

                {section === 'balances' && (
                    <div className="pt-3">
                        <div className="flex justify-end mb-3">
                            <SegmentedControl
                                label="Balance currency"
                                size="sm"
                                value={inGroupCurrency ? 'group' : 'native'}
                                onChange={(value) => setInGroupCurrency(value === 'group')}
                                options={[
                                    {
                                        value: 'group',
                                        label: `In ${group.default_currency}`,
                                    },
                                    { value: 'native', label: 'By currency' },
                                ]}
                            />
                        </div>
                        <GroupBalanceBars balances={balances} />
                    </div>
                )}

                {/*
                  * Deliberately narrower than the signed-in summary: the group
                  * total and a single series, never who spent what. A share
                  * link should not name the people behind the numbers.
                  */}
                {section === 'spending' && (
                    <div className="pt-4">
                        <SummarySection
                            shareLinkId={shareLinkId}
                            currentUserId={null}
                        />
                    </div>
                )}

                {section === 'people' && (
                    <div className="pt-4 flex flex-wrap gap-[7px]">
                        {group.members?.map((member) => (
                            <span
                                key={`m-${member.id}`}
                                className="flex items-center gap-[7px] pl-[5px] pr-[11px] py-[5px] rounded-full bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-[12.5px]"
                            >
                                <Avatar name={member.full_name} size={22} />
                                {member.full_name}
                            </span>
                        ))}
                        {group.guests?.map((guest) => (
                            <button
                                key={`g-${guest.id}`}
                                type="button"
                                // Claiming a guest profile means creating an account
                                // and merging that history into it.
                                onClick={() =>
                                    navigate(
                                        `/register?claim_guest_id=${guest.id}&share_link_id=${shareLinkId}`
                                    )
                                }
                                title={`Claim ${guest.name}'s history`}
                                className="flex items-center gap-[7px] pl-[5px] pr-[11px] py-[5px] rounded-full bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-[12.5px] text-sw-muted hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <Avatar name={guest.name} size={22} />
                                {guest.name}
                                <span className="text-[11px] text-sw-accent">
                                    that's me
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="px-4 py-4 border-t border-sw-line flex-none">
                <p className="text-[11.5px] text-sw-dim text-center">
                    Shared from Splitwiser · settles in {group.default_currency}
                </p>
            </div>
        </div>
    );
};

export default PublicGroupPage;
