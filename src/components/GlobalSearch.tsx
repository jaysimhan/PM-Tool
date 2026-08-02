import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User as UserIcon, Tag, CheckSquare, X, CheckCircle2, Clock, Globe, MapPin, Sparkles } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { useIsTestPath, toTestPath } from '../lib/testEnvironment';
import { formatStatusLabel } from '../utils/capacityCalculations';

type ResultType = 'task' | 'person' | 'brand' | 'region' | 'tag' | 'skill';

interface Result {
    type: ResultType;
    id: string;
    label: string;
    sublabel?: string;
    /** Shown in the leading square instead of the type icon. */
    avatar?: string;
    emoji?: string;
    color?: string;
}

const FILTERS: { type: ResultType; label: string; icon: React.ElementType }[] = [
    { type: 'task', label: 'Tasks', icon: CheckCircle2 },
    { type: 'person', label: 'People', icon: UserIcon },
    { type: 'brand', label: 'Brand', icon: Globe },
    { type: 'region', label: 'Region', icon: MapPin },
    { type: 'tag', label: 'Tag', icon: Tag },
    { type: 'skill', label: 'Skill', icon: Sparkles },
];

const TYPE_ICON: Record<ResultType, React.ElementType> = {
    task: CheckSquare,
    person: UserIcon,
    brand: Globe,
    region: MapPin,
    tag: Tag,
    skill: Sparkles,
};

const GROUP_LABEL: Record<ResultType, string> = {
    task: 'Tasks',
    person: 'People',
    brand: 'Brands',
    region: 'Regions',
    tag: 'Tags',
    skill: 'Skills',
};

// How many of each kind to show. A pill narrows the search to one kind, so it can afford
// a longer list than the mixed view, where every kind has to fit in the same dropdown.
const LIMIT_MIXED: Record<ResultType, number> = { task: 6, person: 4, brand: 4, region: 4, tag: 4, skill: 4 };
const LIMIT_FOCUSED = 12;

// Every hit lands on the task list: as the task itself, or as the list filtered down to the
// brand/region/tag/person that was searched for. CalendarView reads these on arrival.
const pathFor = (r: Result) => {
    switch (r.type) {
        case 'task': return `/tasks?task=${r.id}`;
        case 'person': return `/tasks?assignee=${r.id}`;
        case 'brand': return `/tasks?brand=${r.id}`;
        case 'region': return `/tasks?region=${r.id}`;
        case 'tag': return `/tasks?tag=${r.id}`;
        case 'skill': return `/tasks?skill=${r.id}`;
    }
};

