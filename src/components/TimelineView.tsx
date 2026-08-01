import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { User, Task } from '../types/types';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { getDatesInRange } from '../utils/capacityCalculations';
import { TimelineContainer } from './TimelineContainer';
import { ChevronRight, ChevronDown, User as UserIcon, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { getPriorityColor } from '../utils/capacityCalculations';

interface Props {
    currentUser: User;
}

type ZoomLevel = 'days' | 'weeks' | 'months';

export default function TimelineView({ currentUser }: Props) {
    const { users, tasks, refreshTasks } = useData();
    const [zoom, setZoom] = useState<ZoomLevel>('days');
    const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 3); // Start 3 days ago for some context
        return d.toISOString().split('T')[0];
    });

    const dates = useMemo(() => {
        let count = zoom === 'days' ? 30 : zoom === 'weeks' ? 90 : 180;
        return getDatesInRange(startDate, count);
    }, [startDate, zoom]);

    // Split tasks into unscheduled and scheduled
    const { scheduled, unscheduled } = useMemo(() => {
        const s: Task[] = [];
        const u: Task[] = [];
        // Filter out completed/cancelled if desired, or keep them
        tasks.forEach(t => {
            if (t.status === 'completed' || t.status === 'cancelled') return;
            if (t.proposedStartDate && t.proposedEndDate) {
                s.push(t);
            } else {
                u.push(t);
            }
        });
        return { scheduled: s, unscheduled: u };
    }, [tasks]);

    const containerRef = useRef<HTMLDivElement>(null);
    const [taskPositions, setTaskPositions] = useState<Record<string, { x: number, y: number, width: number, height: number }>>({});

    // Measure task bars after render to draw dependencies
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const positions: Record<string, { x: number, y: number, width: number, height: number }> = {};
        const containerRect = containerRef.current.getBoundingClientRect();
        
        scheduled.forEach(task => {
            const el = document.getElementById(`task-bar-${task.id}`);
            if (el) {
                const rect = el.getBoundingClientRect();
                positions[task.id] = {
                    x: rect.left - containerRect.left + containerRef.current!.scrollLeft,
                    y: rect.top - containerRect.top + containerRef.current!.scrollTop,
                    width: rect.width,
                    height: rect.height,
                };
            }
        });
        setTaskPositions(positions);
    }, [scheduled, zoom, startDate, expandedTasks]);

    // Grouping scheduled tasks by parent/subtask relationships
    // For MVP, we'll just show them in a flat list or grouped by Assignee
    const tasksByAssignee = useMemo(() => {
        const grouped: Record<string, Task[]> = { 'unassigned': [] };
        users.forEach(u => grouped[u.id] = []);
        
        scheduled.forEach(t => {
            if (t.isSubtask) return; // Handle subtasks separately if needed
            if (t.assignedToId && grouped[t.assignedToId]) {
                grouped[t.assignedToId].push(t);
            } else {
                grouped['unassigned'].push(t);
            }
        });
        return grouped;
    }, [scheduled, users]);

    // HTML5 Drag and Drop handlers
    const handleDragStart = (e: React.DragEvent, taskId: string, dragType: 'unscheduled' | 'scheduled') => {
        e.dataTransfer.setData('taskId', taskId);
        e.dataTransfer.setData('dragType', dragType);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent, dateStr: string, assigneeId?: string) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('taskId');
        const dragType = e.dataTransfer.getData('dragType');
        
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        // Calculate new dates
        // If dragging from unscheduled, give it a default 1 day duration
        let newStartDate = dateStr;
        let newEndDate = dateStr;
        
        if (dragType === 'scheduled' && task.proposedStartDate && task.proposedEndDate) {
            // Keep duration same
            const oldStart = new Date(task.proposedStartDate);
            const oldEnd = new Date(task.proposedEndDate);
            const durationMs = oldEnd.getTime() - oldStart.getTime();
            
            const nStart = new Date(dateStr);
            const nEnd = new Date(nStart.getTime() + durationMs);
            newEndDate = nEnd.toISOString().split('T')[0];
        }

        const updates: any = {
            proposed_start_date: newStartDate,
            proposed_end_date: newEndDate,
        };
        
        if (assigneeId && assigneeId !== 'unassigned') {
            updates.assignee_id = assigneeId;
        }

        await supabase.from('tasks').update(updates).eq('id', taskId);
        if (refreshTasks) refreshTasks();
    };

    return (
        <div className="flex h-[calc(100vh-73px)] w-full overflow-hidden bg-white">
            {/* Unscheduled Tasks Sidebar */}
            <div className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col h-full flex-shrink-0">
                <div className="p-4 border-b border-gray-200 font-semibold text-gray-700">
                    Unscheduled Tasks ({unscheduled.length})
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {unscheduled.map(task => (
                        <div 
                            key={task.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, task.id, 'unscheduled')}
                            className="bg-white p-3 rounded border border-gray-200 shadow-sm cursor-grab hover:shadow-md transition-shadow"
                        >
                            <div className="font-medium text-sm text-gray-900 truncate">{task.title}</div>
                            <div className="text-xs text-gray-500 mt-1 flex justify-between">
                                <span>{task.status.replace(/_/g, ' ')}</span>
                                <span style={{ color: getPriorityColor(task.priority) }} className="capitalize">{task.priority || 'Normal'}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Timeline Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                {/* Toolbar */}
                <div className="h-12 flex-shrink-0 border-b border-gray-200 flex items-center px-4 justify-between bg-white z-10">
                    <div className="font-semibold text-gray-800">Timeline</div>
                    <div className="flex gap-2">
                        <select 
                            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                            value={zoom}
                            onChange={(e) => setZoom(e.target.value as ZoomLevel)}
                        >
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                        </select>
                    </div>
                </div>

                {/* Timeline Grid */}
                <div className="flex-1 overflow-hidden relative" ref={containerRef}>
                    <TimelineContainer>
                        {/* SVG Overlay for dependencies */}
                        <svg className="absolute inset-0 pointer-events-none z-20" style={{ width: '100%', height: '100%', minWidth: '100%', minHeight: '100%' }}>
                            {scheduled.map(task => {
                                const deps = task.dependencyIds || [];
                                if (deps.length === 0) return null;
                                const toPos = taskPositions[task.id];
                                if (!toPos) return null;

                                return deps.map(blockerId => {
                                    const fromPos = taskPositions[blockerId];
                                    if (!fromPos) return null;

                                    const startX = fromPos.x + fromPos.width;
                                    const startY = fromPos.y + fromPos.height / 2;
                                    const endX = toPos.x;
                                    const endY = toPos.y + toPos.height / 2;

                                    const isConflict = startX > endX;
                                    const color = isConflict ? '#ef4444' : '#9ca3af';

                                    const path = `M ${startX} ${startY} C ${startX + 20} ${startY}, ${endX - 20} ${endY}, ${endX} ${endY}`;

                                    return (
                                        <g key={`${blockerId}-${task.id}`}>
                                            <path d={path} fill="none" stroke={color} strokeWidth="2" />
                                            <polygon points={`${endX-5},${endY-4} ${endX+1},${endY} ${endX-5},${endY+4}`} fill={color} />
                                        </g>
                                    );
                                });
                            })}
                        </svg>

                        <table className="w-full border-collapse relative z-10" style={{ tableLayout: 'fixed' }}>
                            <thead className="bg-gray-50 sticky top-0 z-30 shadow-sm">
                                <tr>
                                    <th className="w-64 min-w-[256px] sticky left-0 z-40 bg-gray-50 border-r border-b border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">
                                        Assignee / Task
                                    </th>
                                    {dates.map((date, idx) => {
                                        const d = new Date(date);
                                        return (
                                            <th key={idx} className="w-12 min-w-[48px] border-r border-b border-gray-200 px-1 py-1 text-center text-[10px] font-medium text-gray-600">
                                                <div>{d.toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
                                                <div>{d.getDate()}</div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="bg-white relative">
                                {Object.entries(tasksByAssignee).map(([assigneeId, userTasks]) => {
                                    if (userTasks.length === 0 && assigneeId !== 'unassigned') return null;
                                    // if it's unassigned and no tasks, skip
                                    if (userTasks.length === 0 && assigneeId === 'unassigned') return null;

                                    const user = users.find(u => u.id === assigneeId);
                                    const name = user ? user.name : 'Unassigned';

                                    return (
                                        <React.Fragment key={assigneeId}>
                                            <tr className="bg-gray-100">
                                                <td className="w-64 min-w-[256px] sticky left-0 z-20 bg-gray-100 border-r border-b border-gray-200 px-4 py-2 font-semibold text-sm text-gray-800">
                                                    {name}
                                                </td>
                                                {dates.map((date, idx) => (
                                                    <td 
                                                        key={idx} 
                                                        className="border-r border-b border-gray-200 bg-gray-100"
                                                        onDragOver={handleDragOver}
                                                        onDrop={(e) => handleDrop(e, date, assigneeId)}
                                                    ></td>
                                                ))}
                                            </tr>
                                            {userTasks.map(task => {
                                                return (
                                                    <tr key={task.id} className="hover:bg-gray-50/50 group h-10">
                                                        <td className="w-64 min-w-[256px] sticky left-0 z-20 bg-white group-hover:bg-gray-50/50 border-r border-b border-gray-200 px-4 py-1 text-sm truncate relative">
                                                            {task.title}
                                                        </td>
                                                        <td colSpan={dates.length} className="border-r border-b border-gray-200 p-0 relative">
                                                            {/* Grid drop zones */}
                                                            <div className="absolute inset-0 flex">
                                                                {dates.map((d, i) => (
                                                                    <div 
                                                                        key={i} 
                                                                        className="flex-1 border-r border-gray-100/50"
                                                                        onDragOver={handleDragOver}
                                                                        onDrop={(e) => handleDrop(e, d, assigneeId)}
                                                                    />
                                                                ))}
                                                            </div>
                                                            {/* Task Bar */}
                                                            {(() => {
                                                                if (!task.proposedStartDate || !task.proposedEndDate) return null;
                                                                const startDate = new Date(task.proposedStartDate);
                                                                const endDate = new Date(task.proposedEndDate);
                                                                const rangeStart = new Date(dates[0]);
                                                                const rangeEnd = new Date(dates[dates.length - 1]);
                                                                rangeEnd.setHours(23, 59, 59, 999);

                                                                if (endDate < rangeStart || startDate > rangeEnd) return null;

                                                                const taskStart = Math.max(startDate.getTime(), rangeStart.getTime());
                                                                const taskEnd = Math.min(endDate.getTime(), rangeEnd.getTime());
                                                                const totalRange = rangeEnd.getTime() - rangeStart.getTime();
                                                                
                                                                const left = ((taskStart - rangeStart.getTime()) / totalRange) * 100;
                                                                let width = ((taskEnd - taskStart) / totalRange) * 100;
                                                                width = Math.max(width, (1 / dates.length) * 100);

                                                                const color = getPriorityColor(task.priority);

                                                                return (
                                                                    <div 
                                                                        id={`task-bar-${task.id}`}
                                                                        className="absolute top-1 bottom-1 rounded px-2 text-xs flex items-center font-medium shadow-sm cursor-grab active:cursor-grabbing z-10"
                                                                        style={{ 
                                                                            left: `${left}%`, 
                                                                            width: `${width}%`, 
                                                                            backgroundColor: `${color}30`, 
                                                                            borderLeft: `3px solid ${color}`,
                                                                            color: '#1F2937'
                                                                        }}
                                                                        draggable
                                                                        onDragStart={(e) => handleDragStart(e, task.id, 'scheduled')}
                                                                    >
                                                                        <span className="truncate">{task.title}</span>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TimelineContainer>
                </div>
            </div>
        </div>
    );
}
