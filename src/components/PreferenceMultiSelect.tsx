import React, { useState } from 'react';
import { Check, Search } from 'lucide-react';

export interface PreferenceOption {
    id: string;
    name: string;
    /** Shown before the name -- a region's flag, say. */
    prefix?: string;
}

type Accent = 'blue' | 'teal';

interface Props {
    options: PreferenceOption[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    /** Shown in place of the chips when there is nothing to pick from at all. */
    emptyLabel: string;
    accent?: Accent;
    searchPlaceholder?: string;
}

/**
 * Toggle chips for the small, fixed sets a person picks their preferences from -- the brands
 * and regions they want work for. Deliberately not the SkillPicker: skills run to the hundreds
 * and need semantic search, while brands and regions are short enough to show all at once, and
 * seeing every option is the point when the answer is "which of these do I want".
 *
 * A search box appears only once the list is long enough to be worth filtering.
 */
const SEARCH_THRESHOLD = 10;

const ACCENTS: Record<Accent, { on: string; off: string }> = {
    blue: {
        on: 'bg-blue-50 border-blue-300 text-blue-800',
        off: 'bg-white border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50/40'
    },
    teal: {
        on: 'bg-teal-50 border-teal-300 text-teal-800',
        off: 'bg-white border-gray-200 text-gray-700 hover:border-teal-300 hover:bg-teal-50/40'
    }
};

export function PreferenceMultiSelect({
    options,
    selectedIds,
    onChange,
    emptyLabel,
    accent = 'blue',
    searchPlaceholder = 'Search...'
}: Props) {
    const [search, setSearch] = useState('');
    const colors = ACCENTS[accent];

    const toggle = (id: string) => {
        onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
    };

    if (options.length === 0) {
        return <p className="text-sm text-gray-500 py-2">{emptyLabel}</p>;
    }

    const query = search.trim().toLowerCase();
    // A selected option stays visible while searching, so filtering can never hide a pick and
    // make it look as though it had been dropped.
    const visible = query
        ? options.filter(o => o.name.toLowerCase().includes(query) || selectedIds.includes(o.id))
        : options;

    return (
        <div className="space-y-2">
            {options.length > SEARCH_THRESHOLD && (
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {visible.map(option => {
                    const isSelected = selectedIds.includes(option.id);
                    return (
                        <button
                            type="button"
                            key={option.id}
                            onClick={() => toggle(option.id)}
                            aria-pressed={isSelected}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                                isSelected ? colors.on : colors.off
                            }`}
                        >
                            {isSelected && <Check className="w-3 h-3" />}
                            {option.prefix && <span aria-hidden="true">{option.prefix}</span>}
                            {option.name}
                        </button>
                    );
                })}
                {visible.length === 0 && (
                    <p className="text-sm text-gray-500 py-1">No matches.</p>
                )}
            </div>
        </div>
    );
}
