import { useEffect, useState } from 'react';
import { tabsApi } from '../services/api';
import { useAppData } from '../contexts/AppDataContext';
import type { Tab } from '../types/tab';

/**
 * The signed-in user's tabs, newest first, split into open and closed.
 *
 * `GET /tabs` is already scoped to tabs you created, so this is only ever your
 * own. Open tabs are the re-entry rows on the home page and Activity. Closed
 * ones are the only way back to a tab that left nothing else behind: one
 * settled outside the app, or one whose expense was deleted.
 */
export function useTabs(): { openTabs: Tab[]; closedTabs: Tab[]; loaded: boolean } {
    const { refreshGeneration } = useAppData();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        tabsApi
            .getAll()
            .then((data: Tab[]) => !cancelled && setTabs(data))
            .catch(() => {
                // An older backend without /tabs should not break the page.
            })
            .finally(() => !cancelled && setLoaded(true));
        return () => {
            cancelled = true;
        };
    }, [refreshGeneration]);

    return {
        openTabs: tabs.filter((tab) => tab.status === 'open'),
        closedTabs: tabs.filter((tab) => tab.status === 'closed'),
        loaded,
    };
}
