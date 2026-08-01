import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';
import { Skill } from '../types/types';
import { supabase } from '../lib/supabaseClient';
import { embedText, warmEmbeddingModel } from '../utils/embeddings';

interface Props {
    allSkills: Skill[];
    selectedIds: string[];
    onChange: (skillIds: string[]) => void;
    placeholder?: string;
}

type SkillOption = Pick<Skill, 'id' | 'name' | 'category'>;

/**
 * Multi-select over every skill in the org -- deliberately not filtered to the person's
 * own team, because people carry skills that belong to other teams.
 *
 * Typing runs the same semantic (pgvector) search the request form uses, with literal
 * name matches pinned above the related ones so a known skill name is never buried.
 */
const MAX_SUGGESTIONS = 6;

export function SkillPicker({ allSkills, selectedIds, onChange, placeholder = 'Search skills...' }: Props) {
    const [search, setSearch] = useState('');
    const [matched, setMatched] = useState<SkillOption[]>(allSkills.slice(0, MAX_SUGGESTIONS));
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [dropdownStyle, setDropdownStyle] = useState<{ left: number; width: number; top: number } | null>(null);
    const searchRequestId = useRef(0);
    const pickerRef = useRef<HTMLDivElement>(null);
    const inputWrapperRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Start downloading the embedding model up front so the first keystroke is not
    // stuck behind a cold start.
    useEffect(() => {
        warmEmbeddingModel();
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                pickerRef.current && !pickerRef.current.contains(target) &&
                (!dropdownRef.current || !dropdownRef.current.contains(target))
            ) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // The picker renders inside modals/panels that clip overflow, so the suggestion
    // list is portaled to <body> and positioned from the input's live viewport rect --
    // otherwise it gets clipped by an ancestor's overflow:hidden/auto instead of
    // floating above everything.
    useEffect(() => {
        if (!showSuggestions || search.trim() === '') {
            setDropdownStyle(null);
            return;
        }

        const updatePosition = () => {
            const rect = inputWrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            setDropdownStyle({
                left: rect.left,
                width: rect.width,
                top: rect.bottom + 4
            });
        };

        updatePosition();
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [showSuggestions, search]);

    useEffect(() => {
        const query = search.trim();
        const unselected = allSkills.filter(s => !selectedIds.includes(s.id));

        if (!query) {
            setMatched(unselected.slice(0, MAX_SUGGESTIONS));
            setIsSearching(false);
            return;
        }

        const literalMatches = () =>
            unselected.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));

        const requestId = ++searchRequestId.current;
        setIsSearching(true);

        const timeoutId = setTimeout(async () => {
            try {
                const queryEmbedding = await embedText(query);
                const { data, error } = await supabase.rpc('match_skills', {
                    query_embedding: queryEmbedding,
                    match_count: MAX_SUGGESTIONS + selectedIds.length
                });
                if (requestId !== searchRequestId.current) return;
                if (error) throw error;

                const literal = literalMatches();
                const seen = new Set(literal.map(s => s.id));
                const related = (data || [])
                    .filter((s: SkillOption) => !seen.has(s.id) && !selectedIds.includes(s.id));
                setMatched([...literal, ...related].slice(0, MAX_SUGGESTIONS));
            } catch (err) {
                if (requestId !== searchRequestId.current) return;
                console.error('Semantic skill search failed, falling back to text match:', err);
                setMatched(literalMatches().slice(0, MAX_SUGGESTIONS));
            } finally {
                if (requestId === searchRequestId.current) setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [search, allSkills, selectedIds]);

    const toggleSkill = (skillId: string) => {
        onChange(
            selectedIds.includes(skillId)
                ? selectedIds.filter(id => id !== skillId)
                : [...selectedIds, skillId]
        );
    };

    const selectedSkills = selectedIds
        .map(id => allSkills.find(s => s.id === id))
        .filter(Boolean) as Skill[];

    return (
        <div ref={pickerRef} className="space-y-3">
            {selectedSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {selectedSkills.map(skill => (
                        <span
                            key={skill.id}
                            className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-full border border-purple-100"
                        >
                            {skill.name}
                            <button
                                type="button"
                                onClick={() => toggleSkill(skill.id)}
                                className="p-0.5 rounded-full hover:bg-purple-100 text-purple-400 hover:text-purple-700 transition-colors"
                                aria-label={`Remove ${skill.name}`}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div ref={inputWrapperRef} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder={placeholder}
                    className="block w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                )}
            </div>

            {showSuggestions && dropdownStyle && createPortal(
                <div
                    ref={dropdownRef}
                    style={{ position: 'fixed', left: dropdownStyle.left, width: dropdownStyle.width, top: dropdownStyle.top }}
                    className="z-[200] bg-white border border-gray-200 rounded-lg shadow-lg divide-y divide-gray-100 overflow-hidden"
                >
                    {matched.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-gray-500">
                            {isSearching ? 'Searching...' : 'No matching skills found.'}
                        </div>
                    ) : (
                        matched.map(skill => (
                            <button
                                type="button"
                                key={skill.id}
                                onClick={() => toggleSkill(skill.id)}
                                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50"
                            >
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium truncate text-gray-900">
                                        {skill.name}
                                    </span>
                                    <span className="block text-xs truncate text-gray-500">
                                        {skill.category || 'General'}
                                    </span>
                                </span>
                            </button>
                        ))
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
