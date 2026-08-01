import re
with open('/Users/jaysimhan/.gemini/antigravity-ide/brain/a966140a-b59c-4230-a9be-ab4a54b7e534/task.md', 'r') as f:
    content = f.read()

content = content.replace('- [ ] Add UI to edit Checklist Title and Subtasks Title', '- [x] Add UI to edit Checklist Title and Subtasks Title')
content = content.replace('- [ ] Add UI to toggle "Hide Completed Checklist Items"', '- [x] Add UI to toggle "Hide Completed Checklist Items"')
content = content.replace('- [ ] Add UI to edit Tags', '- [x] Add UI to edit Tags')

with open('/Users/jaysimhan/.gemini/antigravity-ide/brain/a966140a-b59c-4230-a9be-ab4a54b7e534/task.md', 'w') as f:
    f.write(content)
