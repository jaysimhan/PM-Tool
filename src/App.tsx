import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './contexts/AuthContext';
import { MemberViewProvider } from './contexts/MemberViewContext';
import { canUseTestEnvironment, useIsTestPath, TEST_PREFIX } from './lib/testEnvironment';
import { User } from './types/types';
import { AppSkeleton } from './components/Skeleton';

// Lazy-load page components for code-splitting
const OrganizationDashboard = lazy(() => import('./components/OrganizationDashboard'));
const WorkloadDashboard = lazy(() => import('./components/WorkloadDashboard'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const PersonalDashboard = lazy(() => import('./components/PersonalDashboard'));
const TaskApproval = lazy(() => import('./components/TaskApproval'));
const ManagerReview = lazy(() => import('./components/ManagerReview'));
const ActionItemsPage = lazy(() => import('./components/ActionItemsPage'));
const RequestForm = lazy(() => import('./components/RequestForm'));
const Reports = lazy(() => import('./components/Reports'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const FormSetup = lazy(() => import('./components/FormSetup').then(m => ({ default: m.FormSetup })));
const PublicDashboard = lazy(() => import('./components/PublicDashboard'));
const PublicRequestForm = lazy(() => import('./components/PublicRequestForm'));
const Login = lazy(() => import('./components/Login').then(m => ({ default: m.Login })));
const SecuritySettings = lazy(() => import('./components/SecuritySettings').then(m => ({ default: m.SecuritySettings })));
const Onboarding = lazy(() => import('./components/Onboarding').then(m => ({ default: m.Onboarding })));
const DashboardLayout = lazy(() => import('./layouts/DashboardLayout').then(m => ({ default: m.DashboardLayout })));
const TestDataProvider = lazy(() => import('./contexts/TestDataProvider').then(m => ({ default: m.TestDataProvider })));

const PageLoader = AppSkeleton;

// Wrapper to inject currentUser into DashboardLayout and its children
const AuthenticatedLayout = () => {
    const { profile: currentUser } = useAuth();
    const inTestEnvironment = useIsTestPath();
    if (!currentUser) return null; // Should be handled by ProtectedRoute
    
    // The member view is chosen in the header and read by the pages under it, so it is
    // provided above both.
    return (
        <MemberViewProvider>
            {/* Under /test this swaps the whole app onto invented data; everywhere else it
                is a passthrough. The key remounts everything below on the way in and on the
                way out, so no page carries live rows -- or a sandbox edit -- across. */}
            {inTestEnvironment ? (
                <TestDataProvider key="test">
                    <DashboardLayout currentUser={currentUser as User} />
                </TestDataProvider>
            ) : (
                <DashboardLayout currentUser={currentUser as User} />
            )}
        </MemberViewProvider>
    );
};

const AuthenticatedRoutes = () => {
    const { profile: currentUser } = useAuth();
    if (!currentUser) return null; // Should be handled by ProtectedRoute

    const user = currentUser as User;

    // Where "/" and anything unrecognised lands, for everyone. Not having a team is no longer a
    // restricted state -- see ProtectedRoute -- so there is nothing to route around.
    const home = '/dashboard';

    const wrap = (Component: React.ReactNode) => (
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
            {Component}
        </div>
    );

    // A page that throws should cost you that page, not the header, the sidebar and your
    // place in the app. Keyed on the path so walking away from a broken page clears the
    // error rather than leaving the boundary stuck on it for the rest of the session.
    const guard = (element: React.ReactNode, path: string) => (
        <ErrorBoundary
            key={path}
            label={`the ${path} page`}
            fallback={
                <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full text-center">
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">This page could not be displayed</h2>
                    <p className="text-sm text-gray-500 mb-5">
                        Everything else still works — use the sidebar to go somewhere else, or reload to try again.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                        Reload
                    </button>
                </div>
            }
        >
            {element}
        </ErrorBoundary>
    );

    // One table, mounted twice: once at the real paths and once under /test for the super
    // admin. A page reached through /test knows it (useTestEnvironment) and may show work
    // that is not ready for everyone else — the timeline view is the first of those.
    const pages: { path: string; element: React.ReactNode }[] = [
        { path: 'dashboard', element: wrap(<OrganizationDashboard currentUser={user} />) },
        { path: 'workload', element: <WorkloadDashboard currentUser={user} /> },
        { path: 'tasks', element: <CalendarView currentUser={user} /> },
        { path: 'personal', element: wrap(<PersonalDashboard currentUser={user} />) },
        { path: 'action-items', element: wrap(<ActionItemsPage currentUser={user} />) },
        { path: 'new-request', element: wrap(<RequestForm currentUser={user} />) },
        { path: 'reports', element: wrap(<Reports currentUser={user} />) },
        { path: 'team-management', element: wrap(<TeamManagement currentUser={user} />) },
        // Form Setup writes the org's brands, regions and tags, which the database now accepts
        // only from an admin. Gating the route as well means nobody else lands on a screen
        // where every save is refused; the refusal is the real rule, this is the courtesy.
        ...(user.role === 'super_admin' || user.role === 'admin'
            ? [{ path: 'form-setup', element: wrap(<FormSetup />) }]
            : []),
    ];

    const testAllowed = canUseTestEnvironment(user);

    return (
        <Routes>
            <Route path="/" element={<Navigate to={home} replace />} />
            {pages.map(page => (
                <Route key={page.path} path={`/${page.path}`} element={guard(page.element, page.path)} />
            ))}

            {/* Anyone else asking for /test falls through to the catch-all below and lands
                back on their own workload page, same as any other unknown path. */}
            {testAllowed && (
                <>
                    <Route path={TEST_PREFIX} element={<Navigate to={`${TEST_PREFIX}/workload`} replace />} />
                    {pages.map(page => (
                        <Route key={`test-${page.path}`} path={`${TEST_PREFIX}/${page.path}`} element={guard(page.element, `test-${page.path}`)} />
                    ))}
                    <Route path={`${TEST_PREFIX}/*`} element={<Navigate to={`${TEST_PREFIX}/workload`} replace />} />
                </>
            )}

            <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
    );
};


export default function App() {
    const { session, mfaRequired, recoveryMode } = useAuth();

    return (
        <Suspense fallback={<PageLoader />}>
            <Routes>
                {/* Public / Unauthenticated Routes */}
                <Route path="/login" element={(!session || mfaRequired) ? <Login /> : <Navigate to="/" />} />
                {/* Held to the same bar as the protected routes. This is where 2FA itself is
                    turned on and off, so a session that still owes a code is exactly the one
                    that must not be standing here -- except when it arrived on a reset link,
                    which is a session that has nowhere else to go. The screen asks it for the
                    code itself before it will change anything. */}
                <Route
                    path="/security-settings"
                    element={(session && (!mfaRequired || recoveryMode)) ? <SecuritySettings /> : <Navigate to="/login" />}
                />
                {/* The old path. Password-recovery emails and bookmarks still point at it,
                    and a rename that breaks the reset flow is not a rename worth having. */}
                <Route
                    path="/update-password"
                    element={
                        <Navigate
                            replace
                            to={{
                                pathname: '/security-settings',
                                // A recovery link arrives as /update-password#access_token=...
                                // supabase-js normally consumes that hash before this renders,
                                // but carrying it across costs nothing and losing it would end
                                // the reset in silence.
                                search: window.location.search,
                                hash: window.location.hash,
                            }}
                        />
                    }
                />
                {/* Invite landing: authenticated but not yet a member of the org. Onboarding
                    guards on the session itself so a slow session restore doesn't bounce it. */}
                <Route path="/welcome" element={<Onboarding />} />
                {/* Public on purpose: the token in the path is the only credential, and it
                    is checked server-side by get_public_dashboard. The untokenised path is
                    kept because the old Share Dashboard button copied it, and it says so
                    rather than rendering an empty org. */}
                <Route path="/public/dashboard" element={<PublicDashboard />} />
                <Route path="/public/dashboard/:token" element={<PublicDashboard />} />
                {/* The shareable link from Share Request Form. Public on purpose: the token
                    in the path is the only credential, and it is checked server-side. */}
                <Route path="/request/:token" element={<PublicRequestForm />} />
                
                {/* Protected Routes */}
                <Route element={<ProtectedRoute />}>
                    <Route element={<AuthenticatedLayout />}>
                        <Route path="*" element={<AuthenticatedRoutes />} />
                    </Route>
                </Route>
            </Routes>
        </Suspense>
    );
}
