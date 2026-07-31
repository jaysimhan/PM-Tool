const fs = require('fs');

let content = fs.readFileSync('src/components/TaskDetailsPanel.tsx', 'utf8');

const startStr = "{/* Tags */}";
const endStr = "{/* Priority */}";

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
    console.log("Could not find start or end string");
    process.exit(1);
}

const replacement = `{/* Tags */}
                                    {(localTags.length > 0 || showTagInput) && (
                                        <FieldRow label="Tags" icon={<Tag className="w-4 h-4 text-gray-400" />}>
                                            <div className="relative" ref={tagPopoverRef}>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {localTags.map((tag, idx) => (
                                                        <span
                                                            key={tag.id || idx}
                                                            className={\`px-2.5 py-1 text-sm font-medium rounded-full flex items-center gap-1.5 \${tag.color || 'bg-gray-100 text-gray-700'}\`}
                                                        >
                                                            {tag.name}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setLocalTags(localTags.filter((_, i) => i !== idx));
                                                                }}
                                                                className="hover:opacity-75"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                        </span>
                                                    ))}
                                                    <button
                                                        onClick={() => {
                                                            setShowTagInput(true);
                                                            setTagSearchQuery('');
                                                        }}
                                                        className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full text-sm font-medium flex items-center transition-colors"
                                                    >
                                                        +1
                                                    </button>
                                                </div>

                                                {/* Tag Popover */}
                                                {showTagInput && (
                                                    <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden font-sans">
                                                        <div className="p-3 border-b border-gray-100 flex flex-col gap-2">
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={tagSearchQuery}
                                                                onChange={e => setTagSearchQuery(e.target.value)}
                                                                placeholder="Search or create tag..."
                                                                className="w-full text-sm outline-none placeholder-gray-400 py-1"
                                                            />
                                                        </div>

                                                        <div className="p-2">
                                                            <div className="max-h-48 overflow-y-auto">
                                                                {allTags
                                                                    .filter(t => !localTags.some(lt => lt.id === t.id) && t.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
                                                                    .map(t => (
                                                                        <button
                                                                            key={t.id}
                                                                            onClick={() => {
                                                                                setLocalTags([...localTags, t]);
                                                                                setTagSearchQuery('');
                                                                                setShowTagInput(false);
                                                                            }}
                                                                            className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2"
                                                                        >
                                                                            <span className={\`px-2 py-0.5 text-xs font-medium rounded-full \${t.color}\`}>{t.name}</span>
                                                                        </button>
                                                                    ))}

                                                                {tagSearchQuery.trim() && !allTags.some(t => t.name.toLowerCase() === tagSearchQuery.trim().toLowerCase()) && (
                                                                    <button
                                                                        onClick={async () => {
                                                                            const newName = tagSearchQuery.trim();
                                                                            const { data, error } = await supabase.from('tags').insert({ name: newName, color: 'bg-blue-100 text-blue-700' }).select().single();
                                                                            if (!error && data) {
                                                                                await refreshTags();
                                                                                setLocalTags([...localTags, data]);
                                                                                setTagSearchQuery('');
                                                                                setShowTagInput(false);
                                                                            }
                                                                        }}
                                                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                                    >
                                                                        Create <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">{tagSearchQuery.trim()}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </FieldRow>
                                    )}

                                    `;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync('src/components/TaskDetailsPanel.tsx', newContent);
