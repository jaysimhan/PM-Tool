import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Outlet,
  NavLink,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  Building2,
  Users,
  Calendar,
  ClipboardList,
  BarChart3,
  Settings,
  Menu,
  Bell,
  FileText,
  Link as LinkIcon,
  LogOut,
  Shield,
  Sliders,
  GanttChart,
  UserPlus,
} from "lucide-react";
import {
  User,
  Notification as AppNotification,
  isPreMember,
} from "../types/types";
import { supabase, inTestSandbox } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import { Logo } from "../components/Logo";
import { GlobalSearch } from "../components/GlobalSearch";
import { PreferencesModal } from "../components/PreferencesModal";
import { DashboardIcon } from "../components/icons/DashboardIcon";
import { MemberViewPicker } from "../components/MemberViewPicker";
import { useMemberView } from "../contexts/MemberViewContext";
import { useIsTestPath, toTestPath, TEST_PREFIX } from "../lib/testEnvironment";
import toast from "react-hot-toast";

interface DashboardLayoutProps {
  currentUser: User;
}

// A notification about a task names the task, not just the page it lives on: /tasks?task=<id>
// lands on the task list with that task already open in the details panel. /tasks/<id> is
// accepted as the same thing, because no route serves it and the redirect would otherwise
// dump the reader on the workload page with no idea which task was meant.
const TASK_ID_PATH = /^\/tasks\/([0-9a-fA-F-]{36})\/?$/;

function resolveNotificationLink(link: string): string {
  const match = link.match(TASK_ID_PATH);
  return match ? `/tasks?task=${match[1]}` : link;
}

