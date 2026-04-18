import React from 'react';
import { formatMoney } from '../../utils/formatters';
import type { SummaryGranularity } from '../../types/summary';
import { granularityLabel } from './granularity';

interface SummaryHeaderProps {
    groupTotal: number;
    currency: string;
    granularity: SummaryGranularity;
    hasSynthesizedHistoricalRate: boolean;
}

const SummaryHeader: React.FC<SummaryHeaderProps> = ({
    groupTotal,
    currency,
    granularity,
    hasSynthesizedHistoricalRate,
}) => (
    <div className="pb-4">
        <div className="text-3xl lg:text-4xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
            {formatMoney(groupTotal, currency)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {granularityLabel(granularity)}
        </div>
        {hasSynthesizedHistoricalRate && (
            <p className="text-xs italic text-gray-500 dark:text-gray-400 mt-2">
                One or more historical exchange rates were synthesized from current data.
            </p>
        )}
    </div>
);

export default SummaryHeader;