export function GlobalSearch({ isMac }: { isMac: boolean }) {
    const { tasks, users, clients, regions, allTags, skills } = useData();
    const navigate = useNavigate();
    const isTestPath = useIsTestPath();
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [activeFilter, setActiveFilter] = useState<ResultType | null>(null);
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const [recentSearches, setRecentSearches] = useState<string[]>(() => {
        const saved = localStorage.getItem('recentSearches');
        try {
            const parsed = saved ? JSON.parse(saved) : [];
            return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
        } catch {
            return [];
        }
    });

    // Keyboard shortcut to focus
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                setIsOpen(true);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
                inputRef.current?.blur();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const normalizedQuery = query.toLowerCase().trim();
    const hasQuery = normalizedQuery.length > 0;

    const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
    const clientsById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
    const regionsById = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);
    const skillsById = useMemo(() => new Map(skills.map(s => [s.id, s])), [skills]);

    const results = useMemo<Result[]>(() => {
        // A pill on its own is a request to browse that kind, so it lists everything even
        // before anything is typed. Without one there is nothing to show until there is a query.
        if (!hasQuery && !activeFilter) return [];

        const matches = (...fields: (string | undefined | null)[]) =>
            !hasQuery || fields.some(f => f?.toLowerCase().includes(normalizedQuery));

        const take = (type: ResultType) => (activeFilter ? LIMIT_FOCUSED : LIMIT_MIXED[type]);
        const wanted = (type: ResultType) => !activeFilter || activeFilter === type;

        const out: Result[] = [];

        if (wanted('task')) {
            out.push(...tasks
                .filter(t => {
                    const region = t.regionId ? regionsById.get(t.regionId) : undefined;
                    const brand = t.clientId ? clientsById.get(t.clientId) : undefined;
                    const assignee = t.assignedToId ? usersById.get(t.assignedToId) : undefined;
                    return matches(
                        t.title,
                        t.requestId,
                        t.description,
                        region?.name,
                        brand?.name,
                        assignee?.name,
                    )
                        || (t.tags || []).some(tag => matches(tag.name))
                        || (t.requiredSkillIds || []).some(id => matches(skillsById.get(id)?.name));
                })
                .slice(0, take('task'))
                .map(t => {
                    const region = t.regionId ? regionsById.get(t.regionId) : undefined;
                    const brand = t.clientId ? clientsById.get(t.clientId) : undefined;
                    const parts = [formatStatusLabel(t.status)];
                    if (brand) parts.push(brand.name);
                    if (region) parts.push(`${region.flag ? `${region.flag} ` : ''}${region.name}`);
                    return { type: 'task' as const, id: t.id, label: t.title || 'Untitled task', sublabel: parts.join(' · ') };
                }));
        }

        if (wanted('person')) {
            out.push(...users
                .filter(u => !u.deletedAt && u.isActive && matches(u.name, u.email))
                .slice(0, take('person'))
                .map(u => ({
                    type: 'person' as const,
                    id: u.id,
                    label: u.name,
                    sublabel: u.email,
                    avatar: u.avatar,
                })));
        }

        if (wanted('brand')) {
            out.push(...clients
                .filter(c => matches(c.name, c.department))
                .slice(0, take('brand'))
                .map(c => ({
                    type: 'brand' as const,
                    id: c.id,
                    label: c.name,
                    sublabel: c.department,
                    avatar: c.favicon,
                })));
        }

        if (wanted('region')) {
            out.push(...regions
                .filter(r => matches(r.name, r.code))
                .slice(0, take('region'))
                .map(r => ({
                    type: 'region' as const,
                    id: r.id,
                    label: r.name,
                    sublabel: r.code,
                    emoji: r.flag,
                })));
        }

        if (wanted('tag')) {
            out.push(...allTags
                .filter(t => matches(t.name))
                .slice(0, take('tag'))
                .map(t => ({ type: 'tag' as const, id: t.id, label: t.name, color: t.color })));
        }

        if (wanted('skill')) {
            out.push(...skills
                .filter(s => matches(s.name, s.category))
                .slice(0, take('skill'))
                .map(s => ({ type: 'skill' as const, id: s.id, label: s.name, sublabel: s.category })));
        }

        return out;
    }, [hasQuery, normalizedQuery, activeFilter, tasks, users, clients, regions, allTags, skills, usersById, clientsById, regionsById, skillsById]);

    // A changed query or pill means the old highlight points at a different row than the one
    // it was put on, so it goes back to the top of the new list.
    useEffect(() => setHighlight(0), [normalizedQuery, activeFilter]);

    useEffect(() => {
        listRef.current
            ?.querySelector(`[data-result-index="${highlight}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [highlight]);

    const rememberQuery = (raw: string) => {
        const q = raw.trim();
        if (!q) return;
        const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
        setRecentSearches(updated);
        localStorage.setItem('recentSearches', JSON.stringify(updated));
    };

    const openResult = (result: Result) => {
        rememberQuery(query);
        setIsOpen(false);
        setQuery('');
        setActiveFilter(null);
        inputRef.current?.blur();
        const path = pathFor(result);
        navigate(isTestPath ? toTestPath(path) : path);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' && results.length > 0) {
            e.preventDefault();
            setIsOpen(true);
            setHighlight(h => (h + 1) % results.length);
        } else if (e.key === 'ArrowUp' && results.length > 0) {
            e.preventDefault();
            setHighlight(h => (h - 1 + results.length) % results.length);
        } else if (e.key === 'Enter') {
            const result = results[highlight];
            if (result) {
                e.preventDefault();
                openResult(result);
            } else {
                rememberQuery(query);
            }
        } else if (e.key === 'Backspace' && !query && activeFilter) {
            // Backspacing past an empty box steps back out of the pill, the way a chip in a
            // token field would come off.
            setActiveFilter(null);
        }
    };

    // Results arrive grouped by kind already; this only marks where each run starts so the
    // headings can be rendered inline without a second pass over the data.
    const headingBefore = (index: number) =>
        index === 0 || results[index - 1].type !== results[index].type;

    return (
        <div className="relative group w-full" ref={wrapperRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-hover:text-gray-500" />
            <input
                ref={inputRef}
                type="text"
                placeholder={activeFilter ? `Search ${GROUP_LABEL[activeFilter].toLowerCase()}` : 'Search'}
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleInputKeyDown}
                className="w-full pl-10 pr-12 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:bg-white transition-all shadow-sm"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {query || activeFilter ? (
                    <button
                        onClick={() => { setQuery(''); setActiveFilter(null); inputRef.current?.focus(); }}
                        aria-label="Clear search"
                        className="p-0.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                    >
                        <X className="w-3 h-3" />
                    </button>
                ) : (
                    <kbd className="hidden sm:inline-flex items-center justify-center gap-1 h-5 px-2 text-[11px] font-medium text-gray-500 bg-white border border-gray-200 rounded shadow-sm">
                        <span className={isMac ? "text-[14px]" : ""}>{isMac ? "⌘" : "Ctrl"}</span>
                        <span>K</span>
                    </kbd>
                )}
            </div>

            {/* Suggestions Dropdown */}
            {isOpen && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                    {/* The pills sit outside the scroll area: they are how the list is narrowed,
                        so scrolling the results must not carry them off the top. */}
                    <div className="flex items-center gap-1.5 px-2 py-2 border-b border-gray-100 overflow-x-auto no-scrollbar">
                        {FILTERS.map(({ type, label, icon: Icon }) => {
                            const active = activeFilter === type;
                            return (
                                <button
                                    key={type}
                                    aria-pressed={active}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        setActiveFilter(active ? null : type);
                                        inputRef.current?.focus();
                                    }}
                                    className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors ${
                                        active
                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                    }`}
                                >
                                    <Icon className="w-3.5 h-3.5 shrink-0" />
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto overscroll-contain" ref={listRef}>
                        {/* Search Results. The inset padding is what lets a row's highlight sit
                            as a rounded block inside the panel rather than run edge to edge. */}
                        <div className="p-1.5">
                            {results.length > 0 ? (
                                results.map((result, index) => {
                                    const Icon = TYPE_ICON[result.type];
                                    return (
                                        <React.Fragment key={`${result.type}-${result.id}`}>
                                            {headingBefore(index) && (
                                                <div className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 ${index === 0 ? 'pt-1.5' : 'pt-3'}`}>
                                                    {GROUP_LABEL[result.type]}
                                                </div>
                                            )}
                                            <button
                                                data-result-index={index}
                                                onMouseEnter={() => setHighlight(index)}
                                                onClick={() => openResult(result)}
                                                className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2.5 transition-colors ${
                                                    index === highlight ? 'bg-gray-100' : ''
                                                }`}
                                            >
                                                <div
                                                    className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center text-gray-500 shrink-0 overflow-hidden"
                                                    style={result.color ? { backgroundColor: `${result.color}26`, color: result.color } : undefined}
                                                >
                                                    {result.avatar ? (
                                                        <img
                                                            src={result.avatar}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                        />
                                                    ) : result.emoji ? (
                                                        <span className="text-sm leading-none">{result.emoji}</span>
                                                    ) : (
                                                        <Icon className="w-3.5 h-3.5" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm text-gray-900 font-medium truncate leading-5">{result.label}</div>
                                                    {result.sublabel && (
                                                        <div className="text-xs text-gray-500 truncate leading-4">{result.sublabel}</div>
                                                    )}
                                                </div>
                                                {index === highlight && (
                                                    <kbd className="hidden sm:block shrink-0 text-[11px] text-gray-400">↵</kbd>
                                                )}
                                            </button>
                                        </React.Fragment>
                                    );
                                })
                            ) : hasQuery || activeFilter ? (
                                <div className="px-4 py-7 text-center">
                                    <div className="text-sm font-medium text-gray-700">
                                        No {activeFilter ? GROUP_LABEL[activeFilter].toLowerCase() : 'results'} found
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500 truncate">
                                        {hasQuery ? `Nothing matches “${query.trim()}”` : 'Type to narrow this down'}
                                    </div>
                                </div>
                            ) : recentSearches.length > 0 ? (
                                <>
                                    <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-1">
                                        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Recent</span>
                                        <button
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                setRecentSearches([]);
                                                localStorage.removeItem('recentSearches');
                                            }}
                                            className="text-[11px] font-medium text-gray-400 hover:text-gray-700 transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                    {recentSearches.map((search, idx) => (
                                        <button
                                            key={idx}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => { setQuery(search); inputRef.current?.focus(); }}
                                            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2.5 group transition-colors"
                                        >
                                            <span className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                                                <Clock className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
                                            </span>
                                            <span className="text-sm text-gray-700 truncate">{search}</span>
                                        </button>
                                    ))}
                                </>
                            ) : (
                                <div className="px-4 py-7 text-center">
                                    <div className="text-sm font-medium text-gray-700">Search everything</div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        Tasks, people, brands, regions, tags and skills
                                    </div>
                                </div>
                            )}
                        </div>

                    </div>

                    {/* Only worth the room once there is something the keys can act on. */}
                    {results.length > 0 && (
                        <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-400">
                            <span><span className="font-medium text-gray-500">↑↓</span> navigate</span>
                            <span><span className="font-medium text-gray-500">↵</span> open</span>
                            <span><span className="font-medium text-gray-500">esc</span> close</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
