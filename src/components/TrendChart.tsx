import React, { useMemo } from 'react';
import { DashboardStats } from '../lib/dashboardStats';

/**
 * How the org moved across the selected range, one point per nightly snapshot.
 *
 * This is what the time-range control means now. It used to filter the task list by creation
 * date and recount; there is no task list on this page any more, so a range is a window of
 * days and the question it answers is "what changed over these days" rather than "what was
 * created during them".
 *
 * Drawn by hand rather than with recharts, like the two charts either side of it. That is not
 * a stylistic preference: recharts is ~370KB and nothing else on this route imports it, so
 * pulling it in for one line chart tripled the dashboard's bundle. Four polylines over a
 * linear scale do not need a charting library.
 *
 * A range with one day in it is not a trend, so the chart says so rather than drawing a
 * single dot and calling it a line.
 */

interface Props {
    series: { date: string; stats: DashboardStats }[];
    title?: string;
}

const SERIES = [
    { key: 'totalRequests' as const, name: 'Total', color: '#6B7280' },
    { key: 'activeTasks' as const, name: 'Active', color: '#3B82F6' },
    { key: 'completed' as const, name: 'Completed', color: '#10B981' },
    { key: 'overdueTasks' as const, name: 'Overdue', color: '#EF4444' },
];

const WIDTH = 800;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

function TrendChart({ series, title = 'Trend' }: Props) {
    const model = useMemo(() => {
        if (series.length < 2) return null;

        const points = series.map(p => ({
            label: new Date(`${p.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
            values: {
                totalRequests: p.stats.totalRequests,
                activeTasks: p.stats.activeTasks,
                completed: p.stats.completed,
                overdueTasks: p.stats.overdueTasks,
            },
        }));

        const peak = Math.max(10, ...points.flatMap(p => Object.values(p.values)));
        // Round up to something a tick label reads nicely at.
        const step = Math.max(1, Math.ceil(peak / 4));
        const max = step * 4;

        const plotW = WIDTH - PAD.left - PAD.right;
        const plotH = HEIGHT - PAD.top - PAD.bottom;
        const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
        const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

        return {
            points,
            ticks: [0, 1, 2, 3, 4].map(i => ({ value: i * step, y: y(i * step) })),
            lines: SERIES.map(s => ({
                ...s,
                d: points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.values[s.key]).toFixed(1)}`).join(' '),
            })),
            // At most eight date labels, however long the range is.
            xLabels: points
                .map((p, i) => ({ label: p.label, x: x(i), i }))
                .filter((_, i) => i % Math.ceil(points.length / 8) === 0 || i === points.length - 1),
        };
    }, [series]);

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                {model && (
                    <div className="flex items-center gap-4">
                        {SERIES.map(s => (
                            <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-600">
                                <span className="w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
                                {s.name}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {!model ? (
                <div className="h-[220px] flex items-center justify-center text-center px-6">
                    <p className="text-sm text-gray-500 max-w-md">
                        {series.length === 0
                            ? 'No snapshots in this range yet.'
                            : 'Only one day of history so far.'}{' '}
                        A snapshot is taken each night, so this fills in a day at a time.
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <svg
                        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                        className="w-full h-[220px]"
                        role="img"
                        aria-label={`${title}: ${SERIES.map(s => s.name).join(', ')} over ${model.points.length} days`}
                    >
                        {model.ticks.map(t => (
                            <g key={t.value}>
                                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.y} y2={t.y} stroke="#F3F4F6" strokeWidth={1} />
                                <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize={11} fill="#6B7280">
                                    {t.value}
                                </text>
                            </g>
                        ))}

                        {model.xLabels.map(l => (
                            <text key={l.i} x={l.x} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill="#6B7280">
                                {l.label}
                            </text>
                        ))}

                        {model.lines.map(line => (
                            <path
                                key={line.key}
                                d={line.d}
                                fill="none"
                                stroke={line.color}
                                strokeWidth={2}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        ))}
                    </svg>
                </div>
            )}
        </div>
    );
}

export default React.memo(TrendChart);
