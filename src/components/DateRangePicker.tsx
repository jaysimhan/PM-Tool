import React, { useState, useEffect, useRef } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, getDay, isAfter, isBefore, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, X, Plus } from 'lucide-react';
import { motion } from 'framer-motion';

interface DateRangePickerProps {
    startDate: string;
    dueDate: string;
    onChange: (startDate: string, dueDate: string) => void;
    onClose: () => void;
    align?: 'left' | 'right';
}

export function DateRangePicker({ startDate, dueDate, onChange, onClose, align = 'left' }: DateRangePickerProps) {
    const [currentMonth, setCurrentMonth] = useState(() => {
        return startDate ? new Date(startDate) : (dueDate ? new Date(dueDate) : new Date());
    });
    
    // UI state
    const [activeInput, setActiveInput] = useState<'start' | 'end'>('end');

    // Internal date states to allow drafting before closing
    const [localStart, setLocalStart] = useState<Date | null>(startDate ? new Date(startDate) : null);
    const [localEnd, setLocalEnd] = useState<Date | null>(dueDate ? new Date(dueDate) : null);

    const pickerRef = useRef<HTMLDivElement>(null);

    // Month navigation
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

    // Calendar grid logic
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    
    // Get the start of the week for the first day of the month
    const startDateForGrid = addDays(monthStart, -getDay(monthStart));
    const endDateForGrid = addDays(monthEnd, 6 - getDay(monthEnd));

    const dateRange = eachDayOfInterval({ start: startDateForGrid, end: endDateForGrid });

    const handleDateClick = (day: Date) => {
        if (activeInput === 'start') {
            setLocalStart(day);
            if (localEnd && isBefore(localEnd, day)) {
                setLocalEnd(null);
            }
            setActiveInput('end');
        } else {
            // activeInput === 'end'
            if (localStart && isBefore(day, localStart)) {
                // If they pick an end date before the start date, shift the start date instead
                setLocalStart(day);
                setLocalEnd(null);
                setActiveInput('end');
            } else {
                setLocalEnd(day);
            }
        }
    };

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Sync to parent when dates change (including when one is cleared)
    useEffect(() => {
        onChange(
            localStart ? format(localStart, 'yyyy-MM-dd') : '', 
            localEnd ? format(localEnd, 'yyyy-MM-dd') : ''
        );
    }, [localStart, localEnd]);

    const handleClear = () => {
        setLocalStart(null);
        setLocalEnd(null);
        onChange('', '');
        onClose();
    };


    return (
        <motion.div 
            ref={pickerRef}
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 z-[70] w-[280px] p-4 font-sans text-gray-800 flex flex-col`} 
            onClick={(e) => e.stopPropagation()}
        >
            {/* Top Inputs */}
            <div className="flex gap-3 mb-4">
                {(!localStart && activeInput !== 'start') ? (
                    <div 
                        onClick={() => setActiveInput('start')}
                        className="flex-1 flex items-center justify-center gap-1 h-11 cursor-pointer text-gray-500 hover:bg-gray-50 rounded-lg"
                    >
                        <Plus className="w-4 h-4" />
                        <span className="text-sm font-medium">Start date</span>
                    </div>
                ) : (
                    <div 
                        onClick={() => setActiveInput('start')}
                        className={`flex-1 flex items-center justify-between border ${activeInput === 'start' ? 'border-blue-600 ring-1 ring-blue-600' : 'border-gray-300'} rounded-lg px-3 py-2 h-11 cursor-pointer bg-white`}
                    >
                        <span className={`text-sm font-medium ${!localStart ? 'text-gray-400' : 'text-gray-800'}`}>{localStart ? format(localStart, 'dd/MM/yy') : 'Start date'}</span>
                        {localStart && <button onClick={(e) => { e.stopPropagation(); setLocalStart(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>}
                    </div>
                )}
                
                <div 
                    onClick={() => setActiveInput('end')}
                    className={`flex-1 flex items-center justify-between border ${activeInput === 'end' ? 'border-blue-600 ring-1 ring-blue-600' : 'border-gray-300'} rounded-lg px-3 py-2 h-11 cursor-pointer bg-white`}
                >
                    <span className={`text-sm font-medium ${!localEnd ? 'text-gray-400' : 'text-gray-800'}`}>{localEnd ? format(localEnd, 'dd/MM/yy') : 'Due date'}</span>
                    {localEnd && <button onClick={(e) => { e.stopPropagation(); setLocalEnd(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>}
                </div>
            </div>



            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4 px-1">
                <button type="button" aria-label="Previous month" onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronLeft className="w-5 h-5" /></button>
                <div className="font-semibold text-gray-700">{format(currentMonth, 'MMMM yyyy')}</div>
                <button type="button" aria-label="Next month" onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronRight className="w-5 h-5" /></button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-y-1 mb-6 px-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                    <div key={i} className="text-center text-xs font-semibold text-gray-700 py-1">{day}</div>
                ))}
                
                {dateRange.map((day, i) => {
                    const isStart = localStart ? isSameDay(day, localStart) : false;
                    const isEnd = localEnd ? isSameDay(day, localEnd) : false;
                    const inRange = isStart || isEnd || (localStart && localEnd && isAfter(day, localStart) && isBefore(day, localEnd));
                    const isConnecting = inRange && localStart && localEnd;
                    
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const today = isToday(day);
                    let buttonBg = !inRange && !today ? 'hover:bg-gray-100' : '';
                    let buttonText = isCurrentMonth ? 'text-gray-700' : 'text-gray-400';
                    let buttonRounded = 'rounded-xl';

                    if (today) {
                        buttonBg = 'bg-[#eb5757] hover:bg-red-600';
                        buttonText = 'text-white';
                        buttonRounded = 'rounded-full';
                    } else if (isStart || isEnd) {
                        buttonBg = 'bg-[#0084ff]';
                        buttonText = 'text-white';
                    } else if (inRange) {
                        buttonBg = 'hover:bg-[#e0f0ff]';
                        buttonText = 'text-gray-900';
                    }

                    // For connecting background
                    let connectClass = '';
                    if (isConnecting && !isSameDay(localStart!, localEnd!)) {
                        if (isStart) connectClass = 'right-0 left-1/2';
                        else if (isEnd) connectClass = 'left-0 right-1/2';
                        else connectClass = 'inset-x-0';
                        
                        if (!isStart && getDay(day) === 0) connectClass += ' rounded-l-xl';
                        if (!isEnd && getDay(day) === 6) connectClass += ' rounded-r-xl';
                    }

                    return (
                        <div key={i} className="relative flex items-center justify-center h-9">
                            {isConnecting && !isSameDay(localStart!, localEnd!) && (
                                <div className={`absolute inset-y-0 bg-[#e0f0ff] ${connectClass}`} />
                            )}
                            <button
                                onClick={() => handleDateClick(day)}
                                className={`relative z-10 w-9 h-9 flex items-center justify-center text-sm font-medium transition-colors ${buttonRounded} ${buttonBg} ${buttonText}`}
                            >
                                {format(day, 'd')}
                            </button>
                        </div>
                    );
                })}
            </div>


            {/* Bottom Toolbar */}
            <div className="border-t border-gray-100 pt-4 flex items-center justify-between px-1 mt-2">
                <div className="flex gap-3">
                    {/* Recurrence has no home in the schema: the tasks table has no frequency,
                        interval or day-of-week column, and this picker's onChange only ever
                        emits a start and a due date. The panel that used to open here let you
                        choose "Weekly, on Mon and Wed", showed it back to you, and then threw
                        it away on close -- so it is gone rather than merely unreachable. The
                        button stays, disabled and saying why, because the feature is wanted. */}
                    <div className="relative group">
                        <button
                            type="button"
                            disabled
                            title="Recurring tasks are not available yet"
                            aria-label="Recurring tasks are not available yet"
                            className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center bg-[#f8f9fa] text-gray-300 cursor-not-allowed"
                        >
                            <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                                <path d="M25.999 4h-20c-3.309 0-6 2.691-6 6v10c0 3.309 2.691 6 6 6h10.586l-4.293 4.293a.999.999 0 1 0 1.414 1.414l6-5.999a1 1 0 0 0 0-1.416l-6-5.999a.999.999 0 1 0-1.414 1.414L16.585 24H6c-2.206 0-4-1.794-4-4V10c0-2.206 1.794-4 4-4h20c2.206 0 4 1.794 4 4v10c0 2.206-1.794 4-4 4h-1a1 1 0 1 0 0 2h1c3.309 0 6-2.691 6-6V10c0-3.309-2.691-6-6-6Z"></path>
                            </svg>
                        </button>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:flex items-center justify-center bg-[#2a2a2a] text-white text-[13px] font-medium px-3 py-1.5 rounded-md shadow-sm whitespace-nowrap z-50 pointer-events-none">
                            Repeating tasks aren't available yet
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-[#2a2a2a]"></div>
                        </div>
                    </div>
                </div>
                <button onClick={handleClear} className="text-[15px] font-semibold text-gray-600 hover:text-gray-900 px-2">
                    Clear
                </button>
            </div>
        </motion.div>
    );
};
