import React from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type Status = 'New Request' | 'Planning' | 'In Progress' | 'In Review' | 'On Hold' | 'Completed';
export type Brand = 'CareStack' | 'VoiceStack' | 'OS Dental' | 'ACE DSN' | 'Aeka';
export type Region = 'USA' | 'UK' | 'AU';
export type ViewMode = 'calendar' | 'list' | 'board' | 'timeline';
export type TimeScale = 'Day' | 'Week' | 'Month';

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  urgent: { label: 'Urgent',  color: '#ef4444' },
  high:   { label: 'High',    color: '#f97316' },
  normal: { label: 'Normal',  color: '#3b82f6' },
  low:    { label: 'Low',     color: '#94a3b8' },
};

export const STATUS_CONFIG: Record<string, { color: string }> = {
  'New Request': { color: '#94a3b8' },
  'Planning':    { color: '#3b82f6' },
  'In Progress': { color: '#10b981' },
  'In Review':   { color: '#f59e0b' },
  'On Hold':     { color: '#ef4444' },
  'Completed':   { color: '#111827' },
  'new_request': { color: '#94a3b8' },
  'scheduled':   { color: '#3b82f6' },
  'in_progress': { color: '#10b981' },
  'in_review':   { color: '#f59e0b' },
  'on_hold':     { color: '#ef4444' },
  'completed':   { color: '#111827' },
};

export const BRAND_CONFIG: Record<Brand, { color: string }> = {
  'CareStack':  { color: '#6366f1' },
  'VoiceStack': { color: '#0ea5e9' },
  'OS Dental':  { color: '#10b981' },
  'ACE DSN':    { color: '#f59e0b' },
  'Aeka':       { color: '#ec4899' },
};

export const REGION_CONFIG: Record<Region, { flag: string }> = {
  USA: { flag: '🇺🇸' },
  UK:  { flag: '🇬🇧' },
  AU:  { flag: '🇦🇺' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export function loadColor(pct: number) {
  if (pct > 1)  return '#ef4444';
  if (pct >= 0.8)  return '#f59e0b';
  if (pct >= 0.5) return '#3b82f6';
  return '#10b981';
}

export function loadLabel(pct: number) {
  if (pct > 1)    return 'Over';
  if (pct >= 0.8) return 'Near cap.';
  if (pct >= 0.5) return 'Balanced';
  return 'Available';
}

// ── Flag icon — filled for urgent/high, outlined for normal/low ───────────────
export function FlagIcon({ filled, color }: { filled: boolean; color: string }) {
  return filled ? (
    <svg width="11" height="12" viewBox="0 0 11 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 1v10M1.5 1.5h7.2c.4 0 .6.45.35.75L6.8 5.5l2.25 3.25c.25.3.05.75-.35.75H1.5" fill={color} stroke={color} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ) : (
    <svg width="11" height="12" viewBox="0 0 11 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 1v10M1.5 1.5h7.2c.4 0 .6.45.35.75L6.8 5.5l2.25 3.25c.25.3.05.75-.35.75H1.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Pill — unified filter toggle ──────────────────────────────────────────────
export function PriorityPill({ priority, active, onClick }: {
  priority: Priority; active: boolean; onClick: () => void;
}) {
  const { label, color } = PRIORITY_CONFIG[priority];
  const filled = priority === 'urgent' || priority === 'high';
  const iconColor = active ? color : '#cbd5e1';
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium transition-all duration-150 whitespace-nowrap"
      style={{
        backgroundColor: active ? `${color}12` : 'transparent',
        color:           active ? color         : '#9ca3af',
        border:          active ? `1px solid ${color}30` : '1px solid transparent',
      }}
    >
      <FlagIcon filled={filled} color={iconColor} />
      {label}
    </button>
  );
}

export function Pill({ label, color, active, onClick, prefix, dot = false, logoUrl }: {
  label: string; color: string; active: boolean; onClick: () => void; prefix?: string; dot?: boolean; logoUrl?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium transition-all duration-150 whitespace-nowrap"
      style={{
        backgroundColor: active ? `${color}15` : 'transparent',
        color:           active ? color : '#374151',
        border:          active ? `1px solid ${color}30` : '1px solid transparent',
      }}
    >
      {logoUrl && <img src={logoUrl} alt="" className="w-3.5 h-3.5 object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      {prefix}{label}
    </button>
  );
}

// ── Capacity bar ──────────────────────────────────────────────────────────────
export function CapBar({ hours, capacity, isLeave = false }: { hours: number; capacity: number; isLeave?: boolean }) {
  if (isLeave) {
    return (
      <div className="relative h-7 rounded-md overflow-hidden cursor-default" style={{ backgroundColor: '#e5e7eb' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] font-medium" style={{ color: '#6b7280' }}>
            On Leave
          </span>
        </div>
      </div>
    );
  }

  const pct      = capacity > 0 ? hours / capacity : 0;
  const fill     = Math.min(pct, 1) * 100;
  const overflow = pct > 1 ? (pct - 1) * 100 : 0;
  const color    = loadColor(pct);
  const label    = hours > 0
    ? `${hours % 1 === 0 ? hours : hours.toFixed(1)}h / ${capacity}h`
    : `0h / ${capacity}h`;
    
  return (
    <div className="relative h-7 rounded-md overflow-hidden cursor-default" style={{ backgroundColor: '#f3f4f6' }}>
      {pct > 0 && (
        <div className="absolute inset-y-0 left-0 transition-all duration-300" style={{ width: `${fill}%`, backgroundColor: color }} />
      )}
      {overflow > 0 && (
        <div className="absolute inset-y-0" style={{ left: '100%', width: `${overflow}%`, backgroundColor: '#fca5a5' }} />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-medium tabular-nums" style={{ color: '#364153' }}>
          {label}
        </span>
      </div>
    </div>
  );
}

// ── View icons ────────────────────────────────────────────────────────────────
export const ViewIcons = {
  calendar: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>
    </svg>
  ),
  list: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>
    </svg>
  ),
  board: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/>
      <rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>
    </svg>
  ),
  timeline: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 5h12"/><path d="M4 12h10"/><path d="M12 19h8"/>
    </svg>
  ),
};
