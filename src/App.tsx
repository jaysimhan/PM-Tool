import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './components/Login';
import { SecuritySettings } from './components/SecuritySettings';
import { Onboarding } from './components/Onboarding';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './layouts/DashboardLayout';
import { useAuth } from './contexts/AuthContext';
import { User } from './types/types';

// Lazy-load page components for code-splitting
const OrganizationDashboard = lazy(() => import('./components/OrganizationDashboard'));
const WorkloadDashboard = lazy(() => import('./components/WorkloadDashboard'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const PersonalDashboard = lazy(() => import('./components/PersonalDashboard'));
const TaskApproval = lazy(() => import('./components/TaskApproval'));
const ManagerReview = lazy(() => import('./components/ManagerReview'));
const TeamDashboard = lazy(() => import('./components/TeamDashboard'));
const RequestForm = lazy(() => import('./components/RequestForm'));
const Reports = lazy(() => import('./components/Reports'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const Integrations = lazy(() => import('./components/Integrations'));
const FormSetup = lazy(() => import('./components/FormSetup').then(m => ({ default: m.FormSetup })));
const PublicDashboard = lazy(() => import('./components/PublicDashboard'));
const PublicRequestForm = lazy(() => import('./components/PublicRequestForm'));

const PageLoader = () => (
    <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
);

// Wrapper to inject currentUser into DashboardLayout and its children
const AuthenticatedLayout = () => {
    const { profile: currentUser } = useAuth();
    if (!currentUser) return null; // Should be handled by ProtectedRoute
    
    return <DashboardLayout currentUser={currentUser as User} />;
};

const AuthenticatedRoutes = () => {
    const { profile: currentUser } = useAuth();
    if (!currentUser) return null; // Should be handled by ProtectedRoute
    
    const user = currentUser as User;
    
    const wrap = (Component: React.ReactNode) => (
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
            {Component}
        </div>
    );
    
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/workload" replace />} />
            <Route path="/dashboard" element={wrap(<OrganizationDashboard currentUser={user} />)} />
            <Route path="/workload" element={<WorkloadDashboard currentUser={user} />} />
            <Route path="/tasks" element={<CalendarView currentUser={user} />} />
            <Route path="/personal" element={wrap(<PersonalDashboard currentUser={user} />)} />
            <Route path="/approval" element={wrap(<TaskApproval currentUser={user} />)} />
            <Route path="/manager-review" element={wrap(<ManagerReview currentUser={user} />)} />
            <Route path="/new-request" element={wrap(<RequestForm currentUser={user} />)} />
            <Route path="/integrations" element={wrap(<Integrations currentUser={user} />)} />
            <Route path="/reports" element={wrap(<Reports currentUser={user} />)} />
            <Route path="/team-management" element={wrap(<TeamManagement currentUser={user} />)} />
            <Route path="/form-setup" element={wrap(<FormSetup />)} />
            <Route path="*" element={<Navigate to="/workload" replace />} />
        </Routes>
    );
};


export default function App() {
    const { session, mfaRequired } = useAuth();

    return (
        <Suspense fallback={<PageLoader />}>
            <Routes>
                {/* Public / Unauthenticated Routes */}
                <Route path="/login" element={(!session || mfaRequired) ? <Login /> : <Navigate to="/" />} />
                <Route path="/security-settings" element={session ? <SecuritySettings /> : <Navigate to="/login" />} />
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
                <Route path="/public/dashboard" element={<PublicDashboard />} />
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