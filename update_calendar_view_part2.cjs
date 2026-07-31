const fs = require('fs');
const file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx';
let content = fs.readFileSync(file, 'utf8');

// The render logic string
const renderLogic = `
  const activeTasks = filteredTasks;

  const getUserTeam = (userId) => {
    const user = users.find(u => u.id === userId);
    if (!user || user.teamIds.length === 0) return null;
    return teams.find(t => t.id === user.teamIds[0]) || null;
  };

  const renderListView = () => (
      <div className="bg-white rounded-lg border border-gray-200">
          {/* Sort Controls */}
          <div className="border-b border-gray-200 p-4 flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Sort by:</span>
              <div className="flex items-center gap-2">
                  {[
                      { value: 'dueDate', label: 'Due Date' },
                      { value: 'priority', label: 'Priority' },
                      { value: 'assignee', label: 'Assignee' },
                      { value: 'status', label: 'Status' },
                      { value: 'hours', label: 'Hours' },
                      { value: 'employee', label: 'Employee' }
                  ].map(option => (
                      <button
                          key={option.value}
                          onClick={() => {
                              if (sortBy === option.value) {
                                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                              } else {
                                  setSortBy(option.value);
                                  setSortDirection('asc');
                              }
                          }}
                          className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${sortBy === option.value
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'text-gray-600 hover:bg-gray-100'
                              }\`}
                      >
                          {option.label}
                          {sortBy === option.value && (
                              <ArrowUpDown className={\`w-3 h-3 inline ml-1 \${sortDirection === 'desc' ? 'rotate-180' : ''}\`} />
                          )}
                      </button>
                  ))}
              </div>
          </div>

          <div className="p-6 space-y-3">
              {activeTasks.map(task => {
                  const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                  const client = clients.find(c => c.id === task.clientId);
                  const category = workCategories.find(c => c.id === task.categoryId);
                  const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;

                  return (
                      <div
                          key={task.id}
                          onClick={() => handleTaskClick(task)}
                          className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                      >
                          <div className="flex items-start justify-between">
                              <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                      <div
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: getPriorityColor(task.priority) }}
                                      ></div>
                                      <h3 className="text-sm font-medium text-gray-900">{task.title}</h3>
                                      <span className={\`text-xs px-2 py-0.5 rounded \${getStatusBadgeColor(task.status)}\`}>
                                          {formatStatusLabel(task.status)}
                                      </span>
                                  </div>

                                  <p className="text-xs text-gray-600 mb-3">{task.description}</p>

                                  <div className="flex items-center gap-4 text-xs text-gray-500">
                                      <span>{client?.name}</span>
                                      <span>•</span>
                                      <span>{category?.name}</span>
                                      <span>•</span>
                                      <span>{task.estimatedHours}h</span>
                                      <span>•</span>
                                      <span>Due {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'}</span>
                                  </div>
                              </div>

                              {assignedUser && (
                                  <div className="ml-4 flex items-center gap-2">
                                      <div
                                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                          style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                      >
                                          {assignedUser.name.split(' ').map(n => n[0]).join('')}
                                      </div>
                                      <div>
                                          <div className="text-xs font-medium text-gray-900">{assignedUser.name}</div>
                                          <div className="text-xs text-gray-500">{userTeam?.name}</div>
                                      </div>
                                  </div>
                              )}
                          </div>
                      </div>
                  );
              })}
          </div>
      </div>
  );

  const renderBoardView = () => {
      const statusColumns = [
          { status: 'scheduled', label: 'Planning', color: 'bg-purple-100' },
          { status: 'in_progress', label: 'In Progress', color: 'bg-blue-100' },
          { status: 'in_review', label: 'Review', color: 'bg-yellow-100' },
          { status: 'manager_review_required', label: 'Manager Review', color: 'bg-orange-100' },
          { status: 'accepted', label: 'Accepted', color: 'bg-green-100' },
          { status: 'on_hold', label: 'On Hold', color: 'bg-gray-100' }
      ];

      return (
          <div className="bg-white rounded-lg border border-gray-200 p-6 overflow-x-auto">
              <div className="flex gap-4 min-w-max">
                  {statusColumns.map(column => {
                      const columnTasks = activeTasks.filter(t => t.status === column.status);

                      return (
                          <div key={column.status} className="space-y-3 w-72 flex-shrink-0">
                              <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-gray-900">{column.label}</h3>
                                  <span className="text-xs text-gray-500">{columnTasks.length}</span>
                              </div>

                              <div className="space-y-2 min-h-[400px]">
                                  {columnTasks.map(task => {
                                      const assignedUser = task.assignedToId ? users.find(u => u.id === task.assignedToId) : null;
                                      const userTeam = assignedUser ? getUserTeam(assignedUser.id) : null;

                                      return (
                                          <div
                                              key={task.id}
                                              onClick={() => handleTaskClick(task)}
                                              className={\`\${column.color} border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow\`}
                                          >
                                              <div className="flex items-start gap-2 mb-2">
                                                  <div
                                                      className="w-1 h-1 rounded-full mt-1.5"
                                                      style={{ backgroundColor: getPriorityColor(task.priority) }}
                                                  ></div>
                                                  <h4 className="text-sm font-medium text-gray-900 flex-1">{task.title}</h4>
                                              </div>

                                              <p className="text-xs text-gray-600 mb-2 line-clamp-2">{task.description}</p>

                                              <div className="flex items-center justify-between">
                                                  <div className="text-xs text-gray-500">
                                                      {task.estimatedHours}h
                                                  </div>

                                                  {assignedUser && (
                                                      <div className="flex items-center gap-1">
                                                          <div
                                                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                                              style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                                          >
                                                              {assignedUser.name.split(' ').map(n => n[0]).join('')}
                                                          </div>
                                                      </div>
                                                  )}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

`;

content = content.replace('  return (', renderLogic + '\n  return (');

fs.writeFileSync(file, content);
console.log('CalendarView patched phase 2!');
