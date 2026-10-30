import { useEffect, useState } from 'react';
import { tabsApi } from '../services/api';
import { useAppData } from '../contexts/AppDataContext';
import type { Tab } from '../types/tab';

export interface UseTabsResult {
    openTabs: Tab[];
    /** Most recently closed first. Always empty when only open tabs were asked for. */
    closedTabs: Tab[];
    loaded: boolean;
    /** The fetch failed — offline, or an older backend without /tabs. */
    failed: boolean;
}

/**
 * The signed-in user's tabs, split into open and closed.
 *
 * `GET /tabs` is already scoped to tabs you created, so this is only ever your
 * own. Open tabs are the re-entry rows on the home page and Activity. Closed
 * ones are the only way back to a tab that left nothing else behind: one
 * settled outside the app, or one whose expense was deleted.
 *
 * Pass `'open'` where closed tabs are not shown: every tab comes with all its
 * lines, and the closed ones only ever pile up.
 */
export function useTabs(statusFilter?: 'open'): UseTabsResult {
    const { refreshGeneration } = useAppData();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (statusFilter ? tabsApi.getAll(statusFilter) : tabsApi.getAll())
            .then((data: Tab[]) => {
                if (cancelled) return;
                setTabs(data);
                setFailed(false);
            })
            .catch(() => {
                // Not worth an error on a page that has other things to show.
                if (!cancelled) setFailed(true);
            })
            .finally(() => !cancelled && setLoaded(true));
        return () => {
            cancelled = true;
        };
    }, [refreshGeneration, statusFilter]);

    return {
        openTabs: tabs.filter((tab) => tab.status === 'open'),
        closedTabs: tabs
            .filter((tab) => tab.status === 'closed')
            .sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? '')),
        loaded,
        failed,
    };
}
