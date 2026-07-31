const fs = require('fs');

let content = fs.readFileSync('src/components/TaskDetailsPanel.tsx', 'utf8');

// 1. Add Tag and supabase imports
if (!content.includes('import { supabase }')) {
    content = content.replace("import { User, ", "import { supabase } from '../lib/supabaseClient';\nimport { User, ");
}
if (!content.includes('Tag')) {
    content = content.replace("Client, Task, Comment, Priority", "Client, Task, Comment, Priority, Tag");
    content = content.replace("Priority } from '../types/types';", "Priority, Tag } from '../types/types';");
}

// 2. Change localTags to Tag[]
content = content.replace(
    "const [localTags, setLocalTags] = useState<string[]>(task?.tags || []);",
    "const [localTags, setLocalTags] = useState<Tag[]>(task?.tags || []);\n    const { allTags, refreshTags } = useData();"
);

// 3. Remove globalTagSettings
content = content.replace(/let globalTagSettings: Record<string, string> = \{[^}]*\};/m, "");

// 4. Update getTagColor
content = content.replace(
    /const getTagColor = \(tag: string\) => \{[\s\S]*?return 'bg-gray-100 text-gray-700';\n    \};/m,
    "const getTagColor = (color: string) => {\n        if (!color) return 'bg-gray-100 text-gray-700';\n        return color;\n    };"
);

// 5. Write back
fs.writeFileSync('src/components/TaskDetailsPanel.tsx', content);
