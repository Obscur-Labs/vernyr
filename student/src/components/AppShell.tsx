'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import type { Notification } from '@/types';
import { apiOrigin } from '@/lib/config';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
        <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z"/>
        <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z"/>
      </svg>
    ),
  },
  {
    href: '/progress',
    label: 'Progress',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
        <path fillRule="evenodd" d="M2.25 13.5a8.25 8.25 0 018.25-8.25.75.75 0 01.75.75v6.75H18a.75.75 0 01.75.75 8.25 8.25 0 01-16.5 0z" clipRule="evenodd"/>
        <path fillRule="evenodd" d="M12.75 3a.75.75 0 01.75-.75 8.25 8.25 0 018.25 8.25.75.75 0 01-.75.75h-7.5a.75.75 0 01-.75-.75V3z" clipRule="evenodd"/>
      </svg>
    ),
  },
  {
    href: '/documents',
    label: 'Documents',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
        <path fillRule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625zM7.5 15a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5A.75.75 0 017.5 15zm.75 2.25a.75.75 0 000 1.5H12a.75.75 0 000-1.5H8.25z" clipRule="evenodd"/>
        <path d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z"/>
      </svg>
    ),
  },
  {
    href: '/applications',
    label: 'Apply',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
        <path d="M11.7 2.805a.75.75 0 01.6 0A60.65 60.65 0 0122.83 8.72a.75.75 0 01-.231 1.337 49.949 49.949 0 00-9.902 3.912l-.003.002-.34.18a.75.75 0 01-.707 0A50.009 50.009 0 007.5 12.174v-.224c0-.131.067-.248.172-.311a54.614 54.614 0 014.653-2.52.75.75 0 00-.65-1.352 56.129 56.129 0 00-4.78 2.589 1.858 1.858 0 00-.859 1.228 49.803 49.803 0 00-4.634-1.527.75.75 0 01-.231-1.337A60.653 60.653 0 0111.7 2.805z"/>
        <path d="M13.06 15.473a48.45 48.45 0 017.666-3.282c.134 1.414.22 2.843.255 4.285a.75.75 0 01-.46.71 47.878 47.878 0 00-8.105 4.342.75.75 0 01-.832 0 47.877 47.877 0 00-8.104-4.342.75.75 0 01-.461-.71c.035-1.442.121-2.87.255-4.286A48.4 48.4 0 016 13.18v1.27a1.5 1.5 0 00-.14 2.508c-.09.38-.222.753-.397 1.11.452.213.901.434 1.346.661a6.729 6.729 0 00.551-1.608 1.5 1.5 0 00.14-2.67v-.645a48.549 48.549 0 013.44 1.668 2.25 2.25 0 002.12 0z"/>
        <path d="M4.462 19.462c.42-.419.753-.89 1-1.394.453.213.902.434 1.347.661a6.743 6.743 0 01-1.286 1.794.75.75 0 11-1.06-1.06z"/>
      </svg>
    ),
  },
  {
    href: '/chat',
    label: 'Chat',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
        <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z" clipRule="evenodd"/>
      </svg>
    ),
  },
  {
    href: '/payments',
    label: 'Payments',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
        <path d="M4.5 3.75a3 3 0 00-3 3v.75h21v-.75a3 3 0 00-3-3h-15z"/>
        <path fillRule="evenodd" d="M22.5 9.75h-21v7.5a3 3 0 003 3h15a3 3 0 003-3v-7.5zm-18 3.75a.75.75 0 01.75-.75h6a.75.75 0 010 1.5h-6a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z" clipRule="evenodd"/>
      </svg>
    ),
  },
];

const BellIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M5.85 3.5a.75.75 0 00-1.117-1 9.719 9.719 0 00-2.348 4.876.75.75 0 001.479.248A8.219 8.219 0 015.85 3.5zM19.267 2.5a.75.75 0 10-1.118 1 8.22 8.22 0 011.987 4.124.75.75 0 001.48-.248A9.72 9.72 0 0019.266 2.5z"/>
    <path fillRule="evenodd" d="M12 2.25A6.75 6.75 0 005.25 9v.75a8.217 8.217 0 01-2.119 5.52.75.75 0 00.298 1.206c1.544.57 3.16.99 4.831 1.243a3.75 3.75 0 107.48 0 24.583 24.583 0 004.83-1.244.75.75 0 00.298-1.205 8.217 8.217 0 01-2.118-5.52V9A6.75 6.75 0 0012 2.25zM9.75 18c0-.034 0-.067.002-.1a25.05 25.05 0 004.496 0l.002.1a2.25 2.25 0 11-4.5 0z" clipRule="evenodd"/>
  </svg>
);

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

