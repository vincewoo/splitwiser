import { useCallback, useEffect, useMemo, useState } from 'react';
import { balancesApi } from '../services/api';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth } from '../AuthContext';
import {
    participantDirectory,
    paymentsForUser,
    settlementForUser,
} from '../utils/settlement';
import type {
    Counterparty,
    GroupTransactions,
    SettlementParticipant,
    SuggestedPayment,
} from '../utils/settlement';

/**
 * Who owes the current user, and who they owe, across every group.
 *
 * Built by fanning out over `/simplify_debts/{group_id}` — one request per
 * group — because no endpoint returns a cross-group person-to-person view.
 * That is the natural place for a future `/settlement` endpoint; until then the
 * fan-out is bounded by the user's group count and runs once per mount.
 */
export function useSettlement(): {
    /** Merged per person across groups — for display. */
    counterparties: Counterparty[];
    /** Per group, so each one can be recorded as a settlement expense. */
    payments: SuggestedPayment[];
    /**
     * Who the ids refer to, keyed by `participantKey`. Covers everyone in your
     * groups, not just the ones you have befriended.
     */
    directory: Map<string, SettlementParticipant>;
    loading: boolean;
    reload: () => void;
} {
    const { user } = useAuth();
    const { groups, refreshGeneration } = useAppData();
    // Keyed by id rather than the user object, so the memoised results keep
    // their identity across renders — SettleUpPage scopes its hidden rows to
    // the `payments` array it marked them against.
    const userId = user?.id;
    const [byGroup, setByGroup] = useState<GroupTransactions[]>([]);
    const [loading, setLoading] = useState(true);

    // Bumping this re-runs the fan-out after a settlement is recorded.
    const [nonce, setNonce] = useState(0);

    // Depend on the group ids rather than the array identity, so a refetch that
    // returns the same groups does not re-trigger the fan-out.
    const groupKey = groups.map((g) => g.id).join(',');

    useEffect(() => {
        if (groups.length === 0) {
            setByGroup([]);
            setLoading(false);
            return;
        }

        let cancelled = false;
        // `loading` is only ever true before the first fan-out lands: a later
        // refresh (a recorded payment, a pull to refresh) updates the figures
        // in place rather than swapping the screen for a spinner.

        Promise.all(
            groups.map(async (group) => {
                try {
                    const data = await balancesApi.simplifyDebts(group.id);
                    return {
                        groupId: group.id,
                        groupName: group.name,
                        transactions: data.transactions ?? [],
                        participants: data.participants ?? [],
                    };
                } catch (error) {
                    console.error(`Failed to simplify debts for ${group.name}:`, error);
                    return {
                        groupId: group.id,
                        groupName: group.name,
                        transactions: [],
                        participants: [],
                    };
                }
            })
        )
            .then((result) => {
                if (!cancelled) setByGroup(result);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupKey, nonce, refreshGeneration]);

    const counterparties = useMemo(
        () => (userId ? settlementForUser(byGroup, userId) : []),
        [byGroup, userId]
    );

    const payments = useMemo(
        () => (userId ? paymentsForUser(byGroup, userId) : []),
        [byGroup, userId]
    );

    const directory = useMemo(() => participantDirectory(byGroup), [byGroup]);

    const reload = useCallback(() => setNonce((n) => n + 1), []);

    return { counterparties, payments, directory, loading, reload };
}
