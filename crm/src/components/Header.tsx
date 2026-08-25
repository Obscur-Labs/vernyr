'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { crumbsFor } from '@/lib/navigation';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import type { UserRole } from '@/types';

const ROLE_COLORS: Record<UserRole, string> = {
  admin:      'bg-indigo-500/15 text-indigo-400',
  counsellor: 'bg-emerald-500/15 text-emerald-400',
  student:    'bg-sky-500/15 text-sky-400',
  university: 'bg-teal-500/15 text-teal-400',
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Admin',
  counsellor: 'Counsellor',
  student:    'Student',
  university: 'University',
};

const initials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

interface Props {
  onOpenSearch: () => void;
  onOpenMenu: () => void;
}

export function Header({ onOpenSearch, onOpenMenu }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();

  const [menuOpen, setMenuOpen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { tail } = useBreadcrumb();
  const crumbs = crumbsFor(pathname, tail);

  /**
   * There is no way to read the history stack, so treat "we have navigated at
   * least once in this tab" as the condition — that is exactly when Back has
   * somewhere to go without leaving the app.
   */
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, [pathname]);

  // Close the account menu on an outside click or Escape
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

  const signOut = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      {/* Mobile drawer toggle */}
      <button
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-t2 hover:bg-muted lg:hidden"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
      </button>

      <button
        onClick={() => router.back()}
        disabled={!canGoBack}
        aria-label="Go back"
        title="Go back"
        className="rounded-lg p-2 text-t2 transition hover:bg-muted hover:text-t1 disabled:pointer-events-none disabled:opacity-30"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 truncate text-sm">
          {crumbs.map((crumb, i) => (
            <li key={crumb.href ?? crumb.label} className="flex shrink-0 items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-t3">/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="text-t2 transition hover:text-t1">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate font-semibold text-t1">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <button
        onClick={onOpenSearch}
        aria-label="Search pages"
        className="flex items-center gap-2 rounded-xl border border-line bg-card px-2.5 py-1.5 text-sm text-t3 transition hover:border-accent hover:text-t2"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-sans text-[10px] font-medium sm:block">
          ⌘K
        </kbd>
      </button>

      {user && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-xl p-1 pr-2 transition hover:bg-muted"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
              {initials(user.name)}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm font-medium text-t1 sm:block">
              {user.name}
            </span>
            <svg viewBox="0 0 20 20" fill="currentColor" className="hidden h-4 w-4 text-t3 sm:block">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-xl"
            >
              <div className="border-b border-line px-3 pb-2.5 pt-1.5">
                <p className="truncate text-sm font-semibold text-t1">{user.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${ROLE_COLORS[user.role]}`}>
                    {ROLE_LABELS[user.role]}
                  </span>
                  <span className="truncate text-xs text-t3">{user.username ?? user.email}</span>
                </div>
              </div>

              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 text-sm text-t2 transition hover:bg-muted hover:text-t1"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                Profile &amp; password
              </Link>

              <button
                role="menuitem"
                onClick={signOut}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
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
