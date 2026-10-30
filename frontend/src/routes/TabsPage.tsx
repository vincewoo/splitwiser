import React from 'react';
import PageHeader from './PageHeader';
import TabList from '../components/tab/TabList';
import { usePageTitle } from '../hooks/usePageTitle';
import { useTabs } from '../hooks/useTabs';
import type { Tab } from '../types/tab';

/**
 * Every tab you have opened, open ones first.
 *
 * The only place a closed tab is listed. Most closed tabs live on as an
 * expense in Activity, but one settled outside the app never had an expense,
 * and one whose expense was deleted has nothing else left: its lines, who
 * claimed what, and the receipt are all still on the tab.
 */
const TabsPage: React.FC = () => {
    usePageTitle('Tabs');
    const { openTabs, closedTabs, loaded, failed } = useTabs();

    const section = (title: string, tabs: Tab[]) =>
        tabs.length > 0 && (
            <div className="max-w-3xl pt-3 pb-1">
                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim mb-2">
                    {title}
                </div>
                <div className="mb-4">
                    <TabList tabs={tabs} />
                </div>
            </div>
        );

    return (
        <>
            <PageHeader title="Tabs" caption="Bills you split with a link" mobileInset />

            <div className="flex-1 overflow-auto px-4 lg:px-[22px] pb-4">
                {!loaded ? (
                    <p className="text-sm text-sw-dim py-8 text-center">Loading…</p>
                ) : failed ? (
                    <p className="text-sm text-sw-dim py-8 text-center">
                        Couldn’t load your tabs. Check your connection and try again.
                    </p>
                ) : openTabs.length === 0 && closedTabs.length === 0 ? (
                    <p className="text-sm text-sw-dim py-8 text-center">
                        No tabs yet. Scan a bill and open a tab to split it with a link.
                    </p>
                ) : (
                    <>
                        {section('Open', openTabs)}
                        {section('Closed', closedTabs)}
                    </>
                )}
            </div>
        </>
    );
};

export default TabsPage;
