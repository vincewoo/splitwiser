import type { SummaryGranularity } from '../../types/summary';

/** Title-cased granularity adjective: "Weekly" | "Monthly" | "Quarterly". */
export const granularityWord = (g: SummaryGranularity): string => {
    if (g === 'week') return 'Weekly';
    if (g === 'month') return 'Monthly';
    return 'Quarterly';
};

/** Full-sentence label used in headers: "Weekly breakdown", etc. */
export const granularityLabel = (g: SummaryGranularity): string => {
    if (g === 'week') return 'Weekly breakdown';
    if (g === 'month') return 'Monthly breakdown';
    return 'Quarterly breakdown';
};
