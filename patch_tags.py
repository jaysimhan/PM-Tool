import re

with open('src/components/TaskDetailsPanel.tsx', 'r') as f:
    content = f.read()

# Replace the tags rendering inside the dropdown
tags_popup_tgt = """                                                        <div className="p-2">
                                                            <div className="max-h-48 overflow-y-auto">
                                                                {allTags
                                                                    .filter((t: TagType) => !localTags.some((lt: TagType) => lt.id === t.id) && t.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
                                                                    .map((t: TagType) => (
                                                                        <button
                                                                            key={t.id}
                                                                            onClick={() => {
                                                                                setLocalTags([...localTags, t]);
     if (task?.id && !task.id.startsWith('subtask-new')) {
         supabase.from('task_tags').insert({ task_id: task.id, tag_id: t.id }).then(() => refreshTasks());
     }
                                                                                setTagSearchQuery('');
                                                                                setShowTagInput(false);
                                                                            }}
                                                                            className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2"
                                                                        >
                                                                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${t.color}`}>{t.name}</span>
                                                                        </button>
                                                                    ))}

                                                                {tagSearchQuery.trim() && !allTags.some((t: TagType) => t.name.toLowerCase() === tagSearchQuery.trim().toLowerCase()) && (
                                                                    <button
                                                                        onClick={async () => {
                                                                            const newName = tagSearchQuery.trim();
                                                                            const { data, error } = await supabase.from('tags').insert({ name: newName, color: 'bg-blue-100 text-blue-700' }).select().single();
                                                                            if (!error && data) {
                                                                                await refreshTasks();
                                                                                setLocalTags([...localTags, data]);
     if (task?.id && !task.id.startsWith('subtask-new')) {
         supabase.from('task_tags').insert({ task_id: task.id, tag_id: data.id }).then(() => refreshTasks());
     }
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
                                                        </div>"""

