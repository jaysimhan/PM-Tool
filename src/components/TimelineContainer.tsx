import React, { useRef, useState, MouseEvent } from 'react';
import { ZoomIn, ZoomOut, Search } from 'lucide-react';

interface Props {
    children: React.ReactNode;
}

export function TimelineContainer({ children }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);

    const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - containerRef.current.offsetLeft);
        setScrollLeft(containerRef.current.scrollLeft);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
        if (!isDragging || !containerRef.current) return;
        e.preventDefault();
        const x = e.pageX - containerRef.current.offsetLeft;
        const walk = (x - startX) * 2; // Scroll-fast
        containerRef.current.scrollLeft = scrollLeft - walk;
    };

    const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 2));
    const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
    const handleZoomReset = () => setZoomLevel(1);

    return (
        <div className="flex flex-col h-full w-full bg-white rounded-lg border border-gray-200">
            {/* Toolbar */}
            <div className="flex items-center justify-end p-2 border-b border-gray-200 bg-gray-50/50">
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                    <button 
                        onClick={handleZoomOut}
                        className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                        title="Zoom Out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={handleZoomReset}
                        className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                        title="Reset Zoom"
                    >
                        {Math.round(zoomLevel * 100)}%
                    </button>
                    <button 
                        onClick={handleZoomIn}
                        className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                        title="Zoom In"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Draggable Area */}
            <div 
                ref={containerRef}
                className={`flex-1 overflow-x-auto overflow-y-auto min-h-[500px] ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
                style={{ scrollBehavior: isDragging ? 'auto' : 'smooth' }}
            >
                <div 
                    className="min-w-max p-4 origin-top-left transition-transform duration-200 ease-out"
                    style={{ transform: `scale(${zoomLevel})` }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
