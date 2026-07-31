import React, { useState, Suspense, lazy, useEffect } from 'react';
import { Building2, Users, Calendar, ClipboardList, BarChart3, Settings, Menu, Bell, FileText, Link as LinkIcon, Search } from 'lucide-react';
import { User } from './types/types';
import { useData } from './contexts/DataContext';
import { useAuth } from './contexts/AuthContext';
import { Routes, Route, Navigate, useNavigate, NavLink, Link } from 'react-router-dom';
import { Login } from './components/Login';
import { CreatePassword } from './components/CreatePassword';
import { LogOut, Lock } from 'lucide-react';

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
import { Logo } from './components/Logo';
import { GlobalSearch } from './components/GlobalSearch';


import { PreferencesModal } from './components/PreferencesModal';

const PageLoader = () => (
    <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
);

export default function Component() {
    const [isMac, setIsMac] = useState(true);

    useEffect(() => {
        setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    }, []);
    const { loading: dataLoading } = useData();
    const { session, profile: currentUser, loading: authLoading, signOut } = useAuth();
    
    const navigate = useNavigate();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showPreferences, setShowPreferences] = useState(false);
    
    // Define navigation items based on user role
    const getNavigationItems = () => {
        if (!currentUser) return [];
        const items = [];

        if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') {
            items.push({ id: 'organization', label: 'Organization', icon: Building2 });
        }

        items.push({ id: 'workload', label: 'Workload', icon: Users });
        items.push({ id: 'calendar', label: 'Tasks', icon: Calendar });

        if (currentUser.role === 'team_member' || currentUser.role === 'team_leader') {
            items.push({ id: 'approval', label: 'Task Approval', icon: ClipboardList });
        }

        if (currentUser.role === 'manager' || currentUser.role === 'super_admin' || currentUser.role === 'admin') {
            items.push({ id: 'manager-review', label: 'Manager Review', icon: ClipboardList });
        }

        if (currentUser.role === 'team_leader' || currentUser.role === 'manager' || currentUser.role === 'super_admin') {
            items.push({ id: 'team-dashboard', label: 'Team Dashboard', icon: Users });
        }

        if (currentUser.role === 'admin' || currentUser.role === 'super_admin') {
            items.push({ id: 'reports', label: 'Reports', icon: BarChart3 });
            items.push({ id: 'team-management', label: 'Team & Skills', icon: Settings });
        }

        if (currentUser.role === 'super_admin' || currentUser.role === 'admin') {
            items.push({ id: 'integrations', label: 'Integrations', icon: LinkIcon });
        }

        return items;
    };

    const navItems = getNavigationItems();

    const renderRoutes = () => {
        if (dataLoading) return <PageLoader />;
        if (!currentUser) return <PageLoader />;
        
        return (
            <Routes>
                <Route path="/" element={<Navigate to="/workload" replace />} />
                <Route path="/organization" element={<OrganizationDashboard currentUser={currentUser} />} />
                <Route path="/workload" element={<WorkloadDashboard currentUser={currentUser} />} />
                <Route path="/calendar" element={<CalendarView currentUser={currentUser} />} />
                <Route path="/personal" element={<PersonalDashboard currentUser={currentUser} />} />
                <Route path="/approval" element={<TaskApproval currentUser={currentUser} />} />
                <Route path="/manager-review" element={<ManagerReview currentUser={currentUser} />} />
                <Route path="/team-dashboard" element={<TeamDashboard currentUser={currentUser} />} />
                <Route path="/new-request" element={<RequestForm currentUser={currentUser} />} />
                <Route path="/integrations" element={<Integrations currentUser={currentUser} />} />
                <Route path="/reports" element={<Reports currentUser={currentUser} />} />
                <Route path="/team-management" element={<TeamManagement currentUser={currentUser} />} />
                <Route path="*" element={<Navigate to="/workload" replace />} />
            </Routes>
        );
    };

    if (authLoading) return <PageLoader />;

    return (
        <Routes>
            <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
            <Route path="/update-password" element={session ? <CreatePassword /> : <Navigate to="/login" />} />
            <Route path="*" element={
                !session ? (
                    <Navigate to="/login" />
                ) : !currentUser ? (
                    <div className="flex flex-col items-center justify-center min-h-screen text-center p-6 bg-gray-50">
                        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-md w-full">
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">Profile Missing</h2>
                            <p className="text-gray-500 mb-6">
                                You have successfully authenticated, but your user profile could not be found in the database. 
                                <br/><br/>
                                This usually happens if the <strong>supabase_auth_trigger.sql</strong> was not executed before you signed up.
                            </p>
                            <button 
                                onClick={async () => {
                                    await signOut();
                                    navigate('/login');
                                }} 
                                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                            >
                                Log Out
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="min-h-screen bg-gray-50">
                        {/* Header */}
                        <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
                            <div className="px-6 py-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                                            aria-label="Toggle sidebar"
                                        >
                                            <Menu className="w-5 h-5 text-gray-600" />
                                        </button>
                                        <Logo className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0" />
                                        <h1 className="text-xl font-semibold text-gray-900">WorkFlow Pro</h1>
                                    </div>
            
                                    {/* Search Bar */}
                                    <div className="flex-1 max-w-xl mx-8 hidden md:block">
                                        <GlobalSearch isMac={isMac} />
                                    </div>
            
                                    {/* User Profile + Logout */}
                                    <div className="flex items-center gap-4">
                            {/* Request Form Button */}
                            <Link
                                to="/new-request"
                                className="ml-2 flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                                <FileText className="w-4 h-4" />
                                <span className="text-sm font-medium">Request Form</span>
                            </Link>

                            {/* Notifications */}
                            <div className="relative ml-2">
                                <button
                                    onClick={() => setShowNotifications(!showNotifications)}
                                    className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    <Bell className="w-5 h-5 text-gray-600" />
                                </button>
                                
                                {showNotifications && (
                                    <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                                        <div className="p-4 border-b border-gray-100">
                                            <h3 className="font-semibold text-gray-900">Notifications</h3>
                                        </div>
                                        <div className="max-h-96 overflow-y-auto">
                                            <div className="p-8 text-center text-gray-500 text-sm">
                                                No new notifications
                                            </div>
                                        </div>
                                        <div className="p-3 bg-gray-50 text-center border-t border-gray-100">
                                            <button className="text-sm text-blue-600 font-medium hover:text-blue-700">
                                                Mark all as read
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {currentUser && (
                            <div className="relative flex items-center ml-2 border-l border-gray-200 pl-4">
                                <button 
                                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                                    className="flex items-center gap-3 hover:bg-gray-50 p-1.5 rounded-lg transition-colors focus:outline-none"
                                >
                                    {currentUser.avatar ? (
                                        <img 
                                            src={currentUser.avatar} 
                                            alt={currentUser.name} 
                                            className="w-8 h-8 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div 
                                            className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
                                        >
                                            {currentUser.name.includes('@') 
                                                ? currentUser.name.charAt(0).toUpperCase() 
                                                : currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="text-sm hidden md:block text-left">
                                        <p className="font-medium text-gray-900">{currentUser.name}</p>
                                        <p className="text-gray-500 capitalize">{currentUser.role.replace('_', ' ')}</p>
                                    </div>
                                </button>
                                
                                {showProfileMenu && (
                                    <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                                        <div className="p-5 border-b border-gray-100 flex flex-col gap-3">
                                            <div className="flex items-center gap-4">
                                                {currentUser.avatar ? (
                                                    <img 
                                                        src={currentUser.avatar} 
                                                        alt={currentUser.name} 
                                                        className="w-16 h-16 rounded-full object-cover"
                                                    />
                                                ) : (
                                                    <div 
                                                        className="w-16 h-16 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
                                                    >
                                                        {currentUser.name.includes('@') 
                                                            ? currentUser.name.charAt(0).toUpperCase() 
                                                            : currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-lg text-gray-900 truncate">{currentUser.name}</p>
                                                    <p className="text-sm text-gray-500 truncate">{currentUser.email}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="py-2">
                                            <button 
                                                onClick={() => {
                                                    setShowPreferences(true);
                                                    setShowProfileMenu(false);
                                                }}
                                                className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-gray-900 font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                <Settings className="w-5 h-5 text-gray-600 stroke-[1.5]" />
                                                Preferences
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    navigate('/update-password');
                                                    setShowProfileMenu(false);
                                                }}
                                                className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-gray-900 font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                <Lock className="w-5 h-5 text-gray-600 stroke-[1.5]" />
                                                Change Password
                                            </button>
                                        </div>
                                        <div className="border-t border-gray-200 py-2">
                                            <button 
                                                onClick={() => signOut()}
                                                className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-gray-900 font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                <LogOut className="w-5 h-5 text-gray-600 stroke-[1.5]" />
                                                Logout
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex">
                {/* Sidebar Navigation */}
                <aside className={`bg-white border-r border-gray-200 min-h-[calc(100vh-73px)] sticky top-[73px] transition-all duration-300 ${isSidebarOpen ? 'w-64' : 'w-20 flex-shrink-0'}`}>
                    <nav className="p-4">
                        <ul className="space-y-1">
                            {navItems.map(item => {
                                const Icon = item.icon;
                                return (
                                    <li key={item.id}>
                                        <NavLink
                                            to={`/${item.id}`}
                                            title={!isSidebarOpen ? item.label : undefined}
                                            className={({ isActive }) => `w-full flex items-center overflow-hidden rounded-lg text-sm font-medium transition-colors ${isActive
                                                    ? 'bg-blue-50 text-blue-700'
                                                    : 'text-gray-700 hover:bg-gray-50'
                                                }`}
                                        >
                                            <div className="flex items-center justify-center h-10 w-12 flex-shrink-0">
                                                <Icon className="w-5 h-5" />
                                            </div>
                                            <span className={`whitespace-nowrap transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0'}`}>
                                                {item.label}
                                            </span>
                                        </NavLink>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>
                </aside>

                {/* Main Content */}
                <main className="flex-1 p-6 min-w-0">
                    <Suspense fallback={<PageLoader />}>
                        {renderRoutes()}
                    </Suspense>
                </main>
            </div>

            {/* Modals */}
            <PreferencesModal 
                isOpen={showPreferences} 
                onClose={() => setShowPreferences(false)} 
                currentUser={currentUser} 
            />
        </div>
                )
            } />
        </Routes>
    );
}