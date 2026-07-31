const fs = require('fs');
let content = fs.readFileSync('src/components/TaskDetailsPanel.tsx', 'utf8');

content = content.replace(
    'setLocalTags(localTags.filter((_, i) => i !== idx));',
    `const removedTag = localTags[idx];
     setLocalTags(localTags.filter((_, i) => i !== idx));
     if (task?.id && !task.id.startsWith('subtask-new')) {
         supabase.from('task_tags').delete().eq('task_id', task.id).eq('tag_id', removedTag.id).then(() => {
             refreshTasks();
         });
     }`
);

content = content.replace(
    `setLocalTags([...localTags, t]);`,
    `setLocalTags([...localTags, t]);
     if (task?.id && !task.id.startsWith('subtask-new')) {
         supabase.from('task_tags').insert({ task_id: task.id, tag_id: t.id }).then(() => refreshTasks());
     }`
);

content = content.replace(
    `setLocalTags([...localTags, data]);`,
    `setLocalTags([...localTags, data]);
     if (task?.id && !task.id.startsWith('subtask-new')) {
         supabase.from('task_tags').insert({ task_id: task.id, tag_id: data.id }).then(() => refreshTasks());
     }`
);

fs.writeFileSync('src/components/TaskDetailsPanel.tsx', content);
