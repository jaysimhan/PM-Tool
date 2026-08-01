import React, { useState, useEffect, useRef } from 'react';
import { Search, User as UserIcon, Tag, CheckSquare, X, CheckCircle2, ClipboardList, Users, Folder, Triangle, MoreHorizontal, Clock, Trash2, Zap, MoreVertical, Globe, MapPin } from 'lucide-react';
import { useData } from '../contexts/DataContext';

export function GlobalSearch({ isMac }: { isMac: boolean }) {
    const { tasks, users, regions } = useData();
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const [recentSearches, setRecentSearches] = useState<string[]>(() => {
        const saved = localStorage.getItem('recentSearches');
        return saved ? JSON.parse(saved) : [];
    });

    // Keyboard shortcut to focus
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
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

    const handleSelect = () => {
        if (query.trim()) {
            const q = query.trim();
            const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
            setRecentSearches(updated);
            localStorage.setItem('recentSearches', JSON.stringify(updated));
        }
        setIsOpen(false);
        setQuery('');
        inputRef.current?.blur();
    };

    return (
        <div className="relative group w-full" ref={wrapperRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-hover:text-gray-500" />
            <input 
                ref={inputRef}
                type="text" 
                placeholder="Search" 
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim()) {
                        const q = query.trim();
                        const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
                        setRecentSearches(updated);
                        localStorage.setItem('recentSearches', JSON.stringify(updated));
                    }
                }}
                className="w-full pl-10 pr-12 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:bg-white transition-all shadow-sm"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {query ? (
                    <button onClick={() => { setQuery(''); setIsOpen(false); }} className="p-0.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
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
                <div className="absolute top-full mt-2 -left-16 md:left-0 right-0 md:-right-32 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50">
                    <div className="max-h-[80vh] overflow-y-auto">
                        
                        {/* Filter Pills */}
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 overflow-x-auto no-scrollbar">
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 font-medium whitespace-nowrap transition-colors">
                                <CheckCircle2 className="w-4 h-4" /> Tasks
                            </button>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 font-medium whitespace-nowrap transition-colors">
                                <UserIcon className="w-4 h-4" /> People
                            </button>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 font-medium whitespace-nowrap transition-colors">
                                <Globe className="w-4 h-4" /> Brand
                            </button>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 font-medium whitespace-nowrap transition-colors">
                                <MapPin className="w-4 h-4" /> Region
                            </button>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 font-medium whitespace-nowrap transition-colors">
                                <Tag className="w-4 h-4" /> Tag
                            </button>
                        </div>

                        {/* Search Results */}
                        <div className="py-2">
                            {hasQuery ? (
                                <>
                                    <div className="px-4 py-2 text-sm font-semibold text-gray-500">Tasks</div>
                                    {tasks.filter(t => {
                                        const regionName = t.regionId ? regions.find(r => r.id === t.regionId)?.name.toLowerCase() : null;
                                        const regionMatch = regionName ? regionName.includes(normalizedQuery) : false;
                                        return t.title.toLowerCase().includes(normalizedQuery) || 
                                               (t.tags && t.tags.some(tag => tag.name.toLowerCase().includes(normalizedQuery))) ||
                                               regionMatch;
                                    }).slice(0, 10).map(task => (
                                        <button key={task.id} onClick={handleSelect} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between group">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-500">
                                                    <CheckSquare className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <div className="text-sm text-gray-900 font-medium">{task.title}</div>
                                                    <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                        {task.status.replace('_', ' ')}
                                                        {task.regionId && regions.find(r => r.id === task.regionId) && (
                                                            <>
                                                                <span className="mx-1">•</span>
                                                                <span>{regions.find(r => r.id === task.regionId)?.flag} {regions.find(r => r.id === task.regionId)?.name}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                    {tasks.filter(t => {
                                        const regionName = t.regionId ? regions.find(r => r.id === t.regionId)?.name.toLowerCase() : null;
                                        const regionMatch = regionName ? regionName.includes(normalizedQuery) : false;
                                        return t.title.toLowerCase().includes(normalizedQuery) || 
                                               (t.tags && t.tags.some(tag => tag.name.toLowerCase().includes(normalizedQuery))) ||
                                               regionMatch;
                                    }).length === 0 && (
                                        <div className="px-4 py-3 text-sm text-gray-500 text-center">No tasks found.</div>
                                    )}
                                </>
                            ) : recentSearches.length > 0 ? (
                                <>
                                    <div className="px-4 py-2 flex items-center justify-between">
                                        <div className="text-sm font-semibold text-gray-500">Recent Searches</div>
                                        <button 
                                            onClick={() => {
                                                setRecentSearches([]);
                                                localStorage.removeItem('recentSearches');
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                                        >
                                            Clear history
                                        </button>
                                    </div>
                                    {recentSearches.map((search, idx) => (
                                        <button 
                                            key={idx} 
                                            onClick={() => setQuery(search)} 
                                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3 group transition-colors"
                                        >
                                            <Clock className="w-4 h-4 text-gray-400 group-hover:text-gray-500" />
                                            <span className="text-sm text-gray-700">{search}</span>
                                        </button>
                                    ))}
                                </>
                            ) : (
                                <div className="px-4 py-8 text-sm text-gray-500 text-center">
                                    Type to search for tasks, projects, and people...
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
}
