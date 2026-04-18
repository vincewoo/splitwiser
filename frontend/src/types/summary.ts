// Shared types for the group spending summary feature.
// All monetary values are integer cents to match the existing Balances path.

export type SummaryGranularity = 'week' | 'month' | 'quarter';

export interface GroupSummaryManagedMember {
    display_name: string;
    total: number;
}

export interface GroupSummarySeriesPointMember {
    user_id: number;
    is_guest: boolean;
    amount: number;
}

export interface GroupSummarySeriesPoint {
    period_label: string;
    period_start: string;
    total: number;
    per_member: GroupSummarySeriesPointMember[];
}

export interface GroupSummaryMember {
    user_id: number;
    is_guest: boolean;
    display_name: string;
    total: number;
    managed_members: GroupSummaryManagedMember[];
}

export interface GroupSummaryResponse {
    group_total: number;
    currency: string;
    granularity: SummaryGranularity;
    has_synthesized_historical_rate: boolean;
    members: GroupSummaryMember[];
    series: GroupSummarySeriesPoint[];
}

export interface PublicGroupSummarySeriesPoint {
    period_label: string;
    period_start: string;
    total: number;
}

export interface PublicGroupSummaryResponse {
    group_total: number;
    currency: string;
    granularity: SummaryGranularity;
    has_synthesized_historical_rate: boolean;
    series: PublicGroupSummarySeriesPoint[];
}
