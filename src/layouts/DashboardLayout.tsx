import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { Building2, Users, Calendar, ClipboardList, BarChart3, Settings, Menu, Bell, FileText, Link as LinkIcon, LogOut, Lock, Sliders } from 'lucide-react';
import { User } from '../types/types';
import { useAuth } from '../contexts/AuthContext';
import { Logo } from '../components/Logo';
import { GlobalSearch } from '../components/GlobalSearch';
import { PreferencesModal } from '../components/PreferencesModal';
import { DashboardIcon } from '../components/icons/DashboardIcon';

interface DashboardLayoutProps {
    currentUser: User;
}

export function DashboardLayout({ currentUser }: DashboardLayoutProps) {
    const { signOut } = useAuth();
    const navigate = useNavigate();
    const [isMac, setIsMac] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showPreferences, setShowPreferences] = useState(false);

    useEffect(() => {
        setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    }, []);

    const getNavigationItems = () => {
        const items = [];

        if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'manager') {
            items.push({ id: 'dashboard', label: 'Dashboard', icon: DashboardIcon });
        }

        items.push({ id: 'workload', label: 'Workload', icon: Users });
        items.push({ id: 'tasks', label: 'Tasks', icon: Calendar });

        if (currentUser.role === 'team_member' || currentUser.role === 'team_leader') {
            items.push({ id: 'approval', label: 'Task Approval', icon: ClipboardList });
        }

        if (currentUser.role === 'manager' || currentUser.role === 'super_admin' || currentUser.role === 'admin') {
            items.push({ id: 'manager-review', label: 'Manager Review', icon: ClipboardList });
        }

        if (['team_leader', 'manager', 'admin', 'super_admin'].includes(currentUser.role)) {
            items.push({ id: 'reports', label: 'Reports', icon: BarChart3 });
        }

        if (currentUser.role === 'admin' || currentUser.role === 'super_admin') {
            items.push({ id: 'team-management', label: 'Team & Skills', icon: Settings });
        }

        if (currentUser.role === 'super_admin' || currentUser.role === 'admin') {
            items.push({ id: 'integrations', label: 'Integrations', icon: LinkIcon });
        }

        return items;
    };

    const navItems = getNavigationItems();

    return (
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
                                                onClick={async () => {
                                                    await signOut();
                                                    navigate('/login');
                                                }}
                                                className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-gray-900 font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                <LogOut className="w-5 h-5 text-gray-600 stroke-[1.5]" />
                                                Logout
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
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
                    <Outlet />
                </main>
            </div>

            {/* Modals */}
            <PreferencesModal 
                isOpen={showPreferences} 
                onClose={() => setShowPreferences(false)} 
                currentUser={currentUser} 
            />
        </div>
    );
}
