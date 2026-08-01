import re

with open('src/components/TaskDetailsPanel.tsx', 'r') as f:
    content = f.read()

# 1. Add imports if needed
if "import { supabase }" not in content:
    content = content.replace("import { format, isToday } from 'date-fns';", "import { format, isToday } from 'date-fns';\nimport { supabase } from '../lib/supabaseClient';")

# 2. Task Title Save
title_target = """                                    onChange={(e) => {
                                        setTitle(e.target.value);
                                        // Auto-resize
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                    }}"""
title_repl = """                                    onChange={(e) => {
                                        setTitle(e.target.value);
                                        // Auto-resize
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                    onBlur={async () => {
                                        if (task) {
                                            await supabase.from('tasks').update({ title: title.trim() }).eq('id', task.id);
                                            refreshTasks();
                                        }
                                    }}"""
content = content.replace(title_target, title_repl)

# 3. Task Description Save
desc_target = """                                    onChange={(e) => setDescription(e.target.value)}"""
desc_repl = """                                    onChange={(e) => setDescription(e.target.value)}
                                    onBlur={async () => {
                                        if (task) {
                                            await supabase.from('tasks').update({ description: description.trim() }).eq('id', task.id);
                                            refreshTasks();
                                        }
                                    }}"""
content = content.replace(desc_target, desc_repl)

# 4. State variables for UI editing
state_vars = """    const [localLinked, setLocalLinked] = useState<string[]>(task?.linkedTaskIds || []);
    const [localTags, setLocalTags] = useState(task?.tags || []);"""
state_repl = """    const [localLinked, setLocalLinked] = useState<string[]>(task?.linkedTaskIds || []);
    const [localTags, setLocalTags] = useState(task?.tags || []);
    const [subtasksTitle, setSubtasksTitle] = useState('Subtasks');
    const [isEditingSubtasksTitle, setIsEditingSubtasksTitle] = useState(false);
    const [checklistTitle, setChecklistTitle] = useState('Checklist');
    const [isEditingChecklistTitle, setIsEditingChecklistTitle] = useState(false);
    const [hideCompletedChecklistItems, setHideCompletedChecklistItems] = useState(false);
    const [editingTagId, setEditingTagId] = useState<string | null>(null);
    const [editingTagName, setEditingTagName] = useState('');
    const [editingTagColor, setEditingTagColor] = useState('');"""
content = content.replace(state_vars, state_repl)

# 5. updateChecklistInDB and updateSubtaskOrderInDB
update_fns_target = """    const handleMarkComplete = () => {
        const next = localStatus === 'completed' ? 'in_progress' : 'completed';
        handleStatusChange(next);
    };"""
update_fns_repl = """    const handleMarkComplete = () => {
        const next = localStatus === 'completed' ? 'in_progress' : 'completed';
        handleStatusChange(next);
    };

    const updateChecklistInDB = async (newList: typeof localChecklist) => {
        setLocalChecklist(newList);
        if (task) {
            await supabase.from('tasks').update({ checklist: newList }).eq('id', task.id);
            refreshTasks();
        }
    };

    const updateSubtaskOrderInDB = async (newIds: string[]) => {
        setLocalSubtaskIds(newIds);
        if (task) {
            await supabase.from('tasks').update({ subtask_ids: newIds }).eq('id', task.id);
            refreshTasks();
        }
    };"""
content = content.replace(update_fns_target, update_fns_repl)

with open('src/components/TaskDetailsPanel.tsx', 'w') as f:
    f.write(content)
