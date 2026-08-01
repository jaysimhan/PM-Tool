import re

with open('src/components/TaskDetailsPanel.tsx', 'r') as f:
    content = f.read()

# Replace checklist title
cl_title_tgt = """                                                <ChevronDown className="w-4 h-4 text-gray-500 bg-gray-100 rounded" />
                                                <h3 className="text-[15px] font-bold text-gray-900">Checklist</h3>
                                                <span className="text-gray-400 text-sm font-medium">{localChecklist.filter(c => c.completed).length} complete</span>"""
cl_title_repl = """                                                <ChevronDown className="w-4 h-4 text-gray-500 bg-gray-100 rounded" />
                                                {isEditingChecklistTitle ? (
                                                    <input 
                                                        autoFocus
                                                        className="text-[15px] font-bold text-gray-900 bg-transparent border-0 p-0 focus:ring-0" 
                                                        value={checklistTitle} 
                                                        onChange={e => setChecklistTitle(e.target.value)} 
                                                        onBlur={() => setIsEditingChecklistTitle(false)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                setIsEditingChecklistTitle(false);
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <h3 className="text-[15px] font-bold text-gray-900 cursor-text" onClick={() => setIsEditingChecklistTitle(true)}>
                                                        {checklistTitle || 'Checklist'}
                                                    </h3>
                                                )}
                                                <span className="text-gray-400 text-sm font-medium">{localChecklist.filter(c => c.completed).length} complete</span>"""
content = content.replace(cl_title_tgt, cl_title_repl)

# Replace Subtasks title
st_title_tgt = """                                                <ChevronDown className="w-4 h-4 text-gray-500 bg-gray-100 rounded" />
                                                <h3 className="text-[15px] font-bold text-gray-900">Subtasks</h3>
                                                <span className="bg-gray-200/70 text-gray-600 text-xs px-2 py-0.5 rounded font-medium">0 / {localSubtaskIds.length}</span>"""
st_title_repl = """                                                <ChevronDown className="w-4 h-4 text-gray-500 bg-gray-100 rounded" />
                                                {isEditingSubtasksTitle ? (
                                                    <input 
                                                        autoFocus
                                                        className="text-[15px] font-bold text-gray-900 bg-transparent border-0 p-0 focus:ring-0" 
                                                        value={subtasksTitle} 
                                                        onChange={e => setSubtasksTitle(e.target.value)} 
                                                        onBlur={() => setIsEditingSubtasksTitle(false)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                setIsEditingSubtasksTitle(false);
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <h3 className="text-[15px] font-bold text-gray-900 cursor-text" onClick={() => setIsEditingSubtasksTitle(true)}>
                                                        {subtasksTitle || 'Subtasks'}
                                                    </h3>
                                                )}
                                                <span className="bg-gray-200/70 text-gray-600 text-xs px-2 py-0.5 rounded font-medium">0 / {localSubtaskIds.length}</span>"""
content = content.replace(st_title_tgt, st_title_repl)

# Replace checklist items iteration and hide toggle
cl_iter_tgt = """                                        <div className="bg-white rounded-xl border border-gray-200 p-5">


                                            <div className="space-y-3">
                                                {localChecklist.map((item, idx) => ("""
cl_iter_repl = """                                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                                            <div className="flex justify-end mb-2">
                                                <button
                                                    onClick={() => setHideCompletedChecklistItems(!hideCompletedChecklistItems)}
                                                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                                >
                                                    {hideCompletedChecklistItems ? "Show completed items" : "Hide completed items"}
                                                </button>
                                            </div>

                                            <div className="space-y-3">
                                                {localChecklist.filter(item => !hideCompletedChecklistItems || !item.completed).map((item, idx) => ("""
content = content.replace(cl_iter_tgt, cl_iter_repl)

with open('src/components/TaskDetailsPanel.tsx', 'w') as f:
    f.write(content)
