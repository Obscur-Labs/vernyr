'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, SkeletonList } from '@/components/ui';
import { BellIcon, CheckIcon, TrashIcon, notificationIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';

/**
 * The whole feed — where the header's panel hands off on "View all".
 *
 * Everything here is bulk-first: selection drives one toolbar, and the same
 * three actions reach the server through one endpoint whether they came from a
 * row's hover control or a hundred checked boxes.
 */

type BulkAction = 'read' | 'unread' | 'delete';

export default function CRMNotificationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get<Notification[]>('/notifications?limit=100');
      setNotifications(res.data);
    } catch {
      toast('Failed to load notifications', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === notifications.length ? new Set() : new Set(notifications.map((n) => n._id)));

  /** Optimistic, because the server only ever agrees — and reverts if it does not. */
  const perform = async (action: BulkAction, specificIds?: string[]) => {
    const ids = specificIds ?? [...selected];
    if (!ids.length) return;

    setNotifications((prev) => action === 'delete'
      ? prev.filter((n) => !ids.includes(n._id))
      : prev.map((n) => (ids.includes(n._id) ? { ...n, read: action === 'read' } : n)));

    if (action === 'delete') {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }

    try {
      await api.post('/notifications/bulk', { action, ids });
      if (!specificIds) {
        setSelected(new Set());
        toast(`Applied to ${ids.length} notification${ids.length > 1 ? 's' : ''}`);
      }
    } catch {
      toast('Action failed', 'error');
      fetchNotifications();
    }
  };

  const unread = notifications.filter((n) => !n.read);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Notifications"
        subtitle={unread.length > 0 ? `${unread.length} unread` : 'All caught up'}
        actions={unread.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-accent"
            onClick={() => perform('read', unread.map((n) => n._id))}
          >
            Mark all as read
          </Button>
        )}
      />

      {selected.size > 0 && (
        <Card padding="none" className="flex items-center gap-2 border-accent/20 bg-accent/10 px-4 py-2.5">
          <span className="text-sm font-semibold text-accent">{selected.size} selected</span>
          <span aria-hidden className="mx-1 h-4 w-px bg-line" />
          <Button variant="ghost" size="sm" onClick={() => perform('read')}>
            <CheckIcon className="h-3.5 w-3.5" />Mark read
          </Button>
          <Button variant="ghost" size="sm" onClick={() => perform('unread')}>
            <BellIcon className="h-3.5 w-3.5" />Mark unread
          </Button>
          <Button variant="danger" size="sm" onClick={() => perform('delete')}>
            <TrashIcon className="h-3.5 w-3.5" />Delete
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-t3" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </Card>
      )}

      {loading ? (
        <SkeletonList rows={5} height={80} />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<BellIcon className="h-8 w-8" />}
          title="No notifications"
          description="Activity on your students, applications and payments lands here."
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center gap-4 border-b border-line bg-muted/50 px-4 py-2.5">
            <input
              type="checkbox"
              checked={selected.size === notifications.length && notifications.length > 0}
              onChange={toggleAll}
              aria-label="Select every notification"
              className="h-4 w-4 cursor-pointer rounded border-line bg-transparent accent-[var(--color-accent)]"
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-t3">
              {selected.size > 0 ? `${selected.size} selected` : `${notifications.length} notifications`}
            </span>
          </div>

          <ul className="divide-y divide-line">
            {notifications.map((n) => {
              const Glyph = notificationIcon(n.type);
              return (
                <li
                  key={n._id}
                  className={cn(
                    'group relative flex items-start gap-4 px-4 py-4 transition-colors',
                    n.read ? 'hover:bg-muted/60' : 'bg-accent/5 hover:bg-accent/10',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(n._id)}
                    onChange={() => toggle(n._id)}
                    aria-label={`Select ${n.title}`}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-line bg-transparent accent-[var(--color-accent)]"
                  />

                  <span
                    aria-hidden
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                      n.read ? 'bg-muted text-t3' : 'bg-accent/15 text-accent',
                    )}
                  >
                    <Glyph className="h-[18px] w-[18px]" />
                  </span>

                  <button
                    type="button"
                    className="min-w-0 flex-1 pr-24 text-left"
                    onClick={() => {
                      if (!n.read) perform('read', [n._id]);
                      if (n.link) router.push(n.link);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('text-sm font-semibold', n.read ? 'text-t2' : 'text-t1')}>
                        {n.title}
                      </span>
                      {!n.read && <Badge tone="accent">New</Badge>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-t3">{n.body}</span>
                    <span className="mt-1.5 block text-xs font-medium text-t3">{timeAgo(n.createdAt)}</span>
                  </button>

                  <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-lg border border-line bg-surface p-1 opacity-0 shadow-md transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {n.read ? (
                      <Button variant="ghost" size="icon" aria-label="Mark as unread" title="Mark as unread"
                        onClick={() => perform('unread', [n._id])}>
                        <BellIcon className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" aria-label="Mark as read" title="Mark as read"
                        onClick={() => perform('read', [n._id])}>
                        <CheckIcon className="h-4 w-4" />
                      </Button>
                    )}
                    <span aria-hidden className="h-4 w-px bg-line" />
                    <Button variant="danger" size="icon" aria-label="Delete" title="Delete"
                      onClick={() => perform('delete', [n._id])}>
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
