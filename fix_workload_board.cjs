const fs = require('fs');
let content = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/WorkloadDashboard.tsx', 'utf8');

const renderBoardStart = "    const renderBoardView = () => {";
const renderBoardEnd = "    const renderTimelineView = () => {";

const beforeRenderBoard = content.substring(0, content.indexOf(renderBoardStart));
const afterRenderBoard = content.substring(content.indexOf(renderBoardEnd));

const newRenderBoard = `    const renderBoardView = () => {
        const boardUsers = [
            currentUser,
            ...filteredUsers.filter(u => u.id !== currentUser.id)
        ];

        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6 overflow-x-auto">
                <div className="flex gap-4 min-w-max">
                    {boardUsers.map(user => {
                        const columnTasks = activeTasks.filter(t => t.assignedToId === user.id);
                        const userTeam = getUserTeam(user.id);
                        const isCurrentUser = user.id === currentUser.id;

                        return (
                            <div key={user.id} className="space-y-3 w-72 flex-shrink-0">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                        <div 
                                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                            style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                                        >
                                            {user.name.split(' ').map(n => n[0]).join('')}
                                        </div>
                                        {user.name} {isCurrentUser && <span className="text-gray-400 font-normal">(You)</span>}
                                    </h3>
                                    <span className="text-xs text-gray-500">{columnTasks.length} tasks</span>
                                </div>

                                <div className="space-y-2 min-h-[400px]">
                                    {columnTasks.map(task => {
                                        const client = clients.find(c => c.id === task.clientId);

                                        return (
                                            <div
                                                key={task.id}
                                                onClick={() => handleTaskClick(task)}
                                                className="bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
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
                                                    <div className="text-xs text-gray-500 font-medium">
                                                        {task.estimatedHours}h
                                                    </div>
                                                    
                                                    {/* Status Badge */}
                                                    <div className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-700 capitalize">
                                                        {task.status.replace('_', ' ')}
                                                    </div>
                                                </div>

                                                <div className="text-xs text-gray-500 mt-2">
                                                    Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/WorkloadDashboard.tsx', beforeRenderBoard + newRenderBoard + afterRenderBoard);
