import { useMemo, useState } from 'react';

/** Fixed-row windowing for large, scrollable collections without another runtime package. */
export function useVirtualWindow(itemCount: number, rowHeight: number, viewportHeight = 560, overscan = 5) {
    const [scrollTop, setScrollTop] = useState(0);
    return useMemo(() => {
        const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
        const start = Math.min(Math.max(0, itemCount - visibleCount), Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
        const end = Math.min(itemCount, start + visibleCount);
        return {
            start,
            end,
            paddingTop: start * rowHeight,
            paddingBottom: Math.max(0, (itemCount - end) * rowHeight),
            viewportHeight,
            onScroll: (event: React.UIEvent<HTMLElement>) => setScrollTop(event.currentTarget.scrollTop),
        };
    }, [itemCount, rowHeight, viewportHeight, overscan, scrollTop]);
}
