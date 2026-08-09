import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocusTrap(active: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!active || !ref.current) return;
        const dialog = ref.current;
        const previous = document.activeElement as HTMLElement | null;
        const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        requestAnimationFrame(() => (focusables()[0] || dialog).focus());

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusables();
            if (!items.length) { event.preventDefault(); return; }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            requestAnimationFrame(() => previous?.focus());
        };
    }, [active, onClose, ref]);
}
