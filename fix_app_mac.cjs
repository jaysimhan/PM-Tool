const fs = require('fs');
let content = fs.readFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/App.tsx', 'utf8');

// Replace imports
content = content.replace("import React, { useState, Suspense, lazy } from 'react';", "import React, { useState, Suspense, lazy, useEffect } from 'react';");

// Insert logic
content = content.replace("export default function Component() {", `export default function Component() {
    const [isMac, setIsMac] = useState(true);

    useEffect(() => {
        setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    }, []);`);

// Update label
content = content.replace('>⌘K</kbd>', '>{isMac ? "⌘K" : "Ctrl+K"}</kbd>');

fs.writeFileSync('/Users/jaysimhan/Desktop/Downloads+/PM Web/src/App.tsx', content);
console.log('Fixed mac/windows detection!');
