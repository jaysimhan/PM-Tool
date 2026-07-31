const fs = require('fs');
const file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx';
let content = fs.readFileSync(file, 'utf8');

// The inserted block goes from `  const activeTasks = filteredTasks;` to just before `  return (` (the first one)
// I will just use regex to remove it from inside renderMonthView
const renderLogicStart = "  const activeTasks = filteredTasks;";
const renderLogicEnd = `                                                  )}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };`;

const startIndex = content.indexOf(renderLogicStart);
const endIndex = content.indexOf(renderLogicEnd) + renderLogicEnd.length;

if (startIndex !== -1 && endIndex !== -1) {
  const blockToMove = content.substring(startIndex, endIndex);
  // Remove it from current location
  content = content.substring(0, startIndex) + content.substring(endIndex);
  
  // Now find the main return which is preceded by `};` (for renderTimelineView)
  const targetInsertionPoint = content.lastIndexOf("  return (");
  
  if (targetInsertionPoint !== -1) {
    content = content.substring(0, targetInsertionPoint) + "\n" + blockToMove + "\n" + content.substring(targetInsertionPoint);
  }
}

// Fix getUserTeam param type
content = content.replace("const getUserTeam = (userId) => {", "const getUserTeam = (userId: string) => {");

fs.writeFileSync(file, content);
console.log('Fixed CalendarView!');
