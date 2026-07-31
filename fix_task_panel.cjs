const fs = require('fs');
let content = fs.readFileSync('src/components/TaskDetailsPanel.tsx', 'utf8');

// fix imports
content = content.replace("import { supabase } from '../lib/supabaseClient';\n", "");
content = content.replace("import { User,", "import { supabase } from '../lib/supabaseClient';\nimport { useData } from '../contexts/DataContext';\nimport { User,");
content = content.replace("Priority, Tag } from '../types/types';", "Priority, Tag as TagType } from '../types/types';");

// fix type
content = content.replace("useState<Tag[]>", "useState<TagType[]>");

// fix globalTagSettings
// lines 275-278
content = content.replace(/globalTagSettings\[newName\] = editingTagColorRef.current;\n\s*if \(newName !== oldName\) \{\n\s*delete globalTagSettings\[oldName\];\n\s*setLocalTags\(localTagsRef.current.map\(t => t === oldName \? newName : t\)\);\n\s*\}/m, "if (newName !== oldName) {\nsetLocalTags(localTagsRef.current.map(t => t === oldName ? newName : t));\n}");
content = content.replace(/globalTagSettings\[newName\] = editingTagColorRef.current;\n/m, "");
content = content.replace(/delete globalTagSettings\[oldName\];\n/m, "");

// getTagColor fix
content = content.replace(/if \(globalTagSettings\[tag\]\) \{\n\s*return globalTagSettings\[tag\];\n\s*\}/g, "");

// parameter type fix
content = content.replace(/\.filter\(t => !localTags\.some\(lt => lt\.id === t\.id\)/g, ".filter((t: TagType) => !localTags.some((lt: TagType) => lt.id === t.id)");

fs.writeFileSync('src/components/TaskDetailsPanel.tsx', content);
