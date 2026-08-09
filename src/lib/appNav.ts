import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsTestPath, toTestPath } from './testEnvironment';

/**
 * In-app navigation that stays on the side of the fence it started on.
 *
 * Every page is mounted twice -- once live, once under /test for the super admin -- so a
 * hand-written navigate('/tasks?task=…') is only correct on one of them. From inside the
 * sandbox it silently walks the person out onto live production data while the page still
 * looks like the one they were just clicking around in freely. That is the wrong direction
 * for a mistake to go: the sandbox exists precisely so that clicking about is safe.
 *
 * GlobalSearch already got this right by hand; these hooks are that same rule in one place,
 * for the eight other callers that did not.
 *
 * Only for internal routes. External URLs and the unauthenticated pages (/login, /welcome,
 * /public/…) have no test copy and must not be prefixed.
 */

/** Rewrites an in-app path for wherever we currently are: /tasks -> /test/tasks under /test. */
export function useAppPath(): (path: string) => string {
    const inTestEnvironment = useIsTestPath();
    return useCallback(
        (path: string) => (inTestEnvironment ? toTestPath(path) : path),
        [inTestEnvironment]
    );
}

/** navigate(), but to the current environment's copy of the route. */
export function useAppNavigate(): (path: string, options?: { replace?: boolean }) => void {
    const navigate = useNavigate();
    const appPath = useAppPath();
    return useCallback(
        (path: string, options?: { replace?: boolean }) => navigate(appPath(path), options),
        [navigate, appPath]
    );
}

/**
 * Opens a task's detail panel from anywhere. The calendar owns the panel and opens it for
 * whatever `?task=<id>` names on arrival (CalendarView's deepLinkTaskId), so "open this task"
 * is a link to the task list rather than a route of its own.
 */
export function useOpenTask(): (taskId: string) => void {
    const go = useAppNavigate();
    return useCallback((taskId: string) => go(`/tasks?task=${encodeURIComponent(taskId)}`), [go]);
}
