import React, { useState, useEffect, useRef } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, getDay, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

interface SingleDatePickerProps {
    date: string;
    onChange: (date: string) => void;
    onClose: () => void;
    align?: 'left' | 'right';
}

export function SingleDatePicker({ date, onChange, onClose, align = 'left' }: SingleDatePickerProps) {
    const [currentMonth, setCurrentMonth] = useState(() => {
        return date ? new Date(date) : new Date();
    });
    
    // Internal date state to allow drafting before closing
    const [localDate, setLocalDate] = useState<Date | null>(date ? new Date(date) : null);

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
        setLocalDate(day);
        onChange(format(day, 'yyyy-MM-dd'));
        onClose();
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

    const handleClear = () => {
        setLocalDate(null);
        onChange('');
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
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4 px-1">
                <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronLeft className="w-5 h-5" /></button>
                <div className="font-semibold text-gray-700">{format(currentMonth, 'MMMM yyyy')}</div>
                <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-full text-gray-600"><ChevronRight className="w-5 h-5" /></button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-y-1 mb-2 px-1">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                    <div key={i} className="text-center text-xs font-semibold text-gray-700 py-1">{day}</div>
                ))}
                
                {dateRange.map((day, i) => {
                    const isSelected = localDate ? isSameDay(day, localDate) : false;
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const today = isToday(day);

                    let buttonBg = !isSelected && !today ? 'hover:bg-gray-100' : '';
                    let buttonText = isCurrentMonth ? 'text-gray-700' : 'text-gray-400';
                    let buttonRounded = 'rounded-xl';

                    if (isSelected) {
                        buttonBg = 'bg-[#0084ff]';
                        buttonText = 'text-white';
                    } else if (today) {
                        buttonBg = 'bg-[#eb5757] hover:bg-red-600';
                        buttonText = 'text-white';
                        buttonRounded = 'rounded-full';
                    }

                    return (
                        <div key={i} className="relative flex items-center justify-center h-9">
                            <button
                                type="button"
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
            <div className="border-t border-gray-100 pt-4 flex items-center justify-end px-1 mt-2">
                <button type="button" onClick={handleClear} className="text-[15px] font-semibold text-gray-600 hover:text-gray-900 px-2">
                    Clear
                </button>
            </div>
        </motion.div>
    );
}
