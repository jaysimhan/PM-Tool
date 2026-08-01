import { useState, Fragment } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type Priority = 'urgent' | 'high' | 'normal' | 'low'
type Status = 'New Request' | 'Planning' | 'In Progress' | 'In Review' | 'On Hold' | 'Completed'
type Brand = 'CareStack' | 'VoiceStack' | 'OS Dental' | 'ACE DSN' | 'Aeka'
type Region = 'USA' | 'UK' | 'AU'
type ViewMode = 'capacity' | 'list' | 'board' | 'timeline'
type TimeScale = 'Day' | 'Week' | 'Month'

interface DayLoad { hours: number; capacity: number }

interface Member {
  id: string; name: string; initials: string; color: string
  role: string; badge?: string; team: string; teamId: string
  days: DayLoad[]
}

interface FilterState {
  priorities: Set<Priority>; statuses: Set<Status>
  brands: Set<Brand>; regions: Set<Region>
  teamId: string; showWeekends: boolean
  timeScale: TimeScale; view: ViewMode
}

// ── Static data ───────────────────────────────────────────────────────────────

const WEEK_DAYS    = [{ label: 'Mon', date: 27 }, { label: 'Tue', date: 28 }, { label: 'Wed', date: 29 }, { label: 'Thu', date: 30 }, { label: 'Fri', date: 31 }]
const WEEKEND_DAYS = [{ label: 'Sat', date: 1  }, { label: 'Sun', date: 2  }]
const TEAMS = [{ id: 'all', name: 'All Teams' }, { id: '5671ff94', name: 'General Marketing' }, { id: 'da91d278', name: 'Design' }]

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  urgent: { label: 'Urgent',  color: '#ef4444' },
  high:   { label: 'High',    color: '#f97316' },
  normal: { label: 'Normal',  color: '#3b82f6' },
  low:    { label: 'Low',     color: '#94a3b8' },
}
const STATUS_CONFIG: Record<Status, { color: string }> = {
  'New Request': { color: '#94a3b8' },
  'Planning':    { color: '#3b82f6' },
  'In Progress': { color: '#3b82f6' },
  'In Review':   { color: '#f59e0b' },
  'On Hold':     { color: '#ef4444' },
  'Completed':   { color: '#10b981' },
}
const BRAND_CONFIG: Record<Brand, { color: string }> = {
  'CareStack':  { color: '#6366f1' },
  'VoiceStack': { color: '#0ea5e9' },
  'OS Dental':  { color: '#10b981' },
  'ACE DSN':    { color: '#f59e0b' },
  'Aeka':       { color: '#ec4899' },
}
const REGION_CONFIG: Record<Region, { flag: string }> = {
  USA: { flag: '🇺🇸' },
  UK:  { flag: '🇬🇧' },
  AU:  { flag: '🇦🇺' },
}

