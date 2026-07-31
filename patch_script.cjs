const fs = require('fs');
const file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/TaskDetailsPanel.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Imports
content = content.replace(
    /Settings, CornerDownLeft, Trash2\n\} from 'lucide-react';/,
    "Settings, CornerDownLeft, Trash2, Workflow, GitBranch, ListChecks\n} from 'lucide-react';"
);

// 2. State
content = content.replace(
    /const \[localPriority, setLocalPriority\] = useState<Priority \| undefined>\(task\?\.priority\);/,
    "const [localPriority, setLocalPriority] = useState<Priority | undefined>(task?.priority);\n    const [localAssignedToId, setLocalAssignedToId] = useState<string | undefined>(task?.assignedToId);\n    const [showAssigneePicker, setShowAssigneePicker] = useState(false);\n    const assigneePickerRef = useRef<HTMLDivElement>(null);"
);

// 3. Initialize
content = content.replace(
    /setLocalPriority\(task\.priority \|\| 'normal'\);/,
    "setLocalPriority(task.priority || 'normal');\n            setLocalAssignedToId(task.assignedToId);"
);

// 4. Outside clicks
content = content.replace(
    /if \(priorityRef\.current && !priorityRef\.current\.contains\(e\.target as Node\)\) \{\n                setShowPriorityDropdown\(false\);\n            \}/,
    "if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) {\n                setShowPriorityDropdown(false);\n            }\n            if (assigneePickerRef.current && !assigneePickerRef.current.contains(e.target as Node)) {\n                setShowAssigneePicker(false);\n            }"
);

