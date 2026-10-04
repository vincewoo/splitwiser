import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSettlement } from '../useSettlement';

const simplifyDebts = vi.fn();
vi.mock('../../services/api', () => ({
    balancesApi: {
        simplifyDebts: (...args: unknown[]) => simplifyDebts(...args),
    },
}));

vi.mock('../../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin', default_currency: 'USD' } }),
}));

// What the provider hands out, mutable per test. The hook reads `groups`,
// `loading` and `refreshGeneration` off it.
let appData: { groups: { id: number; name: string }[]; loading: boolean; refreshGeneration: number };
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => appData,
}));

const tahoe = { id: 7, name: 'Tahoe' };

const participants = [
    { user_id: 1, is_guest: false, display_name: 'Maya Lin', venmo_username: null },
    { user_id: 2, is_guest: false, display_name: 'Sam Okafor', venmo_username: null },
];

/** Maya owes Sam $54.35 in Tahoe. */
const iOweSam = {
    from_id: 1,
    from_is_guest: false,
    to_id: 2,
    to_is_guest: false,
    amount: 5435,
    currency: 'USD',
};

beforeEach(() => {
    appData = { groups: [], loading: true, refreshGeneration: 0 };
    simplifyDebts.mockReset().mockResolvedValue({ transactions: [iOweSam], participants });
});

describe('useSettlement loading', () => {
    it('stays loading until the first fan-out lands — no "all settled" flash', async () => {
        // Before the provider has delivered the groups, an empty list means
        // "not loaded yet", not "no groups". If `loading` dropped here, the
        // settle screen would flash "All settled" at everyone with debts.
        const { result, rerender } = renderHook(() => useSettlement());
        expect(result.current.loading).toBe(true);
        expect(simplifyDebts).not.toHaveBeenCalled();

        // Groups arrive, but the per-group plan is still in flight — the same
        // flash would happen if `loading` only tracked the provider.
        let finish!: (value: unknown) => void;
        simplifyDebts.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        appData = { groups: [tahoe], loading: false, refreshGeneration: 0 };
        rerender();
        expect(result.current.loading).toBe(true);

        finish({ transactions: [iOweSam], participants });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.counterparties).toHaveLength(1);
        expect(result.current.counterparties[0].amount).toBe(-5435);
    });

    it('settles immediately for a user with no groups at all', () => {
        // With zero groups there is nothing to fan out over: "all settled" is
        // the truth, and waiting for a fan-out that will never run would leave
        // the screen on a spinner forever.
        appData = { groups: [], loading: false, refreshGeneration: 0 };
        const { result } = renderHook(() => useSettlement());
        expect(result.current.loading).toBe(false);
        expect(simplifyDebts).not.toHaveBeenCalled();
    });

    it('a refresh generation bump re-runs the fan-out without flipping back to loading', async () => {
        // A payment recorded elsewhere (or a pull to refresh) bumps the
        // generation; the figures must update in place. If the re-run flipped
        // `loading`, every refresh would swap the settle screen for a spinner —
        // and if refreshGeneration fell out of the deps, recorded payments
        // would leave stale debts on screen and nothing would fail.
        appData = { groups: [tahoe], loading: false, refreshGeneration: 0 };
        const { result, rerender } = renderHook(() => useSettlement());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.counterparties[0].amount).toBe(-5435);

        let finish!: (value: unknown) => void;
        simplifyDebts.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        appData = { groups: [tahoe], loading: false, refreshGeneration: 1 };
        rerender();

        await waitFor(() => expect(simplifyDebts).toHaveBeenCalledTimes(2));
        // Mid-flight: still not loading, old figures still up.
        expect(result.current.loading).toBe(false);
        expect(result.current.counterparties[0].amount).toBe(-5435);

        finish({ transactions: [{ ...iOweSam, amount: 1435 }], participants });
        await waitFor(() => expect(result.current.counterparties[0].amount).toBe(-1435));
        expect(result.current.loading).toBe(false);
        // One bump, one fan-out.
        expect(simplifyDebts).toHaveBeenCalledTimes(2);
    });
});