const MEMBERS: Member[] = [
  { id: '1', name: 'Jay Simhan',     initials: 'JS', color: '#7c3aed', role: 'General Marketing', badge: 'Super Admin', team: 'General Marketing', teamId: '5671ff94', days: [{hours:0,capacity:8},{hours:0,capacity:8},{hours:0,capacity:8},{hours:0,capacity:8},{hours:0,capacity:8},{hours:0,capacity:8},{hours:0,capacity:8}] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadColor(pct: number) {
  if (pct > 0.8)  return '#ef4444'
  if (pct > 0.5)  return '#f59e0b'
  if (pct > 0.25) return '#3b82f6'
  return '#10b981'
}
function loadLabel(pct: number) {
  if (pct > 1)    return 'Over'
  if (pct >= 0.8) return 'Near cap.'
  if (pct >= 0.5) return 'Balanced'
  return 'Available'
}
function countLoad(members: Member[], days: number, pred: (p: number) => boolean) {
  return members.filter(m => {
    const h = m.days.slice(0, days).reduce((s, d) => s + d.hours, 0)
    const c = m.days.slice(0, days).reduce((s, d) => s + d.capacity, 0)
    return pred(c > 0 ? h / c : 0)
  }).length
}

// ── Flag icon — filled for urgent/high, outlined for normal/low ───────────────

function FlagIcon({ filled, color }: { filled: boolean; color: string }) {
  return filled ? (
    <svg width="11" height="12" viewBox="0 0 11 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 1v10M1.5 1.5h7.2c.4 0 .6.45.35.75L6.8 5.5l2.25 3.25c.25.3.05.75-.35.75H1.5" fill={color} stroke={color} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ) : (
    <svg width="11" height="12" viewBox="0 0 11 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 1v10M1.5 1.5h7.2c.4 0 .6.45.35.75L6.8 5.5l2.25 3.25c.25.3.05.75-.35.75H1.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ── Pill — unified filter toggle ──────────────────────────────────────────────

function PriorityPill({ priority, active, onClick }: {
  priority: Priority; active: boolean; onClick: () => void
}) {
  const { label, color } = PRIORITY_CONFIG[priority]
  const filled = priority === 'urgent' || priority === 'high'
  const iconColor = active ? color : '#cbd5e1'
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
  )
}

function Pill({ label, color, active, onClick, prefix, dot = false }: {
  label: string; color: string; active: boolean; onClick: () => void; prefix?: string; dot?: boolean
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
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      {prefix}{label}
    </button>
  )
}

// ── Capacity bar ──────────────────────────────────────────────────────────────

function CapBar({ hours, capacity }: { hours: number; capacity: number }) {
  const pct      = capacity > 0 ? hours / capacity : 0
  const fill     = Math.min(pct, 1) * 100
  const overflow = pct > 1 ? (pct - 1) * 100 : 0
  const color    = loadColor(pct)
  const label    = hours > 0
    ? `${hours % 1 === 0 ? hours : hours.toFixed(1)}h / ${capacity}h`
    : `0h / ${capacity}h`
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
  )
}

// ── View icons ────────────────────────────────────────────────────────────────

const ViewIcons = {
  capacity: (
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
}

// ── Default state ─────────────────────────────────────────────────────────────

const DEFAULT: FilterState = {
  priorities: new Set(), statuses: new Set(),
  brands: new Set(),     regions: new Set(),
  teamId: 'all', showWeekends: false,
  timeScale: 'Week', view: 'capacity',
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function TeamWorkload() {
  const [f, setF]           = useState<FilterState>(DEFAULT)
  const [showFilters, setShowFilters] = useState(false)

  function set(p: Partial<FilterState>) { setF(prev => ({ ...prev, ...p })) }

  function toggle<T>(key: keyof FilterState, val: T) {
    const prev = f[key] as Set<T>
    const next = new Set(prev)
    next.has(val) ? next.delete(val) : next.add(val)
    set({ [key]: next } as Partial<FilterState>)
  }

  function clear() {
    set({ priorities: new Set(), statuses: new Set(), brands: new Set(), regions: new Set() })
  }

  const members = MEMBERS.filter(m => f.teamId === 'all' || m.teamId === f.teamId)
  const days    = f.showWeekends ? [...WEEK_DAYS, ...WEEKEND_DAYS] : WEEK_DAYS
  const n       = days.length

  const stats = {
    total:     members.length,
    available: countLoad(members, n, p => p < 0.5),
    near:      countLoad(members, n, p => p >= 0.8 && p <= 1),
    over:      countLoad(members, n, p => p > 1),
  }

  const teamNames  = [...new Set(members.map(m => m.team))]
  const teamColors: Record<string, string> = { 'General Marketing': '#f97316', 'Design': '#6366f1' }
  const grouped    = teamNames.map(name => ({
    name, color: teamColors[name] ?? '#94a3b8',
    members: members.filter(m => m.team === name),
  }))

  const activeCount = f.priorities.size + f.statuses.size + f.brands.size + f.regions.size

  const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low']
  const STATUSES:   Status[]   = ['New Request', 'Planning', 'In Progress', 'In Review', 'On Hold', 'Completed']
  const BRANDS:     Brand[]    = ['CareStack', 'VoiceStack', 'OS Dental', 'ACE DSN', 'Aeka']
  const REGIONS:    Region[]   = ['USA', 'UK', 'AU']

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: '#f9fafb' }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-8 pt-5 pb-3">

          {/* Row 1: title + KPIs */}
          <div className="flex items-start justify-between gap-8 mb-4">
            <div className="shrink-0">
              <h1 className="text-lg font-semibold text-gray-900 tracking-tight">Team Workload</h1>
              <p className="text-sm text-gray-400 mt-0.5">Lifetime overview</p>
            </div>
            <div className="flex items-center gap-6">
              {[
                { label: 'Completed Tasks', value: 0, color: '#111827' },
                { label: 'In Review',       value: 0, color: '#f59e0b' },
                { label: 'In Progress',     value: 0, color: '#10b981' },
                { label: 'Planning',        value: 0, color: '#3b82f6' },
                { label: 'On Hold',         value: 0, color: '#ef4444' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center shrink-0">
                  <div className="text-xl font-semibold tabular-nums leading-none" style={{ color }}>{value}</div>
                  <div className="text-[11px] text-gray-400 mt-1 whitespace-nowrap">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 2: controls */}
          <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
            {/* Team */}
            <select
              value={f.teamId}
              onChange={e => set({ teamId: e.target.value })}
              className="h-8 pl-3 pr-7 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' stroke='%239ca3af' stroke-width='1.3' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            {/* Timescale */}
            <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5">
              {(['Day', 'Week', 'Month'] as TimeScale[]).map(s => (
                <button key={s} onClick={() => set({ timeScale: s })}
                  className={`px-3 h-full rounded-md text-xs font-medium transition-colors ${f.timeScale === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {s}
                </button>
              ))}
            </div>

            {/* Weekends */}
            <button onClick={() => set({ showWeekends: !f.showWeekends })} className="flex items-center gap-2 group">
              <div className={`rounded-full relative transition-colors flex items-center px-0.5 ${f.showWeekends ? 'bg-blue-500' : 'bg-gray-200'}`}
                style={{ width: 32, height: 18 }}>
                <span className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${f.showWeekends ? 'translate-x-3.5' : 'translate-x-0'}`} />
              </div>
              <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">Weekends</span>
            </button>

            <div className="flex-1" />

            <div className="w-px h-6 bg-gray-200" />

            {/* Filter button */}
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`inline-flex items-center gap-2 h-8 px-3 rounded-lg border text-xs font-medium transition-all ${
                showFilters || activeCount > 0
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1.5 3.5h10M3.5 6.5h6M5.5 9.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              Filter
              {activeCount > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-none">
                  {activeCount}
                </span>
              )}
            </button>

            <div className="w-px h-6 bg-gray-200" />

            {/* View */}
            <div className="flex items-center h-8 bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {(Object.keys(ViewIcons) as ViewMode[]).map(key => (
                <button key={key} title={key} onClick={() => set({ view: key })}
                  className={`w-7 h-full flex items-center justify-center rounded-md transition-all ${f.view === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                  {ViewIcons[key as keyof typeof ViewIcons]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-screen-xl mx-auto px-8 py-4 flex items-start gap-8 flex-wrap">

            {/* Priority */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Priority</span>
              <div className="flex items-center gap-1 flex-wrap">
                {PRIORITIES.map(p => (
                  <PriorityPill key={p} priority={p}
                    active={f.priorities.has(p)} onClick={() => toggle<Priority>('priorities', p)} />
                ))}
              </div>
            </div>

            <div className="w-px self-stretch bg-gray-100 shrink-0" />

            {/* Status */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Status</span>
              <div className="flex items-center gap-1 flex-wrap">
                {STATUSES.map(s => (
                  <Pill key={s} label={s} color={STATUS_CONFIG[s].color} dot
                    active={f.statuses.has(s)} onClick={() => toggle<Status>('statuses', s)} />
                ))}
              </div>
            </div>

            <div className="w-px self-stretch bg-gray-100 shrink-0" />

            {/* Brand */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Brand</span>
              <div className="flex items-center gap-1 flex-wrap">
                {BRANDS.map(b => (
                  <Pill key={b} label={b} color={BRAND_CONFIG[b].color}
                    active={f.brands.has(b)} onClick={() => toggle<Brand>('brands', b)} />
                ))}
              </div>
            </div>

            <div className="w-px self-stretch bg-gray-100 shrink-0" />

            {/* Region */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Region</span>
              <div className="flex items-center gap-1 flex-wrap">
                {REGIONS.map(r => (
                  <Pill key={r} label={r} color="#3b82f6" prefix={`${REGION_CONFIG[r].flag} `}
                    active={f.regions.has(r)} onClick={() => toggle<Region>('regions', r)} />
                ))}
              </div>
            </div>

            {activeCount > 0 && (
              <>
                <div className="w-px self-stretch bg-gray-100 shrink-0" />
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest opacity-0">·</span>
                  <button onClick={clear}
                    className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-all border border-transparent hover:border-gray-200">
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    Clear all
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="max-w-screen-xl mx-auto px-8 py-6">
        <div className="bg-white rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <div className="overflow-x-auto relative">
            <table className="w-full border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr className="[&>th]:border-b [&>th]:border-gray-100">
                  <th className="sticky left-0 z-30 bg-white px-6 py-3 text-left w-52 after:absolute after:inset-y-0 after:right-0 after:w-[1px] after:bg-gray-200 after:shadow-[2px_0_5px_rgba(0,0,0,0.1)]">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Member</span>
                  </th>
                  {days.map((d, i) => (
                    <th key={i} className="px-3 py-3 text-center border-r border-gray-100 last:border-r-0 min-w-[110px]">
                      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{d.label}</div>
                      <div className="text-base font-semibold text-gray-700 mt-0.5">{d.date}</div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 bg-white px-4 py-3 text-center w-24 after:absolute after:inset-y-0 after:left-0 after:w-[1px] after:bg-gray-200 after:shadow-[-2px_0_5px_rgba(0,0,0,0.1)]">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ name, color, members: gm }) => (
                  <Fragment key={name}>
                    {/* Group row */}
                    <tr className="bg-gray-50/70 [&>td]:border-b [&>td]:border-gray-50">
                      <td className="sticky left-0 z-20 bg-gray-50 px-6 py-2 after:absolute after:inset-y-0 after:right-0 after:w-[1px] after:bg-gray-200 after:shadow-[2px_0_5px_rgba(0,0,0,0.1)]">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-xs font-semibold text-gray-500">{name}</span>
                          <span className="text-xs text-gray-300">{gm.length}</span>
                        </div>
                      </td>
                      <td colSpan={days.length}></td>
                      <td className="sticky right-0 z-20 bg-gray-50 after:absolute after:inset-y-0 after:left-0 after:w-[1px] after:bg-gray-200 after:shadow-[-2px_0_5px_rgba(0,0,0,0.1)]"></td>
                    </tr>
                    {/* Member rows */}
                    {gm.map(member => {
                      const totalH   = member.days.slice(0, n).reduce((s, d) => s + d.hours, 0)
                      const totalC   = member.days.slice(0, n).reduce((s, d) => s + d.capacity, 0)
                      const pct      = totalC > 0 ? totalH / totalC : 0
                      const rowColor = loadColor(pct)
                      return (
                        <tr key={member.id} className="hover:bg-gray-50/50 transition-colors group [&>td]:border-b [&>td]:border-gray-50">
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-6 py-3 transition-colors after:absolute after:inset-y-0 after:right-0 after:w-[1px] after:bg-gray-200 after:shadow-[2px_0_5px_rgba(0,0,0,0.1)]">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
                                style={{ backgroundColor: member.color }}>
                                {member.initials}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-medium text-gray-800 leading-tight">{member.name}</span>
                                  {member.badge && (
                                    <span className="px-1.5 py-px rounded text-[10px] font-medium bg-violet-50 text-violet-600 border border-violet-100">
                                      {member.badge}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5 truncate">{member.role}</div>
                              </div>
                            </div>
                          </td>
                          {days.map((_, i) => (
                            <td key={i} className="px-3 py-3 border-r border-gray-50 last:border-r-0">
                              <CapBar hours={member.days[i].hours} capacity={member.days[i].capacity} />
                            </td>
                          ))}
                          <td className="sticky right-0 z-10 bg-white group-hover:bg-gray-50 px-4 py-3 text-center transition-colors after:absolute after:inset-y-0 after:left-0 after:w-[1px] after:bg-gray-200 after:shadow-[-2px_0_5px_rgba(0,0,0,0.1)]">
                            <div className="text-sm font-semibold tabular-nums" style={{ color: rowColor }}>
                              {totalH > 0 ? `${Math.round(totalH)}h` : '—'}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{loadLabel(pct)}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={days.length + 2} className="py-16 text-center text-sm text-gray-400">
                      No members match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
