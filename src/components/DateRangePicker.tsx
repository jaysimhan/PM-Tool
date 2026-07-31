import React, { useState, useEffect, useRef } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, getDay, isAfter, isBefore, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown, Clock, Repeat, X, Check, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
    const [showRepeat, setShowRepeat] = useState(false);
    const [activeInput, setActiveInput] = useState<'start' | 'end'>('end');
    const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
    
    // Internal date states to allow drafting before closing
    const [localStart, setLocalStart] = useState<Date | null>(startDate ? new Date(startDate) : null);
    const [localEnd, setLocalEnd] = useState<Date | null>(dueDate ? new Date(dueDate) : null);


    // Repeat states (mocked for UI)
    const [repeatFrequency, setRepeatFrequency] = useState('Daily');
    const [repeatDays, setRepeatDays] = useState<number[]>([3]); // Wednesday by default as in screenshot
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
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
            } else if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
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

    const toggleRepeatDay = (dayIndex: number) => {
        if (repeatDays.includes(dayIndex)) {
            setRepeatDays(repeatDays.filter(d => d !== dayIndex));
        } else {
            setRepeatDays([...repeatDays, dayIndex]);
        }
    };

    const isWeekend = (date: Date) => getDay(date) === 0 || getDay(date) === 6;

    const isRepeatPreview = (date: Date) => {
        if (!showRepeat || !localStart || !localEnd) return false;
        if (isBefore(date, localEnd) || isSameDay(date, localEnd)) return false; 
        
        if (repeatFrequency === 'Daily') return true;
        if (repeatFrequency === 'Weekly' && repeatDays.includes(getDay(date))) return true;
        if (repeatFrequency === 'Monthly' && date.getDate() === localStart.getDate()) return true;
        if (repeatFrequency === 'Yearly' && date.getMonth() === localStart.getMonth() && date.getDate() === localStart.getDate()) return true;
        
        return false;
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
                <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronLeft className="w-5 h-5" /></button>
                <div className="font-semibold text-gray-700">{format(currentMonth, 'MMMM yyyy')}</div>
                <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronRight className="w-5 h-5" /></button>
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
                    const repeatHighlight = isRepeatPreview(day);

                    let buttonBg = !inRange && !repeatHighlight && !today ? 'hover:bg-gray-100' : '';
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
                    } else if (repeatHighlight) {
                        buttonBg = 'bg-blue-50';
                        buttonText = 'text-blue-600';
                        buttonRounded = 'rounded-full';
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

            {/* Repeat Section */}
            {showRepeat && (
                <div className="border-t border-gray-100 pt-5 pb-2 px-1 text-[15px] font-semibold text-gray-900">
                    <div className="flex items-center justify-between mb-6">
                        <span>Repeats</span>
                        <div className="relative" ref={dropdownRef}>
                            <button 
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="flex items-center gap-1 text-[15px] font-medium text-gray-600 hover:text-gray-900"
                            >
                                {repeatFrequency} <ChevronDown className={`w-4 h-4 text-gray-500`} />
                            </button>
                            <AnimatePresence>
                            {isDropdownOpen && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-36 z-50 text-[15px] font-medium"
                                >
                                    {['Daily', 'Weekly', 'Monthly', 'Yearly', 'Periodically', 'Custom'].map(opt => (
                                        <button 
                                            key={opt}
                                            className="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center justify-between text-gray-700 hover:text-gray-900"
                                            onClick={() => {
                                                setRepeatFrequency(opt);
                                                setIsDropdownOpen(false);
                                            }}
                                        >
                                            <span>{opt}</span>
                                            {repeatFrequency === opt && <Check className="w-4 h-4 text-gray-500" />}
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                            </AnimatePresence>
                        </div>
                    </div>
                    
                    {repeatFrequency === 'Custom' && (
                        <div className="flex items-center justify-between mb-6">
                            <span>Every</span>
                            <div className="flex items-center gap-4 text-[15px] font-medium text-gray-600">
                                <button className="flex items-center gap-1 hover:text-gray-900">
                                    1 <ChevronDown className="w-4 h-4 text-gray-500" />
                                </button>
                                <button className="flex items-center gap-1 hover:text-gray-900">
                                    Week <ChevronDown className="w-4 h-4 text-gray-500" />
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {repeatFrequency === 'Periodically' && (
                        <div className="flex items-center justify-between mb-6">
                            <span>Days after completion</span>
                            <button className="flex items-center gap-1 text-[15px] font-medium text-gray-600 hover:text-gray-900">
                                7 <ChevronDown className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                    )}
                    
                    {(repeatFrequency === 'Weekly' || repeatFrequency === 'Custom') && (
                        <div className="mb-2">
                            <div className="mb-4">On these days</div>
                            <div className="flex justify-between items-center">
                                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                                    <div key={i} className="flex flex-col items-center gap-2">
                                        <button 
                                            onClick={() => toggleRepeatDay(i)}
                                            className={`w-5 h-5 rounded-[4px] border flex items-center justify-center transition-colors ${repeatDays.includes(i) ? 'bg-[#0084ff] border-[#0084ff]' : 'bg-white border-gray-400'}`}
                                        >
                                            {repeatDays.includes(i) && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                                        </button>
                                        <span className="text-[13px] text-gray-900">{day}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Bottom Toolbar */}
            <div className="border-t border-gray-100 pt-4 flex items-center justify-between px-1 mt-2">
                <div className="flex gap-3">
                    <div className="relative group">
                        <button 
                            onClick={() => setShowRepeat(!showRepeat)}
                            className={`w-[42px] h-[42px] rounded-[10px] transition-colors flex items-center justify-center ${showRepeat ? 'bg-[#ebf3ff] text-blue-600' : 'bg-[#f8f9fa] text-gray-500 hover:bg-gray-100'}`}
                        >
                            <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                                <path d="M25.999 4h-20c-3.309 0-6 2.691-6 6v10c0 3.309 2.691 6 6 6h10.586l-4.293 4.293a.999.999 0 1 0 1.414 1.414l6-5.999a1 1 0 0 0 0-1.416l-6-5.999a.999.999 0 1 0-1.414 1.414L16.585 24H6c-2.206 0-4-1.794-4-4V10c0-2.206 1.794-4 4-4h20c2.206 0 4 1.794 4 4v10c0 2.206-1.794 4-4 4h-1a1 1 0 1 0 0 2h1c3.309 0 6-2.691 6-6V10c0-3.309-2.691-6-6-6Z"></path>
                            </svg>
                        </button>
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:flex items-center justify-center bg-[#2a2a2a] text-white text-[13px] font-medium px-3 py-1.5 rounded-md shadow-sm whitespace-nowrap z-50">
                            Set to repeat
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
