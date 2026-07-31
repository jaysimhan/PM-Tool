const fs = require('fs');
let content = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/App.tsx', 'utf8');

// Ensure GlobalSearch is imported
if (!content.includes('import { GlobalSearch }')) {
  content = content.replace("import { Logo } from './components/Logo';", "import { Logo } from './components/Logo';\nimport { GlobalSearch } from './components/GlobalSearch';");
}

// Extract old search block and replace it
const oldSearchStart = '<div className="relative group">';
const oldSearchEnd = '</div>\n                        </div>\n\n                        {/* User switcher for demo */}';
const startIndex = content.indexOf(oldSearchStart);
const endIndex = content.indexOf(oldSearchEnd);

if (startIndex !== -1 && endIndex !== -1) {
    const toReplace = content.substring(startIndex, endIndex);
    content = content.replace(toReplace, '<GlobalSearch isMac={isMac} />\n                        ');
}

fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/App.tsx', content);
console.log('Global search updated in App.tsx');