/** A sidebar row. */
function SideLink({
  href, label, icon, active, onNavigate, badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onNavigate: () => void;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200 ${
        active ? 'bg-accent/10 text-accent' : 'text-t2 hover:bg-muted hover:text-t1'
      }`}
    >
      {active && (
        <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <span className={`relative flex shrink-0 items-center ${active ? 'text-accent' : 'text-t3'}`}>
        {icon}
        {badge ? (
          <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

interface SidebarProps {
  pathname: string;
  unreadCount: number;
  theme: 'light' | 'dark';
  userName?: string;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onNavigate: () => void;
  onSeenNotifications: () => void;
}

/** Module scope, not a closure inside `AppShell`. */
function Sidebar({
  pathname, unreadCount, theme, userName,
  onToggleTheme, onSignOut, onNavigate, onSeenNotifications,
}: SidebarProps) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-[68px] shrink-0 items-center gap-3 border-b border-[var(--glass-border)] px-5">
        <VernyrMark className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <Wordmark className="text-[17px] text-t1" />
          <p className="text-[11px] font-medium text-t3">Student portal</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <SideLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}

        <div className="mt-2 space-y-1 border-t border-[var(--glass-border)] pt-2">
          <SideLink
            href="/notifications"
            label="Notifications"
            icon={<BellIcon className="h-5 w-5" />}
            active={isActive('/notifications')}
            badge={unreadCount}
            onNavigate={() => { onNavigate(); onSeenNotifications(); }}
          />
          <SideLink
            href="/profile"
            label="Profile"
            active={isActive('/profile')}
            onNavigate={onNavigate}
            icon={
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
                <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd"/>
              </svg>
            }
          />
        </div>
      </nav>

      <div className="shrink-0 space-y-2 border-t border-[var(--glass-border)] px-3 py-4">
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm text-t2 transition-colors duration-200 hover:bg-muted hover:text-t1"
        >
          {theme === 'light' ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-t3" aria-hidden>
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-t3" aria-hidden>
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/>
            </svg>
          )}
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>

        {userName && (
          <div className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
              {getInitials(userName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-t1">{userName}</p>
              <p className="text-[11px] font-medium text-t3">Student</p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onSignOut}
          className="danger-action flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd"/>
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
}

interface Props { children: React.ReactNode; title?: string; }

export function AppShell({ children, title }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { theme, toggle } = useTheme();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    api.get<Notification[]>('/notifications?limit=50')
      .then((r) => setUnreadCount(r.data.filter((n) => !n.read).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('student_token');
    const socket = io(apiOrigin, { auth: { token } });
    socketRef.current = socket;
    socket.on('notification', (n: { title?: string }) => {
      setUnreadCount((c) => c + 1);
      toast(n?.title ? `New: ${n.title}` : 'You have a new notification', 'info');
    });
    return () => { socket.disconnect(); };
  }, [user, toast]);

  useEffect(() => {
    const token = localStorage.getItem('student_token');
    if (!token) router.push('/login');
  }, [router]);

  // A drawer left open across a navigation covers the page it just opened.
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);

  const handleSignOut = () => {
    clearAuth();
    router.push('/login');
  };

  const sidebar = (
    <Sidebar
      pathname={pathname}
      unreadCount={unreadCount}
      theme={theme}
      userName={user?.name}
      onToggleTheme={toggle}
      onSignOut={handleSignOut}
      onNavigate={() => setMobileMenuOpen(false)}
      onSeenNotifications={() => setUnreadCount(0)}
    />
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-base">
      {/* Ambient wash — low-contrast colour behind the glass, not a light show. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-orb-a absolute -left-24 -top-40 h-[560px] w-[560px] rounded-full blur-[120px]" style={{ background: 'var(--orb-1)' }} />
        <div className="animate-orb-b absolute -right-32 top-1/2 h-[420px] w-[420px] rounded-full blur-[100px]" style={{ background: 'var(--orb-2)' }} />
        <div className="animate-orb-c absolute -bottom-24 left-1/3 h-[380px] w-[380px] rounded-full blur-[90px]" style={{ background: 'var(--orb-3)' }} />
      </div>

      {/* Desktop sidebar */}
      <aside
        className="glass relative z-10 hidden w-60 shrink-0 flex-col lg:flex"
        style={{ borderRight: '1px solid var(--glass-border)', background: 'var(--glass-bg)' }}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      <div
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          mobileMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className="glass fixed inset-y-0 left-0 z-50 flex w-64 flex-col transition-transform duration-300 lg:hidden"
        style={{
          borderRight: '1px solid var(--glass-border)',
          background: 'var(--glass-bg)',
          transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
        aria-hidden={!mobileMenuOpen}
      >
        {sidebar}
      </aside>

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="glass-nav flex items-center gap-2 border-b px-3 py-2.5 lg:hidden" style={{ borderColor: 'var(--glass-border)' }}>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-t2 transition-colors hover:bg-muted hover:text-t1"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
            </svg>
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <VernyrMark className="h-6 w-6 shrink-0" />
            {title
              ? <span className="truncate text-sm font-semibold text-t1">{title}</span>
              : <Wordmark className="text-[14px] text-t1" />}
          </div>

          <div className="flex-1" />

          <Link
            href="/notifications"
            onClick={() => setUnreadCount(0)}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            className="relative flex h-11 w-11 items-center justify-center rounded-xl text-t2 transition-colors hover:bg-muted hover:text-t1"
          >
            <BellIcon className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>

          <Link
            href="/profile"
            aria-label="Profile"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
          >
            {user ? getInitials(user.name) : 'U'}
          </Link>
        </div>

        {/* Mobile bottom nav */}
        <nav
          aria-label="Primary"
          className="glass-nav fixed bottom-0 left-0 right-0 z-30 flex items-center border-t lg:hidden"
          style={{ borderColor: 'var(--glass-border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV_ITEMS.slice(0, 5).map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors duration-200 ${
                  isActive ? 'text-accent' : 'text-t3'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
