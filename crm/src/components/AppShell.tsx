'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { Header } from '@/components/Header';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { sidebarFor } from '@/lib/navigation';
import { BreadcrumbProvider } from '@/context/BreadcrumbContext';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import type { Notification } from '@/types';
import { apiOrigin } from '@/lib/config';


interface Props { children: React.ReactNode; }

export function AppShell({ children }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open: palette, setOpen: setPalette } = useCommandPalette();

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

  const visibleNav = sidebarFor(user?.role);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-line">
        <div className="flex items-center gap-2.5">
          <VernyrMark className="w-8 h-8 flex-shrink-0" />
          <Wordmark className="text-[17px] text-t1" />
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
      <BreadcrumbProvider>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onOpenSearch={() => setPalette(true)} onOpenMenu={() => setMobileOpen(true)} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      </BreadcrumbProvider>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
