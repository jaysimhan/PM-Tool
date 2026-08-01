import React, { useMemo } from 'react';
import { getTagStyle } from '../utils/colors';

interface DistributionData {
  name: string;
  favicon?: string;
  flag?: string;
  color?: string;
  NewRequests: number;
  Planning: number;
  InProgress: number;
  InReview: number;
  OnHold: number;
  Completed: number;
  Total: number;
}

interface Props {
  data: DistributionData[];
  title: string;
}

export default function DistributionChart({ data, title }: Props) {
  const { maxTotal, yTicks, chartHeight } = useMemo(() => {
    const maxVal = Math.max(...data.map(d => d.Total), 10);
    const maxValue = Math.ceil(maxVal / 10) * 10;
    
    const ticks = [];
    for (let i = maxValue; i >= 0; i -= Math.max(maxValue / 5, 5)) {
      ticks.push(Math.round(i));
    }
    
    return { maxTotal: maxValue, yTicks: ticks, chartHeight: 200 };
  }, [data]);

  const getColor = (name: string) => {
    const colors = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 h-full flex flex-col">
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">Tasks by stage over selected timeframe</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 mt-0.5 max-w-[60%]">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-400" />
            <span className="text-xs text-gray-500">New Request</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-500" />
            <span className="text-xs text-gray-500">Planning</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" />
            <span className="text-xs text-gray-500">In Progress</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-500" />
            <span className="text-xs text-gray-500">In Review</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />
            <span className="text-xs text-gray-500">On Hold</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            <span className="text-xs text-gray-500">Completed</span>
          </div>
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
                {data.map((d, i) => {
                  const totalH = (d.Total / maxTotal) * chartHeight;
                  return (
                    <div
                      key={d.name}
                      className="flex-1 flex items-end justify-center relative z-10 group"
                    >
                      {/* Tooltip trigger area */}
                      <div className="absolute inset-0 z-20 cursor-pointer" title={`${d.name}\nTotal: ${d.Total}\nNew Request: ${d.NewRequests}\nPlanning: ${d.Planning}\nIn Progress: ${d.InProgress}\nIn Review: ${d.InReview}\nOn Hold: ${d.OnHold}\nCompleted: ${d.Completed}`} />
                      
                      <div 
                        className="w-7 flex flex-col-reverse justify-start rounded-t-md overflow-hidden transition-all group-hover:brightness-95" 
                        style={{ height: totalH }}
                      >
                        {d.Total > 0 && d.Completed > 0 && (
                          <div className="w-full bg-emerald-500 flex items-center justify-center overflow-hidden min-h-[14px]" style={{ height: `${(d.Completed / d.Total) * 100}%` }}>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.Completed}</span>
                          </div>
                        )}
                        {d.Total > 0 && d.InProgress > 0 && (
                          <div className="w-full bg-blue-500 flex items-center justify-center overflow-hidden min-h-[14px]" style={{ height: `${(d.InProgress / d.Total) * 100}%` }}>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.InProgress}</span>
                          </div>
                        )}
                        {d.Total > 0 && d.Planning > 0 && (
                          <div className="w-full bg-purple-500 flex items-center justify-center overflow-hidden min-h-[14px]" style={{ height: `${(d.Planning / d.Total) * 100}%` }}>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.Planning}</span>
                          </div>
                        )}
                        {d.Total > 0 && d.InReview > 0 && (
                          <div className="w-full bg-yellow-500 flex items-center justify-center overflow-hidden min-h-[14px]" style={{ height: `${(d.InReview / d.Total) * 100}%` }}>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.InReview}</span>
                          </div>
                        )}
                        {d.Total > 0 && d.OnHold > 0 && (
                          <div className="w-full bg-red-500 flex items-center justify-center overflow-hidden min-h-[14px]" style={{ height: `${(d.OnHold / d.Total) * 100}%` }}>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.OnHold}</span>
                          </div>
                        )}
                        {d.Total > 0 && d.NewRequests > 0 && (
                          <div className="w-full bg-gray-400 flex items-center justify-center overflow-hidden min-h-[14px]" style={{ height: `${(d.NewRequests / d.Total) * 100}%` }}>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-white leading-none drop-shadow-sm transition-opacity">{d.NewRequests}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Brand labels */}
            <div className="flex mt-3">
              {data.map((b) => (
                <div
                  key={b.name}
                  className="flex-1 flex flex-col items-center gap-1.5 overflow-hidden px-1"
                  title={b.name}
                >
                  {b.favicon ? (
                    <img src={b.favicon} alt={b.name} className="w-7 h-7 object-contain rounded-md shrink-0 bg-white" />
                  ) : b.flag ? (
                    <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-xl border border-gray-100 bg-gray-50 leading-none pb-0.5 shadow-sm">
                      {b.flag}
                    </div>
                  ) : (
                    <div
                      className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0 shadow-sm ${b.color ? getTagStyle(b.color).className : 'text-white'}`}
                      style={b.color ? getTagStyle(b.color).style : { backgroundColor: getColor(b.name) }}
                    >
                      {getInitials(b.name)}
                    </div>
                  )}
                  <span className="text-[10px] text-gray-500 font-medium truncate w-full text-center">
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
