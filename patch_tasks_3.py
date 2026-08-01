import re

with open('src/components/TaskDetailsPanel.tsx', 'r') as f:
    content = f.read()

# 1. Checklist item complete
cl_comp_tgt = """                                                        <button
                                                            onClick={() => {
                                                                const newC = [...localChecklist];
                                                                newC[idx].completed = !newC[idx].completed;
                                                                setLocalChecklist(newC);
                                                            }}"""
cl_comp_repl = """                                                        <button
                                                            onClick={() => {
                                                                const newC = [...localChecklist];
                                                                const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                if (realIdx !== -1) {
                                                                    newC[realIdx].completed = !newC[realIdx].completed;
                                                                    updateChecklistInDB(newC);
                                                                }
                                                            }}"""
content = content.replace(cl_comp_tgt, cl_comp_repl)

# 2. Checklist item text input
cl_txt_tgt = """                                                        <input
                                                            type="text"
                                                            value={item.text}
                                                            onChange={(e) => {
                                                                const newC = [...localChecklist];
                                                                newC[idx].text = e.target.value;
                                                                setLocalChecklist(newC);
                                                            }}
                                                            onKeyDown={(e) => {"""
cl_txt_repl = """                                                        <input
                                                            type="text"
                                                            value={item.text}
                                                            onChange={(e) => {
                                                                const newC = [...localChecklist];
                                                                const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                if (realIdx !== -1) {
                                                                    newC[realIdx].text = e.target.value;
                                                                    setLocalChecklist(newC);
                                                                }
                                                            }}
                                                            onBlur={() => updateChecklistInDB(localChecklist)}
                                                            onKeyDown={(e) => {"""
content = content.replace(cl_txt_tgt, cl_txt_repl)

# 3. Checklist assignee (unassigned)
cl_assg_tgt = """                                                                    <button
                                                                        onClick={() => {
                                                                            const newC = [...localChecklist];
                                                                            newC[idx].assigneeId = undefined;
                                                                            setLocalChecklist(newC);
                                                                        }}"""
cl_assg_repl = """                                                                    <button
                                                                        onClick={() => {
                                                                            const newC = [...localChecklist];
                                                                            const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                            if (realIdx !== -1) {
                                                                                newC[realIdx].assigneeId = undefined;
                                                                                updateChecklistInDB(newC);
                                                                            }
                                                                        }}"""
content = content.replace(cl_assg_tgt, cl_assg_repl)

# 4. Checklist assignee (assigned)
cl_assg2_tgt = """                                                                            onClick={() => {
                                                                                const newC = [...localChecklist];
                                                                                newC[idx].assigneeId = u.id;
                                                                                setLocalChecklist(newC);
                                                                            }}"""
cl_assg2_repl = """                                                                            onClick={() => {
                                                                                const newC = [...localChecklist];
                                                                                const realIdx = localChecklist.findIndex(c => c.id === item.id);
                                                                                if (realIdx !== -1) {
                                                                                    newC[realIdx].assigneeId = u.id;
                                                                                    updateChecklistInDB(newC);
                                                                                }
                                                                            }}"""
content = content.replace(cl_assg2_tgt, cl_assg2_repl)

# 5. Checklist delete item
cl_del_tgt = """                                                        <button
                                                            onClick={() => setLocalChecklist(localChecklist.filter((_, i) => i !== idx))}
                                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity flex-shrink-0"
                                                        >"""
cl_del_repl = """                                                        <button
                                                            onClick={() => updateChecklistInDB(localChecklist.filter(c => c.id !== item.id))}
                                                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity flex-shrink-0"
                                                        >"""
content = content.replace(cl_del_tgt, cl_del_repl)

# 6. Checklist add item
cl_add_tgt = """                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && newChecklistItem.trim()) {
                                                                    e.preventDefault();
                                                                    setLocalChecklist([...localChecklist, { id: `chk-${Date.now()}`, text: newChecklistItem.trim(), completed: false, assigneeId: newChecklistAssigneeId }]);
                                                                    setNewChecklistItem('');
                                                                    setNewChecklistAssigneeId(undefined);
                                                                }
                                                            }}"""
cl_add_repl = """                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && newChecklistItem.trim()) {
                                                                    e.preventDefault();
                                                                    updateChecklistInDB([...localChecklist, { id: `chk-${Date.now()}`, text: newChecklistItem.trim(), completed: false, assigneeId: newChecklistAssigneeId }]);
                                                                    setNewChecklistItem('');
                                                                    setNewChecklistAssigneeId(undefined);
                                                                }
                                                            }}"""
content = content.replace(cl_add_tgt, cl_add_repl)

# 7. Subtask Drop
st_drop_tgt = """                                                            task.subtaskIds = ids;
                                                            setLocalSubtaskIds(ids);
                                                            setDragOverSubtaskId(null);"""
st_drop_repl = """                                                            task.subtaskIds = ids;
                                                            updateSubtaskOrderInDB(ids);
                                                            setDragOverSubtaskId(null);"""
content = content.replace(st_drop_tgt, st_drop_repl)

# 8. Delete entire checklist (dropdown)
cl_del_all_tgt = """                                                            <button onClick={() => setLocalChecklist([])} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-600">"""
cl_del_all_repl = """                                                            <button onClick={() => updateChecklistInDB([])} className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-600">"""
content = content.replace(cl_del_all_tgt, cl_del_all_repl)

with open('src/components/TaskDetailsPanel.tsx', 'w') as f:
    f.write(content)
