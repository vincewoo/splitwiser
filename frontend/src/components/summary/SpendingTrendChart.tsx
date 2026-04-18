import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Bar, BarStack } from '@visx/shape';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import type {
    GroupSummaryMember,
    GroupSummarySeriesPoint,
    PublicGroupSummarySeriesPoint,
    SummaryGranularity,
} from '../../types/summary';
import { formatMoney } from '../../utils/formatters';
import { assignSeriesColors, type AssignedSeries } from './chartPalette';

/**
 * Discriminated union — TypeScript forces the caller to supply `members` for
 * stacked mode (so we can assign colors and render the legend) while the
 * public path passes only `series`.
 */
type SpendingTrendChartProps =
    | {
          mode: 'stacked';
          series: GroupSummarySeriesPoint[];
          members: GroupSummaryMember[];
          granularity: SummaryGranularity;
          currency: string;
      }
    | {
          mode: 'single';
          series: PublicGroupSummarySeriesPoint[];
          granularity: SummaryGranularity;
          currency: string;
      };

const MOBILE_HEIGHT = 240;
const DESKTOP_HEIGHT = 320;
const MOBILE_BREAKPOINT = 640;
const TAP_TARGET = 44;

// Breathing room for axis labels. Left margin accommodates abbreviated money
// tick labels like "$1.2k"; bottom makes room for period labels.
const MARGIN = { top: 16, right: 12, bottom: 40, left: 52 };

