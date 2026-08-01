import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './components/Login';
import { CreatePassword } from './components/CreatePassword';
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
    
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/workload" replace />} />
            <Route path="/dashboard" element={<OrganizationDashboard currentUser={user} />} />
            <Route path="/workload" element={<WorkloadDashboard currentUser={user} />} />
            <Route path="/tasks" element={<CalendarView currentUser={user} />} />
            <Route path="/personal" element={<PersonalDashboard currentUser={user} />} />
            <Route path="/approval" element={<TaskApproval currentUser={user} />} />
            <Route path="/manager-review" element={<ManagerReview currentUser={user} />} />
            <Route path="/new-request" element={<RequestForm currentUser={user} />} />
            <Route path="/integrations" element={<Integrations currentUser={user} />} />
            <Route path="/reports" element={<Reports currentUser={user} />} />
            <Route path="/team-management" element={<TeamManagement currentUser={user} />} />
            <Route path="/form-setup" element={<FormSetup />} />
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
                <Route path="/update-password" element={session ? <CreatePassword /> : <Navigate to="/login" />} />
                <Route path="/public/dashboard" element={<PublicDashboard />} />
                
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