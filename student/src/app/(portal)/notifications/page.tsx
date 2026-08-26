'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { NotificationSkeleton } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import type { Notification } from '@/types';

const TYPE_ICON: Record<string, string> = {
  document:    '📄',
  application: '🏫',
  visa:        '🛂',
  payment:     '💳',
  stage:       '🎯',
  message:     '💬',
  general:     '🔔',
};

export default function NotificationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchNotifications = async () => {
    try {
      const res = await api.get<Notification[]>('/notifications?limit=100');
      setNotifications(res.data);
    } catch {
      toast('Failed to load notifications', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map(n => n._id)));
    }
  };

  const performAction = async (action: 'read' | 'unread' | 'delete', specificIds?: string[]) => {
    const ids = specificIds ?? Array.from(selectedIds);
    if (ids.length === 0) return;

    if (action === 'read') {
      setNotifications(prev => prev.map(n => ids.includes(n._id) ? { ...n, read: true } : n));
    } else if (action === 'unread') {
      setNotifications(prev => prev.map(n => ids.includes(n._id) ? { ...n, read: false } : n));
    } else if (action === 'delete') {
      setNotifications(prev => prev.filter(n => !ids.includes(n._id)));
      setSelectedIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
    }

    try {
      await api.post('/notifications/bulk', { action, ids });
      if (!specificIds) {
        setSelectedIds(new Set());
        toast(`Applied to ${ids.length} notification${ids.length > 1 ? 's' : ''}`);
      }
    } catch {
      toast('Action failed', 'error');
      fetchNotifications();
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <AppShell title="Notifications">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-t1">Notifications</h1>
            <p className="text-t3 text-sm mt-0.5">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => performAction('read', notifications.filter(n => !n.read).map(n => n._id))}
              className="text-sm font-medium text-accent hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Bulk Action Toolbar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-accent/10 border border-accent/20 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-accent">{selectedIds.size} selected</span>
            <div className="w-px h-4 bg-[var(--glass-border)] mx-1" />
            <button
              onClick={() => performAction('read')}
              className="flex items-center gap-1.5 text-xs font-medium text-t2 hover:text-accent transition-colors px-2 py-1 rounded-md hover:bg-accent/10"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd"/>
              </svg>
              Mark Read
            </button>
            <button
              onClick={() => performAction('unread')}
              className="flex items-center gap-1.5 text-xs font-medium text-t2 hover:text-accent transition-colors px-2 py-1 rounded-md hover:bg-accent/10"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
              </svg>
              Mark Unread
            </button>
            <button
              onClick={() => performAction('delete')}
              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-md hover:bg-red-500/10"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
              Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-t3 hover:text-t1 transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <NotificationSkeleton key={i} />)}</div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16 glass rounded-2xl border border-[var(--glass-border)]">
            <div className="text-5xl mb-4">🔔</div>
            <p className="text-t1 font-semibold text-lg">No notifications</p>
            <p className="text-t3 text-sm mt-1">Updates about your application will appear here.</p>
          </div>
        ) : (
          <div className="glass border border-[var(--glass-border)] rounded-2xl overflow-hidden">
            {/* Select all header */}
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--glass-border)] bg-muted">
              <input
                type="checkbox"
                checked={selectedIds.size === notifications.length && notifications.length > 0}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded border-[var(--glass-border)] text-accent bg-transparent cursor-pointer accent-[var(--color-accent)]"
              />
              <span className="text-xs font-semibold text-t3 uppercase tracking-wider">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${notifications.length} notifications`}
              </span>
            </div>

            <div className="divide-y divide-[var(--glass-border)]">
              {notifications.map(n => (
                <div
                  key={n._id}
                  className={`group relative flex items-start gap-4 px-4 py-4 transition-colors ${!n.read ? 'bg-accent/[0.06] hover:bg-accent/10' : 'hover:bg-muted'}`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedIds.has(n._id)}
                    onChange={() => handleSelect(n._id)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 rounded border-[var(--glass-border)] bg-transparent cursor-pointer mt-1 flex-shrink-0 accent-[var(--color-accent)]"
                  />

                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${!n.read ? 'bg-accent/15 text-accent' : 'bg-muted'}`}>
                    {TYPE_ICON[n.type] ?? '🔔'}
                  </div>

                  {/* Content */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer pr-24"
                    onClick={() => {
                      if (!n.read) performAction('read', [n._id]);
                      if (n.link) router.push(n.link);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${n.read ? 'text-t2' : 'text-t1'}`}>{n.title}</p>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0 shadow-[0_0_6px_rgba(56,189,248,0.6)]" />}
                    </div>
                    <p className="text-sm text-t3 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-t3 mt-1.5 font-medium">
                      {new Date(n.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>

                  {/* Hover action buttons */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity glass border border-[var(--glass-border)] rounded-lg p-1 shadow-lg">
                    {n.read ? (
                      <button
                        title="Mark as unread"
                        onClick={e => { e.stopPropagation(); performAction('unread', [n._id]); }}
                        className="p-1.5 text-t3 hover:text-accent rounded-md hover:bg-accent/10 transition-colors"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
                        </svg>
                      </button>
                    ) : (
                      <button
                        title="Mark as read"
                        onClick={e => { e.stopPropagation(); performAction('read', [n._id]); }}
                        className="p-1.5 text-t3 hover:text-accent rounded-md hover:bg-accent/10 transition-colors"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                        </svg>
                      </button>
                    )}
                    <div className="w-px h-4 bg-[var(--glass-border)]" />
                    <button
                      title="Delete"
                      onClick={e => { e.stopPropagation(); performAction('delete', [n._id]); }}
                      className="p-1.5 text-t3 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
