const fs = require('fs');
const file = '/Users/jaysimhan/Desktop/Downloads+/PM Web/src/components/CalendarView.tsx';
let content = fs.readFileSync(file, 'utf8');

const oldReturn = `    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-600 mt-1">View tasks and schedules in calendar format</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={\`px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 \${
              showFilters ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'
            }\`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>`;

const newReturn = `    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-600 mt-1">Manage and track your tasks</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Main View Mode Toggle */}
          <div className="flex items-center p-1 bg-gray-100 rounded-lg mr-2">
              <button
                  onClick={() => setPageMode('calendar')}
                  className={\`p-1.5 rounded-md transition-colors \${pageMode === 'calendar' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}\`}
                  title="Calendar View"
              >
                  <Calendar className="w-4 h-4" />
              </button>
              <button
                  onClick={() => setPageMode('list')}
                  className={\`p-1.5 rounded-md transition-colors \${pageMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}\`}
                  title="List View"
              >
                  <List className="w-4 h-4" />
              </button>
              <button
                  onClick={() => setPageMode('board')}
                  className={\`p-1.5 rounded-md transition-colors \${pageMode === 'board' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}\`}
                  title="Board View"
              >
                  <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                  onClick={() => setPageMode('timeline')}
                  className={\`p-1.5 rounded-md transition-colors \${pageMode === 'timeline' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}\`}
                  title="Timeline View"
              >
                  <GanttChart className="w-4 h-4" />
              </button>
          </div>

          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={\`px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 \${
              showFilters ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'
            }\`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>`;

content = content.replace(oldReturn, newReturn);

const oldNav = `      {/* Navigation and View Controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth('prev');
                else if (viewMode === 'week') navigateWeek('prev');
                else navigateDay('prev');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>

            <h2 className="text-lg font-semibold text-gray-900 min-w-[200px] text-center">
              {viewMode === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {viewMode === 'week' && \`Week of \${getWeekDays(currentDate)[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\`}
              {viewMode === 'day' && currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {viewMode === 'timeline' && \`\${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} Timeline\`}
            </h2>

            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth('next');
                else if (viewMode === 'week') navigateWeek('next');
                else navigateDay('next');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>

            <button
              onClick={() => setCurrentDate(new Date())}
              className="ml-4 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Today
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('month')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'day' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'timeline' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {/* Render Calendar View */}
      {viewMode === 'month' && renderMonthView()}
      {viewMode === 'week' && renderWeekView()}
      {viewMode === 'day' && renderDayView()}
      {viewMode === 'timeline' && renderTimelineView()}`;

const newNav = `      {/* Navigation and View Controls */}
      {pageMode === 'calendar' && (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth('prev');
                else if (viewMode === 'week') navigateWeek('prev');
                else navigateDay('prev');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>

            <h2 className="text-lg font-semibold text-gray-900 min-w-[200px] text-center">
              {viewMode === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {viewMode === 'week' && \`Week of \${getWeekDays(currentDate)[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\`}
              {viewMode === 'day' && currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>

            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth('next');
                else if (viewMode === 'week') navigateWeek('next');
                else navigateDay('next');
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>

            <button
              onClick={() => setCurrentDate(new Date())}
              className="ml-4 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Today
            </button>
          </div>

          {/* Sub View Mode Toggle (Calendar specific) */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('month')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                viewMode === 'day' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }\`}
            >
              Day
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Render Main Views */}
      {pageMode === 'list' && renderListView()}
      {pageMode === 'board' && renderBoardView()}
      {pageMode === 'timeline' && renderTimelineView()}
      
      {/* Render Calendar Views */}
      {pageMode === 'calendar' && viewMode === 'month' && renderMonthView()}
      {pageMode === 'calendar' && viewMode === 'week' && renderWeekView()}
      {pageMode === 'calendar' && viewMode === 'day' && renderDayView()}`;

content = content.replace(oldNav, newNav);

// Let's make sure GanttChart and Calendar are imported!
content = content.replace(
  /LayoutGrid, List, ArrowUpDown\n} from 'lucide-react';/,
  "LayoutGrid, List, ArrowUpDown, Calendar, GanttChart\n} from 'lucide-react';"
);

fs.writeFileSync(file, content);
console.log('CalendarView patched phase 3!');
