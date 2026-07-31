const fs = require('fs');

// Fix CalendarView
let cv = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx', 'utf8');
cv = cv.replace('filterPriority.includes(t.priority)', 't.priority && filterPriority.includes(t.priority)');
cv = cv.replace('setSortBy(option.value);', 'setSortBy(option.value as SortOption);');
fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx', cv);

// Fix WorkloadDashboard
let wd = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/WorkloadDashboard.tsx', 'utf8');
wd = wd.replace('filterPriority.includes(t.priority)', 't.priority && filterPriority.includes(t.priority)');
fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/WorkloadDashboard.tsx', wd);

// Fix TaskApproval
let ta = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/TaskApproval.tsx', 'utf8');
ta = ta.replace('getPriorityColor(task.priority)', "getPriorityColor(task.priority || 'normal')");
fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/TaskApproval.tsx', ta);

console.log('Fixed all TS errors!');
