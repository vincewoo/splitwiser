import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Notice } from '../ui';
import { groupsApi } from '../../services/api';
import type {
    GroupSummaryResponse,
    PublicGroupSummaryResponse,
} from '../../types/summary';
import MemberConsumptionTable from './MemberConsumptionTable';
import SpendingTrendChart from './SpendingTrendChart';
import SummaryHeader from './SummaryHeader';

interface SummarySectionProps {
    /** Set in authenticated mode. Exactly one of groupId / shareLinkId must be provided. */
    groupId?: number;
    /** Set in public share-link mode. */
    shareLinkId?: string;
    /** Authenticated user's id; null in public mode. Forwarded to MemberConsumptionTable. */
    currentUserId: number | null;
    /**
     * `AppDataContext.refreshGeneration`: when it moves, the summary re-fetches
     * in place, so a mutation recorded anywhere (the shell's add-expense modal,
     * a pull to refresh) reaches an open Spending view. Omitted on public
     * share-link pages, which live outside the app shell and its refreshes.
     */
    refreshGeneration?: number;
}

type SummaryResponse = GroupSummaryResponse | PublicGroupSummaryResponse;

/**
 * The group's spending summary: who consumed how much, and when.
 *
 * Distinct from balances, which net to zero and go quiet once everyone has
 * settled — this never nets and answers "what did this cost us, and who did
 * the spending". Two shapes: members plus a stacked chart when you are signed
 * in, group total plus a single-series chart on a public share link.
 *
 * The response is cached for the session; switching views does not refetch.
 */
const SummarySection: React.FC<SummarySectionProps> = ({
    groupId,
    shareLinkId,
    currentUserId,
    refreshGeneration,
}) => {
    const isPublic = !!shareLinkId;
    const [response, setResponse] = useState<SummaryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchSummary = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data: SummaryResponse = isPublic
                ? await groupsApi.getPublicSummary(shareLinkId!)
                : await groupsApi.getSummary(groupId!);
            setResponse(data);
        } catch (err) {
            console.error('Failed to fetch group summary:', err);
            setError('Failed to load summary');
        } finally {
            setIsLoading(false);
        }
    }, [isPublic, shareLinkId, groupId]);

    // Fetched on mount rather than on a disclosure: the group page only mounts
    // this once you switch to the Spending view, so mounting *is* the request
    // for it. React 19 strict mode double-invokes effects, so the
    // response/isLoading/error guard still has to be here.
    useEffect(() => {
        if (response || isLoading || error) return;
        fetchSummary();
    }, [response, isLoading, error, fetchSummary]);

    // A global refresh re-fetches in place — the guard above only governs the
    // initial mount. Tracked against the last seen generation so mounting
    // mid-session doesn't double-fetch.
    const lastGeneration = useRef(refreshGeneration);
    useEffect(() => {
        if (refreshGeneration === undefined) return;
        if (refreshGeneration === lastGeneration.current) return;
        lastGeneration.current = refreshGeneration;
        fetchSummary();
    }, [refreshGeneration, fetchSummary]);

    const handleRetry = () => {
        // Retry directly rather than relying on the effect — the effect's
        // response/isLoading guards keep it idle here.
        setError(null);
        fetchSummary();
    };

    // With data already on screen, a refetch updates it in place: no skeleton
    // swap, and a failed background refresh keeps the stale figures rather
    // than replacing them with an error.
    return (
        <div>
            {isLoading && !response && <SummarySkeleton isPublic={isPublic} />}

            {error && !isLoading && !response && (
                <div role="alert" aria-live="assertive" className="flex flex-col items-start gap-2.5">
                    <Notice tone="error">{error}</Notice>
                    <Button variant="secondary" onClick={handleRetry}>
                        Try again
                    </Button>
                </div>
            )}

            {response && (
                isPublic ? (
                    <PublicSummaryContent response={response as PublicGroupSummaryResponse} />
                ) : (
                    <AuthSummaryContent
                        response={response as GroupSummaryResponse}
                        currentUserId={currentUserId}
                    />
                )
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Authenticated path: per-member table + stacked chart
// ---------------------------------------------------------------------------

interface AuthSummaryContentProps {
    response: GroupSummaryResponse;
    currentUserId: number | null;
}

const AuthSummaryContent: React.FC<AuthSummaryContentProps> = ({ response, currentUserId }) => {
    return (
        <>
            <MemberConsumptionTable response={response} currentUserId={currentUserId} />
            {response.series.length > 0 && (
                <div className="mt-5">
                    <SpendingTrendChart
                        mode="stacked"
                        series={response.series}
                        members={response.members}
                        granularity={response.granularity}
                        currency={response.currency}
                    />
                </div>
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// Public path: narrower group-total header + single-series chart
// ---------------------------------------------------------------------------

interface PublicSummaryContentProps {
    response: PublicGroupSummaryResponse;
}

const PublicSummaryContent: React.FC<PublicSummaryContentProps> = ({ response }) => {
    const { group_total, currency, granularity, has_synthesized_historical_rate, series } = response;

    return (
        <div>
            <SummaryHeader
                groupTotal={group_total}
                currency={currency}
                granularity={granularity}
                hasSynthesizedHistoricalRate={has_synthesized_historical_rate}
            />

            {series.length > 0 ? (
                <SpendingTrendChart
                    mode="single"
                    series={series}
                    granularity={granularity}
                    currency={currency}
                />
            ) : (
                <p className="text-[13px] text-sw-dim py-4">No spending yet.</p>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

interface SummarySkeletonProps {
    isPublic: boolean;
}

const SummarySkeleton: React.FC<SummarySkeletonProps> = ({ isPublic }) => {
    // 3 rows on auth (per-member list), 1 row on public (group-total header only).
    const rowCount = isPublic ? 1 : 3;
    return (
        <div aria-busy="true" aria-live="polite">
            <div className="flex flex-col gap-3">
                {Array.from({ length: rowCount }).map((_, i) => (
                    <div
                        key={i}
                        className="animate-pulse bg-sw-raise rounded-sw-row"
                        style={{ height: 48 }}
                    />
                ))}
            </div>
            {/* Chart skeleton: h-60 = 240px (mobile), sm:h-80 = 320px (desktop),
                matching SpendingTrendChart's responsive heights. */}
            <div
                className="mt-5 w-full animate-pulse bg-sw-raise rounded-sw-row h-60 sm:h-80"
                aria-hidden="true"
            />
        </div>
    );
};

export default SummarySection;