// 5. SectionLabel
content = content.replace(
    /function SectionLabel\(\{ children \}: \{ children: React\.ReactNode \}\) \{\n    return <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">\{children\}<\/div>;\n\}/,
    "function SectionLabel({ children, icon }: { children: React.ReactNode, icon?: React.ReactNode }) {\n    return <div className=\"text-[15px] font-semibold text-gray-900 mb-3 flex items-center gap-2\">{icon && <span className=\"text-gray-400\">{icon}</span>}{children}</div>;\n}"
);
// Wait, the regex for SectionLabel might fail because it was already replaced by multi_replace_file_content? No, I failed multi replace.

// 6. Assignee UI replacement
const oldAssigneeUI = `<FieldRow label="Assignee">
                                        <div className="flex items-center gap-2">
                                            {assignedUser ? (
                                                <>
                                                    <Avatar user={assignedUser} size="xs" />
                                                    <span className="text-sm text-gray-800 font-medium">{assignedUser.name}</span>
                                                </>
                                            ) : (
                                                <span className="text-sm text-gray-400">Unassigned</span>
                                            )}
                                        </div>
                                    </FieldRow>`;
const newAssigneeUI = `<FieldRow label="Assignee">
                                        <div className="relative" ref={assigneePickerRef}>
                                            <div 
                                                className="flex items-center gap-2 cursor-pointer group"
                                                onClick={() => setShowAssigneePicker(!showAssigneePicker)}
                                            >
                                                {localAssignedToId && users.find(u => u.id === localAssignedToId) ? (
                                                    <>
                                                        <Avatar user={users.find(u => u.id === localAssignedToId)!} size="xs" />
                                                        <span className="text-sm text-gray-800 font-medium group-hover:text-blue-600 transition-colors">{users.find(u => u.id === localAssignedToId)?.name}</span>
                                                    </>
                                                ) : (
                                                    <div className="text-sm text-gray-400 group-hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                                                        <UserIcon className="w-3.5 h-3.5" /> Unassigned
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {showAssigneePicker && (
                                                <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden font-sans">
                                                    <div className="max-h-64 overflow-y-auto p-1">
                                                        <button
                                                            onClick={() => { setLocalAssignedToId(undefined); setShowAssigneePicker(false); }}
                                                            className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                        >
                                                            <UserIcon className="w-4 h-4" /> Unassigned
                                                        </button>
                                                        {users.map(u => (
                                                            <button
                                                                key={u.id}
                                                                onClick={() => { setLocalAssignedToId(u.id); setShowAssigneePicker(false); }}
                                                                className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-800"
                                                            >
                                                                <Avatar user={u} size="xs" /> {u.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </FieldRow>`;
content = content.replace(oldAssigneeUI, newAssigneeUI);

// 8. Update FieldRow signature
content = content.replace(
    /function FieldRow\(\{ label, children \}: \{ label: string; children: React\.ReactNode \}\) \{/,
    "function FieldRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {"
);

content = content.replace(
    /<FieldRow label="Dependencies">/,
    '<FieldRow label={<div className="flex items-center gap-1.5 text-gray-700 font-semibold"><Workflow className="w-4 h-4 text-gray-400" /> Dependencies</div>}>'
);
content = content.replace(
    /<SectionLabel>Checklist<\/SectionLabel>/,
    '<SectionLabel icon={<ListChecks className="w-4 h-4" />}>Checklist</SectionLabel>'
);
content = content.replace(
    /<SectionLabel>Subtasks<\/SectionLabel>/,
    '<SectionLabel icon={<GitBranch className="w-4 h-4" />}>Subtasks</SectionLabel>'
);
content = content.replace(
    /depth < 3 && \(/,
    'depth < 4 && ('
);

// 9. Checklist assignee
const oldChecklistItem = `<div key={item.id} className="flex items-start gap-2 group">
                                                    <input
                                                        type="checkbox"
                                                        checked={item.completed}
                                                        onChange={() => {
                                                            const newC = [...localChecklist];
                                                            newC[idx].completed = !newC[idx].completed;
                                                            setLocalChecklist(newC);
                                                        }}
                                                        className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={item.text}
                                                        onChange={(e) => {
                                                            const newC = [...localChecklist];
                                                            newC[idx].text = e.target.value;
                                                            setLocalChecklist(newC);
                                                        }}
                                                        className={\`flex-1 text-sm bg-transparent border-0 p-0 focus:ring-0 \${item.completed ? 'text-gray-400 line-through' : 'text-gray-700'}\`}
                                                    />
                                                    <button
                                                        onClick={() => setLocalChecklist(localChecklist.filter(c => c.id !== item.id))}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>`;
const newChecklistItem = `<div key={item.id} className="flex items-start gap-2 group">
                                                    <input
                                                        type="checkbox"
                                                        checked={item.completed}
                                                        onChange={() => {
                                                            const newC = [...localChecklist];
                                                            newC[idx].completed = !newC[idx].completed;
                                                            setLocalChecklist(newC);
                                                        }}
                                                        className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={item.text}
                                                        onChange={(e) => {
                                                            const newC = [...localChecklist];
                                                            newC[idx].text = e.target.value;
                                                            setLocalChecklist(newC);
                                                        }}
                                                        className={\`flex-1 text-sm bg-transparent border-0 p-0 focus:ring-0 \${item.completed ? 'text-gray-400 line-through' : 'text-gray-700'}\`}
                                                    />
                                                    
                                                    {/* Checklist Assignee Picker */}
                                                    <div className="relative group/picker">
                                                        <div className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-gray-100 cursor-pointer">
                                                            {item.assigneeId && users.find(u => u.id === item.assigneeId) ? (
                                                                <Avatar user={users.find(u => u.id === item.assigneeId)!} size="xs" />
                                                            ) : (
                                                                <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                                                            )}
                                                        </div>
                                                        <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden font-sans opacity-0 invisible group-hover/picker:opacity-100 group-hover/picker:visible transition-all">
                                                            <div className="max-h-48 overflow-y-auto p-1">
                                                                <button
                                                                    onClick={() => {
                                                                        const newC = [...localChecklist];
                                                                        newC[idx].assigneeId = undefined;
                                                                        setLocalChecklist(newC);
                                                                    }}
                                                                    className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-600"
                                                                >
                                                                    <UserIcon className="w-4 h-4" /> Unassigned
                                                                </button>
                                                                {users.map(u => (
                                                                    <button
                                                                        key={u.id}
                                                                        onClick={() => {
                                                                            const newC = [...localChecklist];
                                                                            newC[idx].assigneeId = u.id;
                                                                            setLocalChecklist(newC);
                                                                        }}
                                                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded flex items-center gap-2 text-sm text-gray-800"
                                                                    >
                                                                        <Avatar user={u} size="xs" /> {u.name}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={() => setLocalChecklist(localChecklist.filter(c => c.id !== item.id))}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>`;
content = content.replace(oldChecklistItem, newChecklistItem);

// Add task assignee to new checklist items
content = content.replace(
    /setLocalChecklist\(\[\.\.\.localChecklist, \{ id: \`chk-\$\{Date\.now\(\)\}\`, text: newChecklistItem\.trim\(\), completed: false \}\]\);/,
    "setLocalChecklist([...localChecklist, { id: `chk-${Date.now()}`, text: newChecklistItem.trim(), completed: false, assigneeId: localAssignedToId }]);"
);

// 10. Tags permissions
content = content.replace(
    /<button\n                                                                                onClick=\{\(\) => setAddingNewTag\(true\)\}\n                                                                                className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-blue-600 text-sm font-medium transition-colors border-t border-gray-100 flex items-center justify-center gap-1"\n                                                                            >\n                                                                                <Plus className="w-3.5 h-3.5" \/> Create new tag\n                                                                            <\/button>/,
    `{(currentUser.role === 'team_leader' || currentUser.role === 'administrator') && (
                                                                            <button
                                                                                onClick={() => setAddingNewTag(true)}
                                                                                className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-blue-600 text-sm font-medium transition-colors border-t border-gray-100 flex items-center justify-center gap-1"
                                                                            >
                                                                                <Plus className="w-3.5 h-3.5" /> Create new tag
                                                                            </button>
                                                                        )}`
);

content = content.replace(
    /<button\n                                                                                        onClick=\{\(e\) => \{\n                                                                                            e\.stopPropagation\(\);\n                                                                                            setEditingTagId\(tag\.id\);\n                                                                                        \}\}\n                                                                                        className="opacity-0 group-hover\/item:opacity-100 p-1 text-gray-400 hover:text-gray-600 transition-all"\n                                                                                    >\n                                                                                        <Settings className="w-3\.5 h-3\.5" \/>\n                                                                                    <\/button>/,
    `{(currentUser.role === 'team_leader' || currentUser.role === 'administrator') && (
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setEditingTagId(tag.id);
                                                                                        }}
                                                                                        className="opacity-0 group-hover/item:opacity-100 p-1 text-gray-400 hover:text-gray-600 transition-all"
                                                                                    >
                                                                                        <Settings className="w-3.5 h-3.5" />
                                                                                    </button>
                                                                                )}`
);

fs.writeFileSync(file, content);
console.log('TaskDetailsPanel patched!');
