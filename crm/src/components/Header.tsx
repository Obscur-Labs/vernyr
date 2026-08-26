'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { crumbsFor } from '@/lib/navigation';
import { useBreadcrumb } from '@/context/BreadcrumbContext';
import type { UserRole } from '@/types';

const ROLE_CHIPS: Record<UserRole, string> = {
  admin:      'chip-admin',
  counsellor: 'chip-counsellor',
  student:    'chip-student',
  university: 'chip-university',
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Admin',
  counsellor: 'Counsellor',
  student:    'Student',
  university: 'University',
};

const initials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

/** 44pt-square toolbar control — the HIG minimum for a tappable target. */
function ToolbarButton({
  label, onClick, disabled, className = '', children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`hig-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-t2 hover:bg-muted hover:text-t1 disabled:pointer-events-none disabled:opacity-30 ${className}`}
    >
      {children}
    </button>
  );
}

interface Props {
  onOpenSearch: () => void;
  onOpenMenu: () => void;
  onToggleFold: () => void;
  folded: boolean;
}

export function Header({ onOpenSearch, onOpenMenu, onToggleFold, folded }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();

  const [menuOpen, setMenuOpen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { tail } = useBreadcrumb();
  const crumbs = crumbsFor(pathname, tail);

  /** The history stack is unreadable; length > 1 means Back stays in-app. */
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

  // The menu is an overlay, so a navigation must dismiss it.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const signOut = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <header className="hig-chrome sticky top-0 z-30 flex h-[var(--chrome-h)] shrink-0 items-center gap-1 border-b border-line px-2 sm:px-3">
      {/* Mobile drawer toggle */}
      <ToolbarButton label="Open navigation" onClick={onOpenMenu} className="lg:hidden">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
      </ToolbarButton>

      {/* Sidebar fold — ⌘\, the Finder binding */}
      <ToolbarButton
        label={folded ? 'Show sidebar' : 'Hide sidebar'}
        onClick={onToggleFold}
        className="hidden lg:flex"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
          <rect x="2.5" y="3.5" width="15" height="13" rx="3" />
          <path d="M7.5 3.5v13" />
          {folded && <path d="M4.6 8.6 6 10l-1.4 1.4" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      </ToolbarButton>

      <ToolbarButton label="Go back" onClick={() => router.back()} disabled={!canGoBack}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </ToolbarButton>

      <nav aria-label="Breadcrumb" className="ml-1 min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 truncate text-[13px]">
          {crumbs.map((crumb, i) => (
            <li key={crumb.href ?? crumb.label} className="flex min-w-0 shrink-0 items-center gap-1.5 last:shrink">
              {i > 0 && <span aria-hidden className="text-t3">/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="rounded text-t2 transition-colors hover:text-t1">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate text-[15px] font-semibold text-t1">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Search — capsule field, the HIG search affordance */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search pages"
        className="hig-press flex h-9 items-center gap-2 rounded-full border border-line bg-card px-3 text-[13px] text-t3 hover:border-accent/50 hover:text-t2"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1.5 py-px font-sans text-[10px] font-medium sm:block">
          ⌘K
        </kbd>
      </button>

      {user && (
        <div ref={menuRef} className="relative ml-0.5">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="hig-press flex h-9 items-center gap-2 rounded-full pl-0.5 pr-1 hover:bg-muted sm:pr-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-bold text-accent">
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
              className="animate-scale-in absolute right-0 z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl"
            >
              <div className="px-2.5 pb-2.5 pt-1.5">
                <p className="truncate text-[15px] font-semibold text-t1">{user.name}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={`chip ${ROLE_CHIPS[user.role]}`}>
                    {ROLE_LABELS[user.role]}
                  </span>
                  <span className="truncate text-[12px] text-t3">{user.username ?? user.email}</span>
                </div>
              </div>

              <div className="my-1 h-px bg-line" />

              <Link
                href="/profile"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="hig-press flex h-11 items-center gap-3 rounded-xl px-2.5 text-[15px] text-t2 hover:bg-muted hover:text-t1"
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
                className="hig-press danger-action flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-[15px]"
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
