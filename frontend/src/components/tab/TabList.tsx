import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import { Card, Money } from '../ui';
import { claimedTotal, toShareItems, unclaimedTotal } from '../../utils/tabShares';
import { closedTabFate, closedTabFateLabel } from '../../utils/closedTab';
import type { Tab } from '../../types/tab';

export interface TabListProps {
    tabs: Tab[];
    /** 'sm' is the home page card, where the rows sit inside a titled Card. */
    size?: 'sm' | 'md';
}

/** `closed_at` is a naive UTC timestamp; read it as UTC, show it locally. */
const closedOn = (closedAt: string) =>
    new Date(/(?:[Zz]|[+-]\d\d:?\d\d)$/.test(closedAt) ? closedAt : `${closedAt}Z`)
        .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Tabs as rows you can get back into.
 *
 * A tab is not a group and has no other page listing it, so once you navigate
 * away from one the only way back is a list like this one. Open tabs say what
 * is still unclaimed; closed ones say when they closed and where they went.
 */
const TabList: React.FC<TabListProps> = ({ tabs, size = 'md' }) => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col gap-2">
            {tabs.map((tab) => {
                const shareItems = toShareItems(tab.items);
                const outstanding = unclaimedTotal(shareItems);
                const spoken = claimedTotal(shareItems);
                const openTab = () => navigate(`/tabs/${tab.id}`);

                return (
                    <Card
                        key={tab.id}
                        radius="lg"
                        role="button"
                        tabIndex={0}
                        onClick={openTab}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openTab();
                            }
                        }}
                        className={`flex items-center gap-3 cursor-pointer hover:bg-sw-raise focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${
                            size === 'sm' ? 'p-3' : 'p-3.5'
                        }`}
                    >
                        <span
                            className={`w-1.5 h-1.5 rounded-full flex-none ${
                                tab.status === 'open' ? 'bg-sw-pos' : 'bg-sw-dim'
                            }`}
                        />
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium truncate">
                                {tab.name}
                            </span>
                            <span className="block text-[11.5px] text-sw-dim truncate">
                                {tab.status === 'closed' && (
                                    <>
                                        {tab.closed_at ? `Closed ${closedOn(tab.closed_at)}` : 'Closed'}
                                        {' · '}
                                    </>
                                )}
                                {tab.participants.length}{' '}
                                {tab.participants.length === 1 ? 'person' : 'people'}
                                {tab.status === 'closed' ? (
                                    ` · ${closedTabFateLabel[closedTabFate(tab)]}`
                                ) : outstanding > 0 ? (
                                    <>
                                        {' · '}
                                        <Money
                                            amount={outstanding}
                                            currency={tab.currency}
                                            tone="muted"
                                        />{' '}
                                        still unclaimed
                                    </>
                                ) : (
                                    ' · everything claimed'
                                )}
                            </span>
                        </span>
                        <Money
                            amount={spoken + outstanding + tab.tax + tab.tip}
                            currency={tab.currency}
                            className="text-sm flex-none"
                        />
                        <CaretRight size={16} className="text-sw-dim flex-none" />
                    </Card>
                );
            })}
        </div>
    );
};

export default TabList;
