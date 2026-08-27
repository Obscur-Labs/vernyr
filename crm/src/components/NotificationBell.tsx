'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellIcon, CloseIcon, notificationIcon } from '@/components/icons';
import type { Notification } from '@/types';

/**
 * The header bell and its attached panel.
 *
 * The panel is a preview, not the page: it shows the most recent handful and
 * hands off to /notifications for the rest. Acting on one from here mutates the
 * shell's list, so the badge and the page agree without a refetch.
 */

const EXIT_MS = 150;
const PREVIEW = 6;

/** "just now", "12m", "3h", "5d" — a feed needs no more precision than that. */
export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  if (mins < 10080) return `${Math.round(mins / 1440)}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type NotificationAction = (action: 'read' | 'unread' | 'delete', ids: string[]) => void;

export function NotificationBell({
  notifications, unreadCount, onAction,
}: {
  notifications: Notification[];
  unreadCount: number;
  onAction: NotificationAction;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ping, setPing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seenCount = useRef(unreadCount);

  const close = () => {
    setLeaving(true);
    setTimeout(() => { setOpen(false); setLeaving(false); }, EXIT_MS);
  };

  // A new arrival nudges the bell once, so something that lands while the user
  // is reading is noticed without a toast queue.
  useEffect(() => {
    if (unreadCount > seenCount.current) {
      setPing(true);
      const t = setTimeout(() => setPing(false), 700);
      return () => clearTimeout(t);
    }
    seenCount.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const preview = notifications.slice(0, PREVIEW);
  const unreadIds = notifications.filter((n) => !n.read).map((n) => n._id);

  const openNotification = (n: Notification) => {
    if (!n.read) onAction('read', [n._id]);
    close();
    if (n.link) router.push(n.link);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        title="Notifications"
        className={`hig-press relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          open ? 'bg-muted text-t1' : 'text-t2 hover:bg-muted hover:text-t1'
        }`}
      >
        <span style={ping ? { animation: 'pop-in 0.7s var(--ease-spring)' } : undefined}>
          <BellIcon className="h-[19px] w-[19px]" />
        </span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={`overlay-panel absolute right-0 z-50 mt-2 w-[min(92vw,24rem)] origin-top-right overflow-hidden rounded-2xl ${
            leaving ? 'animate-popover-out' : 'animate-popover-in'
          }`}
        >
          <header className="flex items-center gap-2 border-b border-line/60 px-4 py-3">
            <h2 className="text-[15px] font-semibold text-t1">Notifications</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                {unreadCount} new
              </span>
            )}
            {unreadIds.length > 0 && (
              <button
                type="button"
                onClick={() => onAction('read', unreadIds)}
                className="ml-auto text-[12px] font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </header>

          <div className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain">
            {preview.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <BellIcon className="mx-auto h-6 w-6 text-t3/70" />
                <p className="mt-2.5 text-[14px] font-medium text-t2">You&rsquo;re all caught up</p>
                <p className="mt-0.5 text-[12px] text-t3">New activity shows up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {preview.map((n) => (
                  <li key={n._id} className="group relative">
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                        n.read ? 'hover:bg-muted/60' : 'bg-accent/[0.06] hover:bg-accent/10'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                          n.read ? 'bg-muted text-t3' : 'bg-accent/15 text-accent'
                        }`}
                      >
                        {(() => { const Glyph = notificationIcon(n.type); return <Glyph className="h-[17px] w-[17px]" />; })()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={`truncate text-[13.5px] font-semibold ${n.read ? 'text-t2' : 'text-t1'}`}>
                            {n.title}
                          </span>
                          {!n.read && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-t3">
                            {timeAgo(n.createdAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-t3">
                          {n.body}
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onAction('delete', [n._id])}
                      aria-label={`Dismiss ${n.title}`}
                      title="Dismiss"
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-t3 opacity-0 transition-opacity hover:bg-muted hover:text-t1 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="border-t border-line/60 p-1.5">
            <Link
              href="/notifications"
              onClick={close}
              className="hig-press flex h-10 items-center justify-center rounded-xl text-[14px] font-semibold text-accent hover:bg-accent/10"
            >
              View all
              {notifications.length > PREVIEW && (
                <span className="ml-1.5 text-t3">({notifications.length})</span>
              )}
            </Link>
          </footer>
        </div>
      )}
    </div>
  );
}