export function DashboardLayout({ currentUser }: DashboardLayoutProps) {
  const { signOut } = useAuth();
  const { loadIssues, retryDataLoad } = useData();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Once you are in the test environment the sidebar keeps you there — every page has a
  // copy under /test — and the badge in the header is the way back out.
  const inTestEnvironment = useIsTestPath();
  const { enabled: memberViewEnabled } = useMemberView();
  const navPath = (id: string) =>
    inTestEnvironment ? toTestPath(id) : `/${id}`;
  const livePath = inTestEnvironment
    ? pathname.slice(TEST_PREFIX.length) || "/workload"
    : pathname;
  const [isMac, setIsMac] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);

  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // The bell used to say "No new notifications" no matter what; nothing had ever been
  // written to the table it was supposedly reading. These are real rows, addressed to this
  // person by RLS, so nobody else's ever arrive here.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const loadNotifications = useCallback(async () => {
    // The test environment runs on invented data, and real notifications point at real
    // tasks that do not exist there.
    if (inTestEnvironment) {
      setNotifications([]);
      return;
    }
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, message, link, is_read, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Could not load notifications:", error);
      return;
    }
    setNotifications(
      (data || []).map((n: any) => ({
        id: n.id,
        userId: currentUser.id,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link || undefined,
        isRead: n.is_read === true,
        createdDate: n.created_at,
      })),
    );
  }, [currentUser.id, inTestEnvironment]);

  // On arrival, and then at a pace that suits something nobody is waiting on. Opening the
  // bell refetches too, so the list is never stale at the moment it is actually read.
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Being handed a task is the first notification here worth knowing about within the
  // minute, so new rows arrive on their own instead of waiting for the next poll. The poll
  // stays: it is what covers a dropped socket, and re-fetching a list of thirty is cheap.
  //
  // The filter is a courtesy to the wire, not the rule -- notifications_select_own is what
  // stops anyone else's rows reaching this browser, and Realtime honours RLS.
  //
  // Not under /test. The sandbox intercepts from/rpc/functions at the client but not
  // channel(), so a subscription opened there would be the one live connection to
  // production on a page whose whole premise is invented data.
  useEffect(() => {
    if (inTestEnvironment || inTestSandbox()) return;

    const channel = supabase
      .channel(`notifications:${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUser.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          setNotifications((prev) => {
            // The poll and the socket can both deliver the same row.
            if (prev.some((n) => n.id === row.id)) return prev;
            return [
              {
                id: row.id,
                userId: row.user_id,
                type: row.type,
                title: row.title,
                message: row.message,
                link: row.link || undefined,
                isRead: row.is_read === true,
                createdDate: row.created_at,
              },
              ...prev,
            ];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser.id, inTestEnvironment]);

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (unread.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", unread);
    if (error) {
      console.error("Could not mark notifications read:", error);
      toast.error("Could not mark notifications as read.");
      loadNotifications();
    }
  };

  const openNotification = async (notification: AppNotification) => {
    setShowNotifications(false);
    if (!notification.isRead) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, isRead: true } : n,
        ),
      );
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notification.id);
      if (error) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, isRead: false } : n,
          ),
        );
        toast.error("Could not mark this notification as read.");
      }
    }
    // Prefixed for wherever we are: a notification opened from inside /test must not walk
    // the reader out onto the live task it names.
    if (notification.link) {
      const target = resolveNotificationLink(notification.link);
      navigate(inTestEnvironment ? toTestPath(target) : target);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setShowProfileMenu(false);
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  // Nothing here is gated on having a team. Somebody an admin has not placed yet is a member
  // without a team, not a member on hold: setup puts everyone on the default team, and an admin
  // taking them off one is not meant to take the app away with it. There is no team picker to
  // send them to any more -- see ProtectedRoute.
  const getNavigationItems = () => {
    const items = [];

    // Read-only org-wide numbers, with nothing on it that belongs to one person or one
    // team, so it is not gated on either.
    items.push({ id: "dashboard", label: "Dashboard", icon: DashboardIcon });

    items.push({ id: "workload", label: "Team View", icon: Users });
    items.push({ id: "tasks", label: "Tasks", icon: Calendar });

    // We moved Task Approval and Review to the dashboard directly.
    if (
      ["team_leader", "manager", "admin", "super_admin"].includes(
        currentUser.role,
      )
    ) {
      items.push({ id: "reports", label: "Reports", icon: BarChart3 });
    }

    // Everyone can view teams, members, and skills - editing/inviting/managing is
    // gated inside the page itself (team leaders for their own team, admins for all).
    items.push({
      id: "team-management",
      label: "Team & Skills",
      icon: Settings,
    });

    return items;
  };

  const navItems = getNavigationItems();

  // Same rule Team Management applies to its own invite button: admins anywhere, and a
  // team leader for the team they are on.
  const canInvite =
    currentUser.role === "super_admin" ||
    currentUser.role === "admin" ||
    currentUser.role === "team_leader";

  // The shell owns the viewport: header and sidebar are fixed furniture, and only the main
  // pane scrolls. This replaces sticky positioning against a hardcoded 73px header, which
  // was always a few pixels out — the header's real height depends on its content, so the
  // page scrolled by the difference and took the sidebar with it.
  return (
    <div className="h-dvh flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 relative z-50 flex-shrink-0">
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
              <h1 className="text-xl font-semibold text-gray-900">
                WorkFlow Pro
              </h1>
              {/* The pages under /test are the same pages against the same data —
                                only the unreleased bits are switched on — so say so plainly and
                                keep the way back one click away. */}
              {inTestEnvironment && (
                <Link
                  to={livePath}
                  title="Leave the test environment"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors"
                >
                  Test environment
                  <span className="font-normal text-amber-600">· exit</span>
                </Link>
              )}
            </div>

            {/* Search Bar */}
            <div className="flex-1 max-w-xl mx-8 hidden md:block">
              <GlobalSearch isMac={isMac} />
            </div>

            {/* User Profile + Logout */}
            <div className="flex items-center gap-4">
              {/* Whose work every page below is showing. Only present where the
                                member view is switched on, which today means /test. */}
              {memberViewEnabled && <MemberViewPicker />}

              {/* Request Form Button */}
              <Link
                to="/new-request"
                className="ml-2 flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span className="text-sm font-medium">Request Form</span>
              </Link>

              {/* Notifications */}
              <div className="relative ml-2" ref={notificationsRef}>
                <button
                  onClick={() => {
                    const opening = !showNotifications;
                    setShowNotifications(opening);
                    if (opening) loadNotifications();
                  }}
                  className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  aria-label={
                    unreadCount > 0
                      ? `${unreadCount} unread notifications`
                      : "Notifications"
                  }
                >
                  <Bell className="w-5 h-5 text-gray-600" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">
                        Notifications
                      </h3>
                      {unreadCount > 0 && (
                        <span className="text-xs text-gray-500">
                          {unreadCount} unread
                        </span>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 text-sm">
                          No new notifications
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openNotification(notification)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openNotification(notification);
                              }
                            }}
                            className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors ${
                              notification.isRead ? "" : "bg-blue-50/50"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {!notification.isRead && (
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                              )}
                              <div
                                className={notification.isRead ? "pl-3.5" : ""}
                              >
                                <div className="text-sm font-medium text-gray-900">
                                  {notification.title}
                                </div>
                                <div className="text-xs text-gray-600 mt-0.5">
                                  {notification.message}
                                </div>
                                <div className="text-[11px] text-gray-400 mt-1">
                                  {new Date(
                                    notification.createdDate,
                                  ).toLocaleString("en-GB", {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </div>
                                {/* The row already opens the task itself. This is for the
                                                                    reader who would rather see everything waiting on them
                                                                    at once than answer them one notification at a time. */}
                                {notification.type === "task_assignment" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowNotifications(false);
                                      navigate(navPath("dashboard"));
                                    }}
                                    className="mt-2 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                                  >
                                    Review all approvals
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="p-3 bg-gray-50 text-center border-t border-gray-100">
                      <button
                        onClick={markAllRead}
                        disabled={unreadCount === 0}
                        className="text-sm text-blue-600 font-medium hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                      >
                        Mark all as read
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                className="relative flex items-center ml-2 border-l border-gray-200 pl-4"
                ref={profileMenuRef}
              >
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
                    <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                      {currentUser.name.includes("@")
                        ? currentUser.name.charAt(0).toUpperCase()
                        : currentUser.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .substring(0, 2)
                            .toUpperCase()}
                    </div>
                  )}
                  <div className="text-sm hidden md:block text-left">
                    <p className="font-medium text-gray-900">
                      {currentUser.name}
                    </p>
                    <p className="text-gray-500 capitalize">
                      {currentUser.role.replace("_", " ")}
                    </p>
                  </div>
                </button>

                {showProfileMenu && (
                  <div className="absolute right-0 top-full mt-2 min-w-[16rem] w-max max-w-md bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50">
                    <div className="p-5 border-b border-gray-100 flex flex-col gap-3">
                      <div className="flex items-center gap-4">
                        {currentUser.avatar ? (
                          <img
                            src={currentUser.avatar}
                            alt={currentUser.name}
                            className="w-16 h-16 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-16 h-16 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0">
                            {currentUser.name.includes("@")
                              ? currentUser.name.charAt(0).toUpperCase()
                              : currentUser.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .substring(0, 2)
                                  .toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="font-semibold text-lg text-gray-900 break-words">
                            {currentUser.name}
                          </p>
                          <p className="text-sm text-gray-500 break-all">
                            {currentUser.email}
                          </p>
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
                          navigate("/security-settings");
                          setShowProfileMenu(false);
                        }}
                        className="w-full flex items-center gap-4 px-6 py-3 text-[15px] text-gray-900 font-medium hover:bg-gray-50 transition-colors"
                      >
                        <Shield className="w-5 h-5 text-gray-600 stroke-[1.5]" />
                        Security Settings
                      </button>
                    </div>
                    <div className="border-t border-gray-200 py-2">
                      <button
                        onClick={async () => {
                          await signOut();
                          navigate("/login");
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

      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <aside
          className={`bg-white border-r border-gray-200 h-full transition-all duration-300 flex flex-col flex-shrink-0 ${isSidebarOpen ? "w-64" : "w-20"}`}
        >
          <nav className="p-4 flex-1 overflow-y-auto">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <NavLink
                      to={navPath(item.id)}
                      title={!isSidebarOpen ? item.label : undefined}
                      className={({ isActive }) =>
                        `w-full flex items-center overflow-hidden rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-blue-50 text-blue-700"
                            : "text-gray-700 hover:bg-gray-50"
                        }`
                      }
                    >
                      <div className="flex items-center justify-center h-10 w-12 flex-shrink-0">
                        <Icon className="w-5 h-5" />
                      </div>
                      <span
                        className={`whitespace-nowrap transition-opacity duration-300 ${isSidebarOpen ? "opacity-100" : "opacity-0"}`}
                      >
                        {item.label}
                      </span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Inviting is the same job from wherever you start it, so it lives here
                        rather than only inside a team's section of Team Management. */}
          {canInvite && (
            <div className="p-4 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={() =>
                  navigate(navPath("team-management"), {
                    state: { openInvite: true },
                  })
                }
                title={!isSidebarOpen ? "Invite Team Member" : undefined}
                className="w-full flex items-center overflow-hidden rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <div className="flex items-center justify-center h-10 w-12 flex-shrink-0">
                  <UserPlus className="w-5 h-5" />
                </div>
                <span
                  className={`whitespace-nowrap transition-opacity duration-300 ${isSidebarOpen ? "opacity-100" : "opacity-0"}`}
                >
                  Invite Team Member
                </span>
              </button>
            </div>
          )}
        </aside>

        {/* Main Content — the only scroll container on the page */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {loadIssues.length > 0 && (
            <div role="alert" className="m-4 mb-0 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>Some data could not load: {loadIssues.join(", ")}.</span>
              <button type="button" onClick={() => void retryDataLoad()} className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500">
                Retry
              </button>
            </div>
          )}
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
