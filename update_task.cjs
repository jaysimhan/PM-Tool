const fs = require('fs');
let content = fs.readFileSync('/Users/jaysimhan/.gemini/antigravity-ide/brain/39fa1224-531c-4fd1-8dc4-7322a1893456/task.md', 'utf8');

content = content.replace("- [ ] Refactor `GlobalSearch.tsx` filtering", "- [x] Refactor `GlobalSearch.tsx` filtering");
content = content.replace("- [ ] Refactor `CalendarView.tsx` tag rendering", "- [x] Refactor `CalendarView.tsx` tag rendering");
content = content.replace("- [ ] Refactor `RequestForm.tsx`", "- [x] Refactor `RequestForm.tsx`");

fs.writeFileSync('/Users/jaysimhan/.gemini/antigravity-ide/brain/39fa1224-531c-4fd1-8dc4-7322a1893456/task.md', content);
