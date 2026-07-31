const fs = require('fs');
const file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add new icons to import
content = content.replace(
  /from 'lucide-react';/,
  "LayoutGrid, List, ArrowUpDown\n} from 'lucide-react';"
);

// 2. Add new types
content = content.replace(
  /type CalendarView = 'month' \| 'week' \| 'day' \| 'timeline';/,
  "type CalendarView = 'month' | 'week' | 'day';\ntype TaskPageMode = 'calendar' | 'list' | 'board' | 'timeline';\ntype SortOption = 'dueDate' | 'priority' | 'assignee' | 'status' | 'hours' | 'employee';"
);

// 3. Add state variables
content = content.replace(
  /const \[viewMode, setViewMode\] = useState<CalendarView>\('month'\);/,
  "const [pageMode, setPageMode] = useState<TaskPageMode>('calendar');\n  const [viewMode, setViewMode] = useState<CalendarView>('month');\n  const [sortBy, setSortBy] = useState<SortOption>('dueDate');\n  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');"
);

// 4. Update filteredTasks to apply sorting for list view
const oldFilteredTasks = `  // Filter tasks
  const filteredTasks = useMemo(() => {
    let filtered = tasks.filter(t => 
      t.status !== 'completed' && 
      t.status !== 'cancelled'
    );

    if (filterTeam !== 'all') {
      filtered = filtered.filter(t => t.teamIds.includes(filterTeam));
    }
    if (filterPriority.length > 0) {
      filtered = filtered.filter(t => filterPriority.includes(t.priority));
    }
    if (filterStatus.length > 0) {
      filtered = filtered.filter(t => filterStatus.includes(t.status));
    }

    return filtered;
  }, [filterTeam, filterPriority, filterStatus]);`;

const newFilteredTasks = `  // Filter tasks
  const filteredTasks = useMemo(() => {
    let filtered = tasks.filter(t => 
      t.status !== 'completed' && 
      t.status !== 'cancelled'
    );

    if (filterTeam !== 'all') {
      filtered = filtered.filter(t => t.teamIds.includes(filterTeam));
    }
    if (filterPriority.length > 0) {
      filtered = filtered.filter(t => filterPriority.includes(t.priority));
    }
    if (filterStatus.length > 0) {
      filtered = filtered.filter(t => filterStatus.includes(t.status));
    }

    if (pageMode === 'list') {
      filtered.sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'dueDate':
            comparison = new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime();
            break;
          case 'priority':
            const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
            comparison = (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 9) - (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 9);
            break;
          case 'assignee':
          case 'employee':
            const assigneeA = a.assignedToId ? users.find(u => u.id === a.assignedToId)?.name || '' : '';
            const assigneeB = b.assignedToId ? users.find(u => u.id === b.assignedToId)?.name || '' : '';
            comparison = assigneeA.localeCompare(assigneeB);
            break;
          case 'status':
            comparison = a.status.localeCompare(b.status);
            break;
          case 'hours':
            comparison = (a.estimatedHours || 0) - (b.estimatedHours || 0);
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }, [filterTeam, filterPriority, filterStatus, pageMode, sortBy, sortDirection]);`;

content = content.replace(oldFilteredTasks, newFilteredTasks);

fs.writeFileSync(file, content);
console.log('CalendarView patched phase 1!');
