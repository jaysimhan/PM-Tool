const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/components/**/*.tsx');

let dummyButtons = [];

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    let inButton = false;
    let buttonLines = [];
    let startLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('<button')) {
            inButton = true;
            buttonLines = [line];
            startLine = i + 1;
        } else if (inButton) {
            buttonLines.push(line);
        }
        
        if (inButton && line.includes('>')) {
            inButton = false;
            const buttonContent = buttonLines.join(' ');
            // Check if it doesn't have onClick, or if it has an empty onClick
            if (!buttonContent.includes('onClick=') || 
                buttonContent.match(/onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/) ||
                buttonContent.match(/onClick=\{\s*\(\s*\)\s*=>\s*console\.log/)) {
                
                // Get the text inside the button if possible
                let textMatch = buttonContent.match(/>(.*?)<\/button>/);
                let text = textMatch ? textMatch[1].replace(/<[^>]*>?/gm, '').trim() : '';
                
                dummyButtons.push({
                    file,
                    line: startLine,
                    code: buttonLines[0].trim().substring(0, 50) + '...',
                    text: text
                });
            }
        }
    }
});

console.log(JSON.stringify(dummyButtons, null, 2));