tags_popup_repl = """                                                        <div className="p-2">
                                                            <div className="max-h-60 overflow-y-auto space-y-1">
                                                                {allTags
                                                                    .filter((t: TagType) => t.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
                                                                    .map((t: TagType) => (
                                                                        <div key={t.id} className="group/tag flex flex-col">
                                                                            {editingTagId === t.id ? (
                                                                                <div className="p-2 bg-gray-50 rounded-lg border border-gray-200 shadow-sm z-10 relative">
                                                                                    <input 
                                                                                        autoFocus
                                                                                        className="w-full text-sm border border-gray-300 rounded px-2 py-1 mb-2 focus:ring-1 focus:ring-blue-500 outline-none" 
                                                                                        value={editingTagName}
                                                                                        onChange={e => setEditingTagName(e.target.value)}
                                                                                    />
                                                                                    <div className="flex flex-wrap gap-1 mb-2">
                                                                                        {[
                                                                                            'bg-gray-100 text-gray-700', 'bg-red-100 text-red-700', 
                                                                                            'bg-orange-100 text-orange-700', 'bg-amber-100 text-amber-700', 
                                                                                            'bg-green-100 text-green-700', 'bg-emerald-100 text-emerald-700', 
                                                                                            'bg-teal-100 text-teal-700', 'bg-cyan-100 text-cyan-700', 
                                                                                            'bg-blue-100 text-blue-700', 'bg-indigo-100 text-indigo-700', 
                                                                                            'bg-violet-100 text-violet-700', 'bg-purple-100 text-purple-700', 
                                                                                            'bg-fuchsia-100 text-fuchsia-700', 'bg-pink-100 text-pink-700', 
                                                                                            'bg-rose-100 text-rose-700'
                                                                                        ].map(c => (
                                                                                            <button 
                                                                                                key={c}
                                                                                                onClick={(e) => { e.stopPropagation(); setEditingTagColor(c); }}
                                                                                                className={`w-4 h-4 rounded-full ${c.split(' ')[0]} ${editingTagColor === c ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                                                                                            />
                                                                                        ))}
                                                                                    </div>
                                                                                    <div className="flex justify-between items-center mt-2">
                                                                                        <button 
                                                                                            onClick={async (e) => {
                                                                                                e.stopPropagation();
                                                                                                await supabase.from('tags').delete().eq('id', t.id);
                                                                                                setEditingTagId(null);
                                                                                                setLocalTags(localTags.filter(lt => lt.id !== t.id));
                                                                                                refreshTasks();
                                                                                            }}
                                                                                            className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                                                                                        >
                                                                                            Delete
                                                                                        </button>
                                                                                        <div className="flex gap-1">
                                                                                            <button onClick={(e) => { e.stopPropagation(); setEditingTagId(null); }} className="text-xs text-gray-600 hover:bg-gray-200 px-2 py-1 rounded">Cancel</button>
                                                                                            <button 
                                                                                                onClick={async (e) => {
                                                                                                    e.stopPropagation();
                                                                                                    await supabase.from('tags').update({ name: editingTagName, color: editingTagColor }).eq('id', t.id);
                                                                                                    setEditingTagId(null);
                                                                                                    
                                                                                                    const newLocal = localTags.map(lt => lt.id === t.id ? { ...lt, name: editingTagName, color: editingTagColor } : lt);
                                                                                                    setLocalTags(newLocal);
                                                                                                    refreshTasks();
                                                                                                }}
                                                                                                className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded"
                                                                                            >
                                                                                                Save
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="flex items-center justify-between group/item hover:bg-gray-50 rounded px-2 py-1.5 cursor-pointer" onClick={() => {
                                                                                    if (!localTags.some((lt: TagType) => lt.id === t.id)) {
                                                                                        setLocalTags([...localTags, t]);
                                                                                        if (task?.id && !task.id.startsWith('subtask-new')) {
                                                                                            supabase.from('task_tags').insert({ task_id: task.id, tag_id: t.id }).then(() => refreshTasks());
                                                                                        }
                                                                                        setTagSearchQuery('');
                                                                                        setShowTagInput(false);
                                                                                    } else {
                                                                                        setLocalTags(localTags.filter(lt => lt.id !== t.id));
                                                                                        if (task?.id && !task.id.startsWith('subtask-new')) {
                                                                                            supabase.from('task_tags').delete().eq('task_id', task.id).eq('tag_id', t.id).then(() => refreshTasks());
                                                                                        }
                                                                                    }
                                                                                }}>
                                                                                    <div className="flex items-center gap-2">
                                                                                        {localTags.some((lt: TagType) => lt.id === t.id) ? (
                                                                                            <Check className="w-3.5 h-3.5 text-blue-600" />
                                                                                        ) : (
                                                                                            <div className="w-3.5 h-3.5" />
                                                                                        )}
                                                                                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${t.color}`}>{t.name}</span>
                                                                                    </div>
                                                                                    <button 
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setEditingTagId(t.id);
                                                                                            setEditingTagName(t.name);
                                                                                            setEditingTagColor(t.color || 'bg-gray-100 text-gray-700');
                                                                                        }}
                                                                                        className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity"
                                                                                    >
                                                                                        <Settings className="w-3 h-3 text-gray-500" />
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}

                                                                {tagSearchQuery.trim() && !allTags.some((t: TagType) => t.name.toLowerCase() === tagSearchQuery.trim().toLowerCase()) && (
                                                                    <button
                                                                        onClick={async () => {
                                                                            const newName = tagSearchQuery.trim();
                                                                            const { data, error } = await supabase.from('tags').insert({ name: newName, color: 'bg-gray-100 text-gray-700' }).select().single();
                                                                            if (!error && data) {
                                                                                await refreshTasks();
                                                                                setLocalTags([...localTags, data]);
                                                                                if (task?.id && !task.id.startsWith('subtask-new')) {
                                                                                    supabase.from('task_tags').insert({ task_id: task.id, tag_id: data.id }).then(() => refreshTasks());
                                                                                }
                                                                                setTagSearchQuery('');
                                                                                setShowTagInput(false);
                                                                            }
                                                                        }}
                                                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                                    >
                                                                        Create <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">{tagSearchQuery.trim()}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>"""

content = content.replace(tags_popup_tgt, tags_popup_repl)
with open('src/components/TaskDetailsPanel.tsx', 'w') as f:
    f.write(content)
