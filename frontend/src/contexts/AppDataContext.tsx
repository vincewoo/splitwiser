import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { friendsApi, groupsApi, balancesApi } from '../services/api';
import { useAuth } from '../AuthContext';
import type { Friend } from '../types/friend';
import type { Group } from '../types/group';
import type { Balance } from '../types/balance';

interface AppData {
    friends: Friend[];
    groups: Group[];
    balances: Balance[];
    loading: boolean;
    /**
     * Incoming friend requests you haven't answered. The app has no push
     * channel, so this is what the badge on the account entry points counts.
     */
    pendingRequests: number;
    /**
     * false — each group in its own currency (the raw balances).
     * true  — everything converted to the user's default currency, which is the
     *         only mode where a single net total is meaningful.
     */
    showInMyCurrency: boolean;
    setShowInMyCurrency: (value: boolean) => void;
    /**
     * Bumped by every `refreshAll()`. Screens that fetch their own data — a
     * group's expenses, a person's history, the activity feed — re-run their
     * fetch when it changes, so a mutation recorded anywhere in the app (the
     * shell's add-expense modal, a settlement on `/settle`, a pull to refresh)
     * reaches the screen that is showing the affected data. Without it, only
     * the four collections this context owns were refreshed, and a group's
     * list stayed stale until the route remounted.
     */
    refreshGeneration: number;
    /** The user's default currency, used whenever a converted figure is shown. */
    displayCurrency: string;
    refreshAll: () => Promise<void>;
    refreshBalances: () => Promise<void>;
    refreshGroups: () => Promise<void>;
    refreshFriends: () => Promise<void>;
    refreshPendingRequests: () => Promise<void>;
}

/** How often to re-check for things waiting on you, in milliseconds. */
const PENDING_POLL_MS = 90_000;

const AppDataContext = createContext<AppData | undefined>(undefined);

/**
 * Groups, friends and balances, fetched once for the whole shell.
 *
 * The redesign keeps the rail, the list pane and the detail pane mounted
 * together, so several of them need the same collections at the same time.
 * Fetching per-screen would mean duplicate requests on every navigation.
 */
export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const { user } = useAuth();
    const [friends, setFriends] = useState<Friend[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [balances, setBalances] = useState<Balance[]>([]);
    const [pendingRequests, setPendingRequests] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshGeneration, setRefreshGeneration] = useState(0);
    // Default to the converted view: the redesign leads with a single net
    // figure, which only exists once everything is in one currency.
    const [showInMyCurrency, setShowInMyCurrency] = useState(true);

    const displayCurrency = user?.default_currency || 'USD';

    const refreshFriends = useCallback(async () => {
        try {
            setFriends(await friendsApi.getAll());
        } catch (error) {
            console.error('Failed to fetch friends:', error);
        }
    }, []);

    const refreshGroups = useCallback(async () => {
        try {
            setGroups(await groupsApi.getAll());
        } catch (error) {
            console.error('Failed to fetch groups:', error);
        }
    }, []);

    const refreshBalances = useCallback(async () => {
        try {
            const convertTo = showInMyCurrency ? displayCurrency : undefined;
            const data = await balancesApi.getAll(convertTo);
            setBalances(data.balances || []);
        } catch (error) {
            console.error('Failed to fetch balances:', error);
        }
    }, [showInMyCurrency, displayCurrency]);

    const refreshPendingRequests = useCallback(async () => {
        try {
            const { count } = await friendsApi.getPendingCount();
            setPendingRequests(count ?? 0);
        } catch (error) {
            // A failed poll should leave the last known count alone, not
            // silently clear a badge that is still earned.
            console.error('Failed to fetch pending friend requests:', error);
        }
    }, []);

    const fetchAll = useCallback(async () => {
        await Promise.all([
            refreshFriends(),
            refreshGroups(),
            refreshBalances(),
            refreshPendingRequests(),
        ]);
    }, [refreshFriends, refreshGroups, refreshBalances, refreshPendingRequests]);

    /**
     * Everything, plus a nudge to every screen-local fetch (see
     * `refreshGeneration`). The initial load below does not bump it: screens
     * mounting alongside the provider fetch on their own, and a bump then
     * would only make them fetch twice.
     */
    const refreshAll = useCallback(async () => {
        setRefreshGeneration((n) => n + 1);
        await fetchAll();
    }, [fetchAll]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        setLoading(true);
        fetchAll().finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
        };
        // fetchAll is stable apart from the currency mode, which has its own
        // effect below; re-running the full fetch here would double-request.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // Balances are re-fetched (not re-derived) when the currency mode changes:
    // conversion happens server-side against cached exchange rates.
    useEffect(() => {
        if (!user) return;
        refreshBalances();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showInMyCurrency, displayCurrency]);

    // There is no push channel, so the badge is kept honest by polling and by
    // re-checking whenever the tab comes back to the foreground — which is when
    // a stale count is most likely and most visible.
    useEffect(() => {
        if (!user) return;

        // Only poll a visible tab: a forgotten background tab polling forever
        // would keep the Fly machine from ever suspending. Coming back to the
        // foreground re-checks immediately, below.
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') refreshPendingRequests();
        }, PENDING_POLL_MS);
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshPendingRequests();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [user, refreshPendingRequests]);

    const value = useMemo(
        () => ({
            friends,
            groups,
            balances,
            pendingRequests,
            loading,
            showInMyCurrency,
            setShowInMyCurrency,
            displayCurrency,
            refreshGeneration,
            refreshAll,
            refreshBalances,
            refreshGroups,
            refreshFriends,
            refreshPendingRequests,
        }),
        [
            friends,
            groups,
            balances,
            pendingRequests,
            loading,
            showInMyCurrency,
            displayCurrency,
            refreshGeneration,
            refreshAll,
            refreshBalances,
            refreshGroups,
            refreshFriends,
            refreshPendingRequests,
        ]
    );

    return (
        <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
    );
};

export const useAppData = (): AppData => {
    const context = useContext(AppDataContext);
    if (!context) {
        throw new Error('useAppData must be used within an AppDataProvider');
    }
    return context;
};

export default AppDataContext;
