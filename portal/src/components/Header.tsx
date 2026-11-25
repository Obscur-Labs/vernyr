'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { VernyrMark } from '@/components/auth/Insignia';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/context/ThemeContext';

const initials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

/** 44pt-square toolbar control. */
function ToolbarButton({
  label, onClick, className = '', children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-t2 transition-colors duration-200 hover:bg-muted hover:text-t1 active:scale-[0.97] ${className}`}
    >
      {children}
    </button>
  );
}

interface Props {
  title?: string;
  unreadCount: number;
  onOpenMenu: () => void;
  onSeenNotifications: () => void;
}

export function Header({ title, unreadCount, onOpenMenu, onSeenNotifications }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const signOut = () => {
    clearAuth();
    router.push('/login');
  };

  const dark = theme === 'dark';

  return (
    <header
      className="glass-nav sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-1 border-b px-2 sm:px-3 lg:min-h-[60px] lg:px-4"
      style={{ borderColor: 'var(--glass-border)', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <ToolbarButton label="Open navigation" onClick={onOpenMenu} className="lg:hidden">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
      </ToolbarButton>

      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
        <VernyrMark className="h-6 w-6 shrink-0 lg:hidden" />
        <h1 className="truncate text-[17px] font-semibold text-t1">{title ?? 'Vernyr'}</h1>
      </div>

      <ToolbarButton label={dark ? 'Switch to light appearance' : 'Switch to dark appearance'} onClick={toggle}>
        {dark ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        )}
      </ToolbarButton>

      <Link
        href="/notifications"
        onClick={onSeenNotifications}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        title="Notifications"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-t2 transition-colors duration-200 hover:bg-muted hover:text-t1"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path fillRule="evenodd" d="M12 2.25A6.75 6.75 0 005.25 9v.75a8.217 8.217 0 01-2.119 5.52.75.75 0 00.298 1.206c1.544.57 3.16.99 4.831 1.243a3.75 3.75 0 107.48 0 24.583 24.583 0 004.83-1.244.75.75 0 00.298-1.205 8.217 8.217 0 01-2.118-5.52V9A6.75 6.75 0 0012 2.25zM9.75 18c0-.034 0-.067.002-.1a25.05 25.05 0 004.496 0l.002.1a2.25 2.25 0 11-4.5 0z" clipRule="evenodd" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Link>

      {user && (
        <div ref={menuRef} className="relative ml-0.5">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex h-11 items-center gap-2 rounded-full pl-1 pr-1 transition-colors duration-200 hover:bg-muted sm:pr-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-bold text-accent">
              {initials(user.name)}
            </span>
            <span className="hidden max-w-[9rem] truncate text-[13px] font-medium text-t1 sm:block">
              {user.name}
            </span>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="hidden h-4 w-4 text-t3 sm:block">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="animate-scale-in absolute right-0 z-50 mt-2 w-[min(16rem,calc(100vw-1rem))] origin-top-right overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
            >
              <div className="px-2.5 pb-2.5 pt-1.5">
                <p className="truncate text-[15px] font-semibold text-t1">{user.name}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Student</span>
                  <span className="truncate text-[12px] text-t3">{user.username ?? user.email}</span>
                </div>
              </div>

              <div className="my-1 h-px bg-line" />

              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] text-t2 transition-colors hover:bg-muted hover:text-t1"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-[18px] w-[18px] text-t3">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                Profile &amp; password
              </Link>

              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                className="danger-action flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-[18px] w-[18px]">
                  <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
