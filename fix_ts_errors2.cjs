const fs = require('fs');

let ta = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/TaskApproval.tsx', 'utf8');
ta = ta.replace(/task\.priority\.toUpperCase\(\)/g, "(task.priority || 'normal').toUpperCase()");
ta = ta.replace(/getPriorityColor\(task\.priority\)/g, "getPriorityColor(task.priority || 'normal')");
fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/TaskApproval.tsx', ta);

console.log('Fixed TaskApproval!');
