import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Users, Check } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { useMemberView } from '../contexts/MemberViewContext';
import { User } from '../types/types';

const initials = (name: string) =>
    name.includes('@')
        ? name.charAt(0).toUpperCase()
        : name.split(' ').map(part => part[0]).join('').substring(0, 2).toUpperCase();

const Avatar = ({ user }: { user: User }) =>
    user.avatar ? (
        <img src={user.avatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
    ) : (
        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
            {initials(user.name)}
        </div>
    );

/**
 * Whose work the pages below the header are showing. Defaults to all members; picking a
 * person narrows Workload, Tasks and the timeline to them without touching their own
 * filters. Rendered only where the member view is enabled — see MemberViewContext.
 */
export function MemberViewPicker() {
    const { users } = useData();
    const { scope, setScope } = useMemberView();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Requesters only ever file work, so they are never the answer to "whose workload".
    const members = useMemo(
        () =>
            users
                .filter(u => u.isActive && !u.deletedAt && u.role !== 'requester')
                .sort((a, b) => a.name.localeCompare(b.name)),
        [users]
    );

    const selected = members.find(u => u.id === scope) || null;

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return members;
        return members.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }, [members, query]);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // A person who leaves the team (or is deactivated) while selected would otherwise keep
    // filtering every page to somebody the list no longer offers.
    useEffect(() => {
        if (scope !== 'all' && members.length > 0 && !members.some(u => u.id === scope)) setScope('all');
    }, [members, scope, setScope]);

    const choose = (next: string) => {
        setScope(next);
        setIsOpen(false);
        setQuery('');
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(open => !open)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                title="Whose work these pages show"
                className={`flex items-center gap-2 h-9 pl-2 pr-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    selected
                        ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
            >
                {selected ? <Avatar user={selected} /> : <Users className="w-4 h-4 text-gray-500" />}
                <span className="max-w-[10rem] truncate">{selected ? selected.name : 'All members'}</span>
                <ChevronDown className={`w-4 h-4 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                    <div className="p-2 border-b border-gray-100">
                        <input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search members"
                            className="w-full h-8 px-2.5 rounded-lg border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:border-blue-300"
                        />
                    </div>
                    <div className="max-h-80 overflow-y-auto py-1" role="listbox">
                        <button
                            onClick={() => choose('all')}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
                            role="option"
                            aria-selected={scope === 'all'}
                        >
                            <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center flex-shrink-0">
                                <Users className="w-3.5 h-3.5" />
                            </div>
                            <span className="flex-1 font-medium text-gray-900">All members</span>
                            <span className="text-xs text-gray-400">{members.length}</span>
                            {scope === 'all' && <Check className="w-4 h-4 text-blue-600" />}
                        </button>

                        <div className="my-1 border-t border-gray-100" />

                        {matches.length === 0 ? (
                            <div className="px-3 py-6 text-center text-sm text-gray-500">No members match “{query}”</div>
                        ) : (
                            matches.map(user => (
                                <button
                                    key={user.id}
                                    onClick={() => choose(user.id)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
                                    role="option"
                                    aria-selected={scope === user.id}
                                >
                                    <Avatar user={user} />
                                    <span className="flex-1 min-w-0">
                                        <span className="block truncate text-gray-900">{user.name}</span>
                                        <span className="block truncate text-xs text-gray-400">{user.email}</span>
                                    </span>
                                    {scope === user.id && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
