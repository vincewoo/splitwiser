import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, UsersThree } from '@phosphor-icons/react';
import { Button, Card, Money } from '../components/ui';
import PageHeader from './PageHeader';
import AddGroupModal from '../AddGroupModal';
import { useAppData } from '../contexts/AppDataContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { netForGroup } from '../utils/groupBalances';
import { byMostRecentActivity } from '../utils/groupSort';

/**
 * Every group you are in, each with its own net balance.
 */
const GroupsPage: React.FC = () => {
    usePageTitle('Groups');
    const navigate = useNavigate();
    const { groups, balances, refreshGroups } = useAppData();
    const [addOpen, setAddOpen] = useState(false);

    const rows = useMemo(
        () =>
            [...groups]
                .sort(byMostRecentActivity)
                .map((group) => ({ group, net: netForGroup(balances, group.id) })),
        [groups, balances]
    );

    return (
        <>
            <PageHeader
                title="Groups"
                caption="Trips, households, standing crews"
                mobileInset
                actions={
                    <Button
                        variant="primary"
                        icon={<Plus size={15} />}
                        onClick={() => setAddOpen(true)}
                    >
                        New group
                    </Button>
                }
            />

            <div className="flex-1 overflow-auto p-4 lg:px-[22px]">
                {rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
                        <div className="w-16 h-16 rounded-full bg-sw-surface flex items-center justify-center text-sw-dim">
                            <UsersThree size={30} />
                        </div>
                        <p className="text-sm text-sw-muted">No groups yet</p>
                        <p className="text-[12.5px] text-sw-dim">
                            Create one to start splitting expenses together.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                        {rows.map(({ group, net }) => (
                            <Card
                                key={group.id}
                                radius="lg"
                                onClick={() => navigate(`/groups/${group.id}`)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        navigate(`/groups/${group.id}`);
                                    }
                                }}
                                className="p-[13px] cursor-pointer hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <div className="text-[22px]" aria-hidden="true">
                                    {group.icon || '👥'}
                                </div>
                                <div className="mt-2 text-[13px] font-medium truncate">
                                    {group.name}
                                </div>
                                {net && net.amount !== 0 ? (
                                    <Money
                                        amount={net.amount}
                                        currency={net.currency}
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

            <AddGroupModal
                isOpen={addOpen}
                onClose={() => setAddOpen(false)}
                onGroupAdded={refreshGroups}
            />
        </>
    );
};

export default GroupsPage;
