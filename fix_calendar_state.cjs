const fs = require('fs');
let file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx';
let content = fs.readFileSync(file, 'utf8');

// Insert expandedTasks state
content = content.replace("  const [viewMode, setViewMode] = useState<CalendarView>('month');", `  const [viewMode, setViewMode] = useState<CalendarView>('month');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const toggleTaskExpansion = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };`);

// Add Avatar and Tag to lucide imports if not there
content = content.replace("import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, ArrowUpDown } from 'lucide-react';", "import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, ArrowUpDown, ChevronDown, ChevronRight as ChevronRightIcon } from 'lucide-react';");

fs.writeFileSync(file, content);
console.log('Fixed state and imports!');
