const fs = require('fs');
let content = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx', 'utf8');

// Fix imports
content = content.replace("import { ChevronLeft, ChevronRight, Filter, Download, Plus, LayoutGrid, List, ArrowUpDown, Calendar, GanttChart } from 'lucide-react';", "import { ChevronLeft, ChevronRight, ChevronDown, Users, Filter, Download, Plus, LayoutGrid, List, ArrowUpDown, Calendar, GanttChart } from 'lucide-react';");

// Fix ChevronRightIcon -> ChevronRight
content = content.replace(/<ChevronRightIcon className="w-4 h-4" \/>/g, '<ChevronRight className="w-4 h-4" />');

// Fix concat error (change ReactNode[] to React.ReactElement[])
content = content.replace("const renderTaskRow = (task: Task, depth: number): React.ReactNode[] => {", "const renderTaskRow = (task: Task, depth: number): React.ReactElement[] => {");
content = content.replace("rows = rows.concat(renderTaskRow(sub, depth + 1));", "rows = [...rows, ...renderTaskRow(sub, depth + 1)];");

fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx', content);
