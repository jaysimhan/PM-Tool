import React, { useMemo } from 'react';

interface StatusData {
  name: string;
  count: number;
  color: string;
}

interface Props {
  data: StatusData[];
  title: string;
}

/**
 * Memoised because the dashboard around it re-renders on a timer. The public dashboard swaps
 * one team card every 4.5 seconds, and without this each of those ticks re-rendered every
 * chart on the page as well. The data prop is built inside a useMemo upstream, so the
 * identity is stable and this actually holds.
 */
function StatusComparisonChart({ data, title }: Props) {
  const { maxTotal, yTicks, chartHeight } = useMemo(() => {
    const maxVal = Math.max(...data.map(d => d.count), 10);
    const maxValue = Math.ceil(maxVal / 10) * 10;
    
    const ticks = [];
    for (let i = maxValue; i >= 0; i -= Math.max(maxValue / 5, 5)) {
      ticks.push(Math.round(i));
    }
    
    return { maxTotal: maxValue, yTicks: ticks, chartHeight: 200 };
  }, [data]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 h-full flex flex-col">
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">Overall task distribution by status</p>
        </div>
      </div>

      <div className="px-6 pb-5 pt-4 flex-1">
        <div className="flex gap-3 h-full">
          {/* Y-axis */}
          <div
            className="flex flex-col justify-between items-end shrink-0 w-6 pb-9"
            style={{ height: `${chartHeight + 36}px` }}
          >
            {yTicks.map((v) => (
              <span key={v} className="text-[10px] leading-none text-gray-400">
                {v}
              </span>
            ))}
          </div>

          {/* Bars + grid */}
          <div className="flex-1 flex flex-col">
            <div className="relative" style={{ height: chartHeight }}>
              {/* Grid lines */}
              {yTicks.map((v) => (
                <div
                  key={v}
                  className="absolute left-0 right-0"
                  style={{ bottom: `${(v / maxTotal) * 100}%` }}
                >
                  <div className={`border-t ${v === 0 ? "border-gray-300" : "border-dashed border-gray-100"}`} />
                </div>
              ))}

              {/* Bar columns */}
              <div className="absolute inset-0 flex items-end">
                {data.map((d) => {
                  const totalH = (d.count / maxTotal) * chartHeight;
                  return (
                    <div
                      key={d.name}
                      className="flex-1 flex items-end justify-center relative z-10 group"
                    >
                      <div className="absolute inset-0 z-20 cursor-pointer" title={`${d.name}: ${d.count}`} />
                      
                      <div 
                        className="w-12 flex flex-col-reverse justify-start rounded-t-md overflow-hidden transition-all group-hover:brightness-95" 
                        style={{ height: totalH, backgroundColor: d.color }}
                      >
                        {d.count > 0 && (
                          <div className="w-full h-full flex items-center justify-center overflow-hidden">
                            <span className="opacity-0 group-hover:opacity-100 text-[11px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.count}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Labels */}
            <div className="flex mt-3">
              {data.map((b) => (
                <div
                  key={b.name}
                  className="flex-1 flex flex-col items-center gap-1.5 overflow-hidden px-1"
                  title={b.name}
                >
                  <span className="text-[11px] text-gray-600 font-medium truncate w-full text-center mt-2">
                    {b.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(StatusComparisonChart);
