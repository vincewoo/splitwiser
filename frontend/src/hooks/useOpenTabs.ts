import { useEffect, useState } from 'react';
import { tabsApi } from '../services/api';
import { useAppData } from '../contexts/AppDataContext';
import type { Tab } from '../types/tab';

/**
 * The signed-in user's open tabs, newest first.
 *
 * `GET /tabs` is already scoped to tabs you created, so this is only ever your
 * own. Shared by the home page and the activity page, which both need a way
 * back into a tab you have wandered off from.
 */
export function useOpenTabs(): { openTabs: Tab[] } {
    const { refreshGeneration } = useAppData();
    const [openTabs, setOpenTabs] = useState<Tab[]>([]);

    useEffect(() => {
        let cancelled = false;
        tabsApi
            .getAll('open')
            .then((data: Tab[]) => !cancelled && setOpenTabs(data))
            .catch(() => {
                // An older backend without /tabs should not break the page.
            });
        return () => {
            cancelled = true;
        };
    }, [refreshGeneration]);

    return { openTabs };
}
