'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import type { UserRole, Notification } from '@/types';
import { apiOrigin } from '@/lib/config';


const ROLE_COLORS: Record<UserRole, string> = {
  super_admin:       'bg-indigo-500/15 text-indigo-400',
  admin:             'bg-violet-500/15 text-violet-400',
  counsellor_manager:'bg-emerald-500/15 text-emerald-400',
  counsellor:        'bg-emerald-500/15 text-emerald-400',
  finance:           'bg-amber-500/15 text-amber-400',
  accountant:        'bg-amber-500/15 text-amber-400',
  visa_team:         'bg-blue-500/15 text-blue-400',
  doc_verification:  'bg-orange-500/15 text-orange-400',
  university_team:   'bg-cyan-500/15 text-cyan-400',
  support:           'bg-slate-500/15 text-slate-400',
  student:           'bg-sky-500/15 text-sky-400',
  university:        'bg-teal-500/15 text-teal-400',
};

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:       'Super Admin',
  admin:             'Admin',
  counsellor_manager:'Manager',
  counsellor:        'Counsellor',
  finance:           'Finance',
  accountant:        'Accountant',
  visa_team:         'Visa Team',
  doc_verification:  'Doc Verify',
  university_team:   'Uni Team',
  support:           'Support',
  student:           'Student',
  university:        'University',
};

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
      </svg>
    ),
  },
  {
    href: '/leads',
    label: 'Leads',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
      </svg>
    ),
    roles: ['super_admin','admin','counsellor_manager','counsellor','finance','accountant','university_team','support','university'],
  },
  {
    href: '/students',
    label: 'Students',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
      </svg>
    ),
  },
  {
    href: '/chat',
    label: 'Chat',
    // Admin accounts have no chat access — chat is for staff working cases
    roles: ['counsellor_manager','counsellor','finance','accountant','visa_team','doc_verification','university_team','support'],
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd"/>
      </svg>
    ),
  },
  {
    href: '/applications',
    label: 'Applications',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    ),
    roles: ['super_admin','admin','counsellor_manager','counsellor','university_team','university'],
  },
  {
    href: '/visa',
    label: 'Visa Tracker',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    roles: ['super_admin','admin','counsellor_manager','counsellor','visa_team'],
  },
  {
    href: '/documents',
    label: 'Documents',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
      </svg>
    ),
    roles: ['super_admin','admin','counsellor_manager','counsellor','doc_verification'],
  },
  {
    href: '/finance',
    label: 'Finance',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
      </svg>
    ),
    roles: ['super_admin','admin','finance','accountant'],
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
      </svg>
    ),
    roles: ['super_admin','admin','counsellor_manager'],
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
    roles: ['super_admin','admin'],
  },
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

interface Props { children: React.ReactNode; }

export function AppShell({ children }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications,   setNotifications]   = useState<Notification[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (!token) router.push('/login');
  }, [router]);

  // Fetch notifications — re-runs on page navigation to keep badge in sync
  useEffect(() => {
    if (!user) return;
    api.get<Notification[]>('/notifications?limit=100')
      .then(r => setNotifications(r.data))
      .catch(() => {});
  }, [user, pathname]);

  // Connect socket to receive real-time notifications
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('crm_token');
    const socket = io(apiOrigin, { auth: { token } });
    socketRef.current = socket;
    socket.on('notification', (n: Notification) => {
      setNotifications(prev => [n, ...prev].slice(0, 20));
      toast(`New notification: ${n.title}`, 'info');
    });
    return () => { socket.disconnect(); };
  }, [user, toast]);

  // ──────────────────────────────────────────────────────────────────────────

  const handleSignOut = () => {
    clearAuth();
    router.push('/login');
  };

  const visibleNav = NAV_ITEMS.filter(item =>
    !item.roles || (user && item.roles.includes(user.role))
  );

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-accent" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span className="font-bold text-base text-t1 tracking-tight">StudyCRM</span>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map(item => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-t2 hover:text-t1 hover:bg-muted'
              }`}
            >
              <span className={isActive ? 'text-accent' : 'text-t3'}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 py-4 border-t border-line space-y-2">
        {/* Notification bell */}
        <Link
          href="/notifications"
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
            pathname.startsWith('/notifications')
              ? 'bg-accent/15 text-accent'
              : 'text-t2 hover:text-t1 hover:bg-muted'
          }`}
        >
          <div className="relative flex-shrink-0">
            <svg viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${pathname.startsWith('/notifications') ? 'text-accent' : 'text-t3'}`}>
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <span>Notifications</span>
          {unreadCount > 0 && (
            <span className="ml-auto text-xs bg-accent/15 text-accent px-1.5 py-0.5 rounded-full font-medium">{unreadCount}</span>
          )}
        </Link>

        {/* User info */}
        {user && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted">
            <div className="w-8 h-8 rounded-full bg-accent/20 text-accent text-sm font-bold flex items-center justify-center flex-shrink-0">
              {getInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-t1 truncate">{user.name}</p>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role]}`}>
                {ROLE_LABELS[user.role]}
              </span>
            </div>
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd"/>
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-base overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 flex-col bg-surface border-r border-line flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-line flex flex-col lg:hidden transition-transform duration-300 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <SidebarContent />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-surface border-b border-line">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-t2 hover:bg-muted"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
            </svg>
          </button>
          <span className="font-bold text-t1">StudyCRM</span>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
