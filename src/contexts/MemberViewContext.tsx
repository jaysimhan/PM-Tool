import React, { createContext, useContext, useState } from 'react';
import { useAuth } from './AuthContext';
import { useTestEnvironment } from '../lib/testEnvironment';

/** Everyone the viewer can see, or one person's id. */
export type MemberScope = 'all' | string;

interface MemberViewContextValue {
    /** Whether the picker exists at all. Test environment only, for now. */
    enabled: boolean;
    scope: MemberScope;
    setScope: (scope: MemberScope) => void;
}

const MemberViewContext = createContext<MemberViewContextValue>({
    enabled: false,
    scope: 'all',
    setScope: () => {},
});

/**
 * Whose work the pages are showing, chosen once in the header and read by every page under
 * it. It sits above the layout rather than inside a page so the answer survives moving
 * between Workload, Tasks and the rest.
 */
export function MemberViewProvider({ children }: { children: React.ReactNode }) {
    const { profile } = useAuth();
    const enabled = useTestEnvironment(profile);
    const [selected, setSelected] = useState<MemberScope>('all');

    // The picker is only drawn in the test environment, so a person chosen there must stop
    // filtering the moment you step back out to the live pages -- otherwise the live app
    // would be quietly showing one person's work with nothing on screen to say so.
    const scope = enabled ? selected : 'all';

    return (
        <MemberViewContext.Provider value={{ enabled, scope, setScope: setSelected }}>
            {children}
        </MemberViewContext.Provider>
    );
}

export const useMemberView = () => useContext(MemberViewContext);

/** The single user id the pages should narrow to, or null for all members. */
export function useMemberFilter(): string | null {
    const { scope } = useMemberView();
    return scope === 'all' ? null : scope;
}
