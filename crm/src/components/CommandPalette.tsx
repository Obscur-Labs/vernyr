'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { navFor, type NavItem } from '@/lib/navigation';

/**
 * ⌘K / Ctrl+K jump-to-page. The list comes from the same registry the sidebar
 * uses and is filtered by role, so search can never offer a page the caller
 * would just be bounced out of.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const available = useMemo(() => navFor(user?.role), [user?.role]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    // Label matches first — typing "doc" should reach Documents before a page
    // that merely mentions documents in its keywords.
    const scored = available
      .map((item) => {
        const label = item.label.toLowerCase();
        if (label.startsWith(q)) return { item, score: 0 };
        if (label.includes(q)) return { item, score: 1 };
        if (item.keywords?.includes(q)) return { item, score: 2 };
        return null;
      })
      .filter((x): x is { item: NavItem; score: number } => x !== null)
      .sort((a, b) => a.score - b.score);
    return scored.map((s) => s.item);
  }, [query, available]);

  // Reset each time it opens, so it never reopens mid-search
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint, or the dialog steals it back
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  const go = useCallback((item: NavItem) => {
    onClose();
    router.push(item.href);
  }, [onClose, router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[active];
      if (item) go(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Keep the highlighted row in view when arrowing past the fold
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="animate-scale-in w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-t3">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="w-full bg-transparent py-4 text-[15px] text-t1 placeholder:text-t3 focus:outline-none focus-visible:shadow-none"
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-t3 sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-t2">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((item, i) => (
              <button
                key={item.href}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={`hig-press flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] ${
                  i === active ? 'bg-accent text-white' : 'text-t2'
                }`}
              >
                <span className={i === active ? 'text-white' : 'text-t3'}>{item.icon}</span>
                <span className="flex-1 font-medium">{item.label}</span>
                <span
                  className={`text-[12px] ${i === active ? 'text-white/75' : 'text-t3'}`}
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {item.href}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-t3">
          <span><Key>&#8593;</Key><Key>&#8595;</Key> navigate</span>
          <span><Key>&#8629;</Key> open</span>
          <span className="ml-auto"><Key>esc</Key> close</span>
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1 inline-block min-w-[18px] rounded border border-line px-1 text-center font-sans text-[10px] leading-4 text-t3">
      {children}
    </kbd>
  );
}

/** Owns the ⌘K / Ctrl+K binding so the shell only has to render the palette. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
