'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { Header } from '@/components/Header';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { sidebarFor, type NavItem } from '@/lib/navigation';
import { BreadcrumbProvider } from '@/context/BreadcrumbContext';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import type { AccessSnapshot, Notification } from '@/types';
import { apiOrigin } from '@/lib/config';

const FOLD_KEY = 'crm_sidebar_folded';

const BellIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
  </svg>
);

/** One sidebar row. */
function NavRow({
  href, label, icon, active, folded, onNavigate, badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  folded: boolean;
  onNavigate: () => void;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={folded ? label : undefined}
      className={`hig-press relative flex h-11 items-center rounded-xl text-[15px] font-medium ${
        folded ? 'justify-center px-0' : 'gap-3 px-3'
      } ${active ? 'bg-accent/15 text-accent' : 'text-t2 hover:bg-muted hover:text-t1'}`}
    >
      <span className={`relative flex shrink-0 items-center ${active ? 'text-accent' : 'text-t3'}`}>
        {icon}
        {folded && badge ? (
          <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />
        ) : null}
      </span>

      {!folded && (
        <>
          <span className="hig-fold-label flex-1 truncate">{label}</span>
          {badge ? (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </>
      )}
    </Link>
  );
}

interface SidebarProps {
  items: NavItem[];
  pathname: string;
  folded: boolean;
  unreadCount: number;
  onNavigate: () => void;
}

/** Defined at module scope, not inside `AppShell`. */
function Sidebar({ items, pathname, folded, unreadCount, onNavigate }: SidebarProps) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="flex h-full flex-col">
      {/* Brand — the same height as the toolbar, so the two share one baseline.
          Expanded shows the wordmark; folded, the mark alone. */}
      <div
        className={`flex h-[var(--chrome-h)] shrink-0 items-center border-b border-line ${
          folded ? 'justify-center px-0' : 'px-5'
        }`}
      >
        <Link
          href="/dashboard"
          aria-label="Vernyr — go to dashboard"
          className="hig-press flex items-center rounded-lg text-t1"
        >
          {folded ? <VernyrMark className="h-7 w-7" /> : <Wordmark className="text-[19px]" />}
        </Link>
      </div>

      <nav aria-label="Primary" className={`flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-3 ${folded ? 'px-3' : 'px-3'}`}>
        {items.map((item) => (
          <NavRow
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            folded={folded}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="shrink-0 border-t border-line px-3 py-3">
        <NavRow
          href="/notifications"
          label="Notifications"
          icon={<BellIcon className="h-5 w-5" />}
          active={isActive('/notifications')}
          folded={folded}
          onNavigate={onNavigate}
          badge={unreadCount}
        />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, access, setAccess } = useAuthStore();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const { open: palette, setOpen: setPalette } = useCommandPalette();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Restore the fold after hydration. Reading localStorage during render would
  // make the server and client markup disagree.
  useEffect(() => {
    setFolded(localStorage.getItem(FOLD_KEY) === '1');
  }, []);

  const toggleFold = useCallback(() => {
    setFolded((v) => {
      localStorage.setItem(FOLD_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // ⌘\ folds the sidebar — the Finder / Xcode binding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleFold();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFold]);

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (!token) router.push('/login');
  }, [router]);

  // Refresh the seat on boot. The persisted copy is what draws the first paint;
  // this is what catches a permission changed while the tab was closed.
  useEffect(() => {
    if (!user) return;
    api.get<AccessSnapshot>('/access/me')
      .then((r) => setAccess(r.data))
      .catch(() => {});
  }, [user, setAccess]);

  // Close the mobile drawer on navigation — otherwise it covers the page it
  // just opened.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Fetch notifications — re-runs on page navigation to keep the badge in sync
  useEffect(() => {
    if (!user) return;
    api.get<Notification[]>('/notifications?limit=100')
      .then((r) => setNotifications(r.data))
      .catch(() => {});
  }, [user, pathname]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('crm_token');
    const socket = io(apiOrigin, { auth: { token } });
    socketRef.current = socket;
    socket.on('notification', (n: Notification) => {
      setNotifications((prev) => [n, ...prev].slice(0, 20));
      toast(`New notification: ${n.title}`, 'info');
    });
    return () => { socket.disconnect(); };
  }, [user, toast]);

  const visibleNav = sidebarFor(access?.permissions);

  return (
    <div className="flex h-screen overflow-hidden bg-base">
      {/* Desktop sidebar */}
      <aside
        className="hig-fold hig-sidebar hidden shrink-0 flex-col border-r border-line lg:flex"
        style={{ width: folded ? 'var(--sidebar-w-fold)' : 'var(--sidebar-w)' }}
      >
        <Sidebar
          items={visibleNav}
          pathname={pathname}
          folded={folded}
          unreadCount={unreadCount}
          onNavigate={() => {}}
        />
      </aside>

      {/* Mobile drawer */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`hig-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line transition-transform duration-300 lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ transitionTimingFunction: 'var(--ease-out)' }}
        aria-hidden={!mobileOpen}
      >
        <Sidebar
          items={visibleNav}
          pathname={pathname}
          folded={false}
          unreadCount={unreadCount}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      <BreadcrumbProvider>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header
            onOpenSearch={() => setPalette(true)}
            onOpenMenu={() => setMobileOpen(true)}
            onToggleFold={toggleFold}
            folded={folded}
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </BreadcrumbProvider>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
