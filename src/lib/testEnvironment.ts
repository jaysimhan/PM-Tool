import { useLocation } from 'react-router-dom';
import { User } from '../types/types';

// Everything that is only meant to be exercised before it ships lives behind one path
// prefix: /test/tasks is the test copy of /tasks, /test/workload of /workload, and so on
// for anything added later. Nothing links to it — you get there by typing the URL — and
// the routes themselves are only mounted for the super admin.
export const TEST_PREFIX = '/test';

/** The test-environment path for a live one: /tasks -> /test/tasks. */
export const toTestPath = (path: string) =>
    `${TEST_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

/** Only the super admin may enter the test environment. */
export const canUseTestEnvironment = (user?: Pick<User, 'role'> | null) =>
    user?.role === 'super_admin';

/** Whether the URL currently being rendered is a test-environment one. */
export function useIsTestPath(): boolean {
    const { pathname } = useLocation();
    return pathname === TEST_PREFIX || pathname.startsWith(`${TEST_PREFIX}/`);
}

/**
 * Whether the page rendering this is the test copy *and* the person looking at it is
 * allowed to be. Routing already enforces the role, so this is belt and braces — a
 * feature hidden behind it stays hidden even if a test route is ever mounted wider.
 */
export function useTestEnvironment(user?: Pick<User, 'role'> | null): boolean {
    return useIsTestPath() && canUseTestEnvironment(user);
}
