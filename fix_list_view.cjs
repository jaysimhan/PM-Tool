const fs = require('fs');
let file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx';
let content = fs.readFileSync(file, 'utf8');

const renderLogicStart = "  const renderListView = () => (";
const renderLogicEnd = `                      </div>
                  );
              })}
          </div>
      </div>
  );`;

const startIndex = content.indexOf(renderLogicStart);
const endIndex = content.indexOf(renderLogicEnd) + renderLogicEnd.length;

if (startIndex !== -1 && endIndex !== -1) {
  const newListView = `  const getTagColor = (tag: string) => {
    // Generate a consistent color based on string
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return \`hsl(\${hue}, 70%, 45%)\`;
  };

  const renderTaskRow = (task: Task, depth: number): React.ReactNode[] => {
      const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
      const category = workCategories.find(c => c.id === task.categoryId);
      const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;
      const hasSubtasks = task.subtaskIds && task.subtaskIds.length > 0;
      const isExpanded = expandedTasks.has(task.id);
      
      // Determine solid color from tailwind classes
      const statusColorCls = getStatusBadgeColor(task.status);
      let dotColor = '#F59E0B'; // default
      if (statusColorCls.includes('blue')) dotColor = '#3B82F6';
      else if (statusColorCls.includes('green')) dotColor = '#10B981';
      else if (statusColorCls.includes('purple')) dotColor = '#8B5CF6';
      else if (statusColorCls.includes('gray')) dotColor = '#6B7280';

      const row = (
          <tr key={task.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => handleTaskClick(task)}>
              <td className="px-4 py-3 min-w-[300px]">
                  <div className="flex items-center gap-2" style={{ paddingLeft: \`\${depth * 24}px\` }}>
                      {hasSubtasks ? (
                          <button onClick={(e) => toggleTaskExpansion(task.id, e)} className="p-0.5 hover:bg-gray-200 rounded text-gray-500 transition-colors">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                          </button>
                      ) : (
                          <div className="w-5" />
                      )}
                      
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-sm" style={{ backgroundColor: dotColor }}>
                          {formatStatusLabel(task.status).charAt(0).toUpperCase()}
                      </div>
                      
                      <span className="text-sm font-medium text-gray-900 truncate" title={task.title}>{task.title}</span>
                  </div>
              </td>
              
              <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                      {task.tags && task.tags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-0.5 text-[10px] rounded-full border" style={{ backgroundColor: \`\${getTagColor(tag)}15\`, color: getTagColor(tag), borderColor: \`\${getTagColor(tag)}30\` }}>
                              {tag}
                          </span>
                      ))}
                  </div>
              </td>
              
              <td className="px-4 py-3">
                  {category && (
                      <span className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded-md">
                          {category.name}
                      </span>
                  )}
              </td>
              
              <td className="px-4 py-3">
                  {assignedUser ? (
                      <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ backgroundColor: userTeam?.color || '#6B7280' }}>
                              {assignedUser.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="text-xs text-gray-700">{assignedUser.name}</span>
                      </div>
                  ) : (
                      <div className="w-6 h-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400" title="Unassigned">
                          <Users className="w-3 h-3" />
                      </div>
                  )}
              </td>
              
              <td className="px-4 py-3 text-xs text-gray-600">
                  {task.dueDate ? (
                      <span className={new Date(task.dueDate) < new Date() ? 'text-red-600 font-medium' : ''}>
                          {new Date(task.dueDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                      </span>
                  ) : '-'}
              </td>
              
              <td className="px-4 py-3">
                  <span className="text-[11px] font-medium px-2 py-1 rounded" style={{ backgroundColor: \`\${getPriorityColor(task.priority)}15\`, color: getPriorityColor(task.priority) }}>
                      {(task.priority || 'Normal').toUpperCase()}
                  </span>
              </td>
              
              <td className="px-4 py-3 text-xs text-gray-600">
                  {task.actualHours || 0} / {task.estimatedHours}h
              </td>
          </tr>
      );

      let rows = [row];
      
      if (isExpanded && hasSubtasks) {
          // get real tasks, not just filtered ones, so subtasks are always accessible
          const subtasks = tasks.filter(t => task.subtaskIds.includes(t.id));
          subtasks.forEach(sub => {
              rows = rows.concat(renderTaskRow(sub, depth + 1));
          });
      }
      
      return rows;
  };

  const renderListView = () => {
      // Only show top level tasks in the root of the table that match the filters
      const topLevelTasks = activeTasks.filter(t => !t.isSubtask);
      
      return (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tags</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Channel</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Assignee</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Due date</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Hours</th>
                          </tr>
                      </thead>
                      <tbody className="bg-white">
                          {topLevelTasks.length > 0 ? (
                              topLevelTasks.map(t => (
                                  <React.Fragment key={t.id}>
                                      {renderTaskRow(t, 0)}
                                  </React.Fragment>
                              ))
                          ) : (
                              <tr>
                                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                                      No tasks found matching your filters.
                                  </td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
          </div>
      );
  };`;
  
  content = content.substring(0, startIndex) + newListView + content.substring(endIndex);
  fs.writeFileSync(file, content);
  console.log('List view updated successfully!');
} else {
  console.log('Could not find boundaries.');
  console.log('Start:', startIndex, 'End:', endIndex);
}
