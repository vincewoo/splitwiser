import React, { useMemo, useRef, useState } from 'react';
import type { GroupSummaryResponse, GroupSummaryMember } from '../../types/summary';
import { formatMoney } from '../../utils/formatters';

interface MemberConsumptionTableProps {
    response: GroupSummaryResponse;
    currentUserId: number | null;
}

const granularityLabel = (granularity: GroupSummaryResponse['granularity']): string => {
    if (granularity === 'week') return 'Weekly breakdown';
    if (granularity === 'month') return 'Monthly breakdown';
    return 'Quarterly breakdown';
};

const memberKey = (member: Pick<GroupSummaryMember, 'user_id' | 'is_guest'>): string =>
    `${member.user_id}-${member.is_guest}`;

const initialFor = (displayName: string): string => {
    const trimmed = displayName.trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
};

const MemberConsumptionTable: React.FC<MemberConsumptionTableProps> = ({ response, currentUserId }) => {
    const { members, group_total, currency, granularity, has_synthesized_historical_rate } = response;

    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
    const toggleButtonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

    // Sort: current user pinned first (match by user_id AND is_guest === false), then
    // preserve the server's descending-by-total order for the rest.
    const sortedMembers = useMemo<GroupSummaryMember[]>(() => {
        if (currentUserId == null) return members;
        const youIndex = members.findIndex(
            (m) => m.user_id === currentUserId && m.is_guest === false
        );
        if (youIndex === -1) return members;
        const you = members[youIndex];
        const rest = members.filter((_, i) => i !== youIndex);
        return [you, ...rest];
    }, [members, currentUserId]);

    const toggleExpanded = (key: string) => {
        setExpandedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
        // Keep keyboard focus on the toggle button after state update
        requestAnimationFrame(() => {
            const btn = toggleButtonRefs.current.get(key);
            btn?.focus();
        });
    };

    // Empty state: do NOT render the header total.
    if (members.length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded">
                <p className="text-center text-sm text-gray-500 dark:text-gray-400 italic py-6">
                    No spending yet — add an expense to see the summary.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded">
            {/* Header: group total + granularity + optional synthesized-rate note */}
            <div className="pb-4">
                <div className="text-3xl lg:text-4xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    {formatMoney(group_total, currency)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {granularityLabel(granularity)}
                </div>
                {has_synthesized_historical_rate && (
                    <p className="text-xs italic text-gray-500 dark:text-gray-400 mt-2">
                        One or more historical exchange rates were synthesized from current data.
                    </p>
                )}
            </div>

            {/* Per-member rows */}
            <ul role="list" className="border-t dark:border-gray-700">
                {sortedMembers.map((member) => {
                    const key = memberKey(member);
                    const hasManaged = member.managed_members && member.managed_members.length > 0;
                    const isExpanded = expandedKeys.has(key);
                    const isYou =
                        currentUserId != null &&
                        member.user_id === currentUserId &&
                        member.is_guest === false;
                    const displayName = isYou ? 'You' : member.display_name;
                    const subrowsId = `member-managed-${key}`;

                    return (
                        <li
                            key={key}
                            role="listitem"
                            className="border-b last:border-b-0 dark:border-gray-700"
                        >
                            <div className="flex items-center justify-between py-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    {/* Avatar placeholder */}
                                    <div
                                        className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-700 dark:text-gray-200"
                                        aria-hidden="true"
                                    >
                                        {initialFor(displayName)}
                                    </div>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                            {displayName}
                                        </span>
                                        {hasManaged && (
                                            <button
                                                ref={(el) => {
                                                    toggleButtonRefs.current.set(key, el);
                                                }}
                                                type="button"
                                                onClick={() => toggleExpanded(key)}
                                                aria-expanded={isExpanded}
                                                aria-controls={subrowsId}
                                                aria-label={
                                                    isExpanded
                                                        ? `Collapse managed members for ${displayName}`
                                                        : `Expand managed members for ${displayName}`
                                                }
                                                className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500 rounded"
                                            >
                                                <span className="text-lg leading-none" aria-hidden="true">
                                                    {isExpanded ? '−' : '+'}
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums flex-shrink-0 ml-3">
                                    {formatMoney(member.total, currency)}
                                </span>
                            </div>

                            {hasManaged && isExpanded && (
                                <ul
                                    id={subrowsId}
                                    role="list"
                                    className="pl-11 pb-3 space-y-1"
                                >
                                    {member.managed_members.map((mm, idx) => (
                                        <li
                                            key={`${key}-managed-${idx}`}
                                            role="listitem"
                                            className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"
                                        >
                                            <span className="truncate">— {mm.display_name}</span>
                                            <span className="tabular-nums ml-3 flex-shrink-0">
                                                {formatMoney(mm.total, currency)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default MemberConsumptionTable;
