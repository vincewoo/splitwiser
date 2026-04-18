import React, { useCallback, useEffect, useState } from 'react';
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
}

type SummaryResponse = GroupSummaryResponse | PublicGroupSummaryResponse;

/**
 * Collapsible Summary section. Mirrors the Balances card pattern in
 * GroupDetailPage: same outer classes, aria-expanded/aria-controls toggle,
 * +/- indicator. Fetches on first expansion and caches the response for the
 * remainder of the session.
 */
const SummarySection: React.FC<SummarySectionProps> = ({ groupId, shareLinkId, currentUserId }) => {
    const isPublic = !!shareLinkId;
    const [isExpanded, setIsExpanded] = useState(false);
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

    // Fetch on first expansion (not on mount). Guard against refetching across
    // expand/collapse cycles by checking that we don't already have data and
    // aren't mid-flight. React 19 strict mode double-invokes effects; the
    // `response || isLoading` guard keeps us from issuing a duplicate request.
    useEffect(() => {
        if (!isExpanded) return;
        if (response || isLoading || error) return;
        fetchSummary();
    }, [isExpanded, response, isLoading, error, fetchSummary]);

    const handleRetry = () => {
        // Retry directly rather than relying on the effect — the effect's
        // response/isLoading guards keep it idle here.
        setError(null);
        fetchSummary();
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded shadow-sm dark:shadow-gray-900/50 mb-4">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-4 lg:p-6 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700 rounded"
                aria-expanded={isExpanded}
                aria-controls="summary-section-content"
            >
                <h2 className="text-base lg:text-lg font-medium text-gray-900 dark:text-gray-100">
                    Summary
                </h2>
                <span className="text-gray-400 dark:text-gray-500 text-xl" aria-hidden="true">
                    {isExpanded ? '−' : '+'}
                </span>
            </button>

            {isExpanded && (
                <div
                    id="summary-section-content"
                    className="px-4 lg:px-6 pb-4 lg:pb-6 border-t dark:border-gray-700"
                >
                    {isLoading && (
                        <SummarySkeleton isPublic={isPublic} />
                    )}

                    {error && !isLoading && (
                        <div
                            role="alert"
                            aria-live="assertive"
                            className="mt-4 flex flex-col items-start gap-3 text-sm"
                        >
                            <p className="text-red-600 dark:text-red-400">
                                {error}
                            </p>
                            <button
                                type="button"
                                onClick={handleRetry}
                                aria-label="Retry loading summary"
                                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {!isLoading && !error && response && (
                        <div className="mt-4">
                            {isPublic ? (
                                <PublicSummaryContent response={response as PublicGroupSummaryResponse} />
                            ) : (
                                <AuthSummaryContent
                                    response={response as GroupSummaryResponse}
                                    currentUserId={currentUserId}
                                />
                            )}
                        </div>
                    )}
                </div>
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
                <div className="mt-6">
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
                <p className="text-sm italic text-gray-500 dark:text-gray-400 py-4">
                    No spending yet.
                </p>
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
        <div className="mt-4" aria-busy="true" aria-live="polite">
            <div className="space-y-3">
                {Array.from({ length: rowCount }).map((_, i) => (
                    <div
                        key={i}
                        className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded"
                        style={{ height: 48 }}
                    />
                ))}
            </div>
            {/* Chart skeleton: h-60 = 240px (mobile), sm:h-80 = 320px (desktop),
                matching SpendingTrendChart's responsive heights. */}
            <div
                className="mt-6 w-full animate-pulse bg-gray-200 dark:bg-gray-700 rounded h-60 sm:h-80"
                aria-hidden="true"
            />
        </div>
    );
};

export default SummarySection;