/** Abbreviate money values for Y-axis ticks once they exceed 10k. */
const formatMoneyTick = (amountCents: number, currency: string): string => {
    const abs = Math.abs(amountCents);
    if (abs >= 100_000_000) {
        // >= $1M
        return `$${(amountCents / 100_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000_000) {
        // >= $10k
        return `$${(amountCents / 100_000).toFixed(1)}k`;
    }
    return formatMoney(amountCents, currency);
};

const granularityWord = (g: SummaryGranularity): string => {
    if (g === 'week') return 'Weekly';
    if (g === 'month') return 'Monthly';
    return 'Quarterly';
};

/** Build the SVG aria-label from any series that has a `total` field. */
const computeAriaLabel = (
    series: ReadonlyArray<{ period_label: string; period_start: string; total: number }>,
    granularity: SummaryGranularity,
    currency: string,
): string => {
    if (series.length === 0) {
        return `${granularityWord(granularity)} spending chart with no data.`;
    }
    const total = series.reduce((acc, s) => acc + s.total, 0);
    const peak = series.reduce((best, s) => (s.total > best.total ? s : best), series[0]);
    const first = series[0];
    const last = series[series.length - 1];
    return `${granularityWord(granularity)} spending from ${first.period_start} to ${last.period_start}; total ${formatMoney(total, currency)}; peak period ${peak.period_label} at ${formatMoney(peak.total, currency)}.`;
};

interface StackDatum {
    period_label: string;
    period_start: string;
    total: number;
    // Series-key → amount for the datum. Only keys present in `seriesDefs`
    // will be rendered; unknown keys are ignored.
    [key: string]: number | string;
}

/** Build a stack-key identifier for an AssignedSeries. */
const seriesKey = (s: AssignedSeries): string =>
    s.isOverflow ? 'overflow' : `m-${s.user_id}-${s.is_guest ? 'g' : 'u'}`;

/** Track an active tooltip — either period-total (single mode) or segment (stacked). */
interface TooltipState {
    periodIndex: number;
    // Screen-space anchor (SVG local coordinates) for positioning.
    anchorX: number;
    anchorY: number;
    // Bar height so we can decide above vs. below flip.
    barTopY: number;
}

const SpendingTrendChart: React.FC<SpendingTrendChartProps> = (props) => {
    const { series, granularity, currency } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState<number>(0);
    const [isMobile, setIsMobile] = useState<boolean>(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }
        return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
    });
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

    // Measure width via ResizeObserver so the chart re-flows with its container.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => {
            setContainerWidth(el.clientWidth);
        };
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Track mobile/desktop viewport for responsive height + tick density.
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        // Initial value is set via useState initializer, so we only need to
        // subscribe to changes here — calling setIsMobile synchronously would
        // trigger a cascading render for no benefit.
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        }
        // Legacy Safari
        mq.addListener(onChange);
        return () => mq.removeListener(onChange);
    }, []);

    const height = isMobile ? MOBILE_HEIGHT : DESKTOP_HEIGHT;
    // Use a sane default width until the ResizeObserver fires, so the SVG still
    // draws on first paint.
    const width = containerWidth > 0 ? containerWidth : 320;

    const innerWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    const innerHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

    // ------------------------------------------------------------------
    // Data shaping: in stacked mode we normalize the per-period per-member
    // array into an object keyed by series key so BarStack can read it.
    // ------------------------------------------------------------------
    const assignedSeries: AssignedSeries[] = useMemo(() => {
        if (props.mode !== 'stacked') return [];
        return assignSeriesColors(props.members);
    }, [props]);

    const stackKeys: string[] = useMemo(
        () => assignedSeries.map(seriesKey),
        [assignedSeries],
    );

    const stackedData: StackDatum[] = useMemo(() => {
        if (props.mode !== 'stacked') return [];
        // Build a quick lookup for each series definition so we can sum the
        // correct set of member keys (especially for the "Others" overflow).
        return props.series.map((point) => {
            const datum: StackDatum = {
                period_label: point.period_label,
                period_start: point.period_start,
                total: point.total,
            };
            for (const def of assignedSeries) {
                let sum = 0;
                for (const key of def.memberKeys) {
                    const hit = point.per_member.find(
                        (pm) => pm.user_id === key.user_id && pm.is_guest === key.is_guest,
                    );
                    if (hit) sum += hit.amount;
                }
                datum[seriesKey(def)] = sum;
            }
            return datum;
        });
    }, [props, assignedSeries]);

    // Global Y max across all periods; zero-safe so an empty-data chart
    // still renders axes.
    const yMax = useMemo(() => {
        if (series.length === 0) return 1;
        const max = Math.max(...series.map((s) => s.total));
        return max === 0 ? 1 : max;
    }, [series]);

    const xScale = useMemo(
        () =>
            scaleBand<string>({
                domain: series.map((s) => s.period_label),
                range: [0, innerWidth],
                padding: 0.25,
            }),
        [series, innerWidth],
    );

    const yScale = useMemo(
        () =>
            scaleLinear<number>({
                domain: [0, yMax],
                range: [innerHeight, 0],
                nice: true,
            }),
        [yMax, innerHeight],
    );

    const colorFor = useCallback(
        (key: string): string => {
            const def = assignedSeries.find((s) => seriesKey(s) === key);
            return def?.colorVar ?? 'var(--chart-overflow)';
        },
        [assignedSeries],
    );

    // Decide how often to render X tick labels. On mobile, every other tick
    // keeps things from overlapping.
    const xTickValues = useMemo(() => {
        const labels = series.map((s) => s.period_label);
        if (!isMobile) return labels;
        return labels.filter((_, i) => i % 2 === 0);
    }, [series, isMobile]);

    // ------------------------------------------------------------------
    // Tooltip helpers
    // ------------------------------------------------------------------
    const handleBarTap = useCallback(
        (periodIndex: number, barX: number, barY: number, barWidth: number) => {
            setTooltip({
                periodIndex,
                anchorX: MARGIN.left + barX + barWidth / 2,
                anchorY: MARGIN.top + barY,
                barTopY: MARGIN.top + barY,
            });
        },
        [],
    );

    const clearTooltip = useCallback(() => setTooltip(null), []);

    // Build tooltip content — depends on mode
    const tooltipContent = useMemo((): { title: string; lines: string[] } | null => {
        if (!tooltip) return null;
        if (props.mode === 'stacked') {
            const point = props.series[tooltip.periodIndex];
            if (!point) return null;
            const lines: string[] = [];
            for (const def of assignedSeries) {
                let sum = 0;
                for (const key of def.memberKeys) {
                    const hit = point.per_member.find(
                        (pm) => pm.user_id === key.user_id && pm.is_guest === key.is_guest,
                    );
                    if (hit) sum += hit.amount;
                }
                if (sum > 0) {
                    lines.push(`${def.display_name}: ${formatMoney(sum, currency)}`);
                }
            }
            lines.push(`Total: ${formatMoney(point.total, currency)}`);
            return { title: point.period_label, lines };
        }
        const point = props.series[tooltip.periodIndex];
        if (!point) return null;
        return {
            title: point.period_label,
            lines: [`Total: ${formatMoney(point.total, currency)}`],
        };
    }, [tooltip, props, assignedSeries, currency]);

    // Flip tooltip below the bar when the anchor sits too close to the top.
    const tooltipPlacement: 'above' | 'below' = useMemo(() => {
        if (!tooltip) return 'above';
        // Rough estimate: if the bar top is within 40px of the chart top,
        // show the tooltip below the anchor instead.
        return tooltip.barTopY > MARGIN.top + 56 ? 'above' : 'below';
    }, [tooltip]);

    const ariaLabel = useMemo(
        () => computeAriaLabel(series, granularity, currency),
        [series, granularity, currency],
    );

    const bandwidth = xScale.bandwidth();
    // Tap target overlay: minimum 44px wide so a narrow bar still gets a
    // fat-finger-sized touch region centered on its column.
    const tapWidth = Math.max(TAP_TARGET, bandwidth);

    return (
        <div className="w-full">
            <div
                ref={containerRef}
                className="relative w-full"
                style={{ height }}
            >
                <svg
                    role="img"
                    aria-label={ariaLabel}
                    width={width}
                    height={height}
                    className="block overflow-visible"
                >
                    <Group top={MARGIN.top} left={MARGIN.left}>
                        {/* Horizontal gridlines from the Y-axis ticks */}
                        <AxisLeft
                            scale={yScale}
                            numTicks={4}
                            stroke="var(--chart-axis)"
                            tickStroke="var(--chart-axis)"
                            tickFormat={(value) => formatMoneyTick(Number(value), currency)}
                            tickLabelProps={() => ({
                                fill: 'var(--chart-axis-text)',
                                fontSize: 11,
                                textAnchor: 'end',
                                dx: '-0.3em',
                                dy: '0.3em',
                            })}
                        />

                        {/* Bars */}
                        {props.mode === 'stacked' ? (
                            <BarStack<StackDatum, string>
                                data={stackedData}
                                keys={stackKeys}
                                x={(d) => d.period_label}
                                xScale={xScale}
                                yScale={yScale}
                                color={colorFor}
                            >
                                {(barStacks) =>
                                    barStacks.map((barStack) =>
                                        barStack.bars.map((bar) => (
                                            <rect
                                                key={`bar-${barStack.index}-${bar.index}`}
                                                x={bar.x}
                                                y={bar.y}
                                                width={bar.width}
                                                height={bar.height}
                                                fill={bar.color}
                                            />
                                        )),
                                    )
                                }
                            </BarStack>
                        ) : (
                            props.series.map((point, i) => {
                                const bx = xScale(point.period_label) ?? 0;
                                const by = yScale(point.total);
                                const bh = innerHeight - by;
                                return (
                                    <Bar
                                        key={`bar-single-${i}`}
                                        x={bx}
                                        y={by}
                                        width={bandwidth}
                                        height={bh}
                                        fill="var(--chart-color-1)"
                                    />
                                );
                            })
                        )}

                        {/* Invisible tap-target overlays per period. Sits above the bars;
                            each is sized to ≥ 44px so narrow bars still get a fat-finger
                            touch region. */}
                        {series.map((point, i) => {
                            const bx = xScale(point.period_label) ?? 0;
                            const overlayX = bx + bandwidth / 2 - tapWidth / 2;
                            const by = yScale(point.total);
                            return (
                                <rect
                                    key={`tap-${i}`}
                                    x={overlayX}
                                    y={0}
                                    width={tapWidth}
                                    height={innerHeight}
                                    fill="transparent"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => handleBarTap(i, bx, by, bandwidth)}
                                    onMouseEnter={() => handleBarTap(i, bx, by, bandwidth)}
                                    onMouseLeave={clearTooltip}
                                    onFocus={() => handleBarTap(i, bx, by, bandwidth)}
                                    onBlur={clearTooltip}
                                />
                            );
                        })}

                        <AxisBottom
                            top={innerHeight}
                            scale={xScale}
                            tickValues={xTickValues}
                            stroke="var(--chart-axis)"
                            tickStroke="var(--chart-axis)"
                            tickLabelProps={() => ({
                                fill: 'var(--chart-axis-text)',
                                fontSize: 11,
                                textAnchor: 'middle',
                                dy: '0.3em',
                            })}
                        />
                    </Group>
                </svg>

                {/* Tooltip overlay */}
                {tooltip && tooltipContent && (
                    <div
                        role="tooltip"
                        className="pointer-events-none absolute z-10 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
                        style={{
                            left: Math.min(
                                Math.max(tooltip.anchorX - 80, 4),
                                Math.max(4, width - 164),
                            ),
                            top:
                                tooltipPlacement === 'above'
                                    ? Math.max(4, tooltip.barTopY - 56)
                                    : tooltip.barTopY + 12,
                            minWidth: 120,
                            maxWidth: 200,
                        }}
                    >
                        <div className="font-semibold">{tooltipContent.title}</div>
                        <ul className="mt-1 space-y-0.5">
                            {tooltipContent.lines.map((line, i) => (
                                <li key={i} className="tabular-nums">
                                    {line}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Legend — stacked mode only */}
            {props.mode === 'stacked' && assignedSeries.length > 0 && (
                <ul
                    className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-4 sm:gap-y-1"
                    aria-label="Member color legend"
                >
                    {assignedSeries.map((def) => (
                        <li
                            key={seriesKey(def)}
                            className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 min-h-[44px] sm:min-h-0"
                        >
                            <span
                                aria-hidden="true"
                                className="inline-block h-3 w-3 flex-shrink-0 rounded"
                                style={{ background: def.colorVar }}
                            />
                            <span className="truncate">{def.display_name}</span>
                        </li>
                    ))}
                </ul>
            )}

            {/* Visually-hidden data table for screen readers / keyboard users.
                Wrapped in an sr-only <div> because Tailwind's .sr-only relies on
                width:1px/height:1px, which <table> ignores due to its intrinsic
                table-layout sizing — applied to the wrapper div, it correctly
                collapses to a 1×1 absolutely-positioned region. */}
            <div className="sr-only">
              <table>
                <caption>
                    {granularityWord(granularity)} spending breakdown (accessible data table)
                </caption>
                {props.mode === 'stacked' ? (
                    <>
                        <thead>
                            <tr>
                                <th scope="col">Period</th>
                                <th scope="col">Member</th>
                                <th scope="col">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {props.series.flatMap((point) => {
                                const rows: React.ReactElement[] = [];
                                for (const def of assignedSeries) {
                                    let sum = 0;
                                    for (const key of def.memberKeys) {
                                        const hit = point.per_member.find(
                                            (pm) =>
                                                pm.user_id === key.user_id &&
                                                pm.is_guest === key.is_guest,
                                        );
                                        if (hit) sum += hit.amount;
                                    }
                                    rows.push(
                                        <tr key={`${point.period_start}-${seriesKey(def)}`}>
                                            <th scope="row">{point.period_label}</th>
                                            <td>{def.display_name}</td>
                                            <td>{formatMoney(sum, currency)}</td>
                                        </tr>,
                                    );
                                }
                                rows.push(
                                    <tr key={`${point.period_start}-total`}>
                                        <th scope="row">{point.period_label}</th>
                                        <td>Total</td>
                                        <td>{formatMoney(point.total, currency)}</td>
                                    </tr>,
                                );
                                return rows;
                            })}
                        </tbody>
                    </>
                ) : (
                    <>
                        <thead>
                            <tr>
                                <th scope="col">Period</th>
                                <th scope="col">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {props.series.map((point) => (
                                <tr key={point.period_start}>
                                    <th scope="row">{point.period_label}</th>
                                    <td>{formatMoney(point.total, currency)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </>
                )}
              </table>
            </div>
        </div>
    );
};

export default SpendingTrendChart;
