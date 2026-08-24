'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { StageTracker } from '@/components/StageTracker';
import { CardSkeleton, NotificationSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import type { Student, Notification, Payment, Document } from '@/types';

export default function HomePage() {
  const { studentId, user } = useAuthStore();
  const [student, setStudent]           = useState<Student | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pendingDocs, setPendingDocs]   = useState<Document[]>([]);
  const [pendingPayments, setPendingPayments] = useState<Payment[]>([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (!studentId) return;
    Promise.all([
      api.get<Student>(`/students/${studentId}`),
      api.get<Notification[]>(`/notifications?limit=5`),
      api.get<Document[]>(`/documents?studentId=${studentId}&status=rejected,under_review`),
      api.get<Payment[]>(`/payments?studentId=${studentId}&status=pending,overdue`),
    ]).then(([sRes, nRes, dRes, pRes]) => {
      setStudent(sRes.data);
      setNotifications(nRes.data);
      setPendingDocs(dRes.data.filter(d => d.status === 'rejected' || d.status === 'under_review'));
      setPendingPayments(pRes.data.filter(p => p.status === 'pending' || p.status === 'overdue'));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [studentId]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <AppShell title="Home">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto space-y-6">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-t1">{greeting}, {firstName} 👋</h1>
          <p className="text-t3 text-sm mt-1">Here's your study abroad journey at a glance.</p>
        </div>

        {/* Journey progress card */}
        {loading ? (
          <CardSkeleton lines={3} />
        ) : student ? (
          <div className="bg-surface border border-line rounded-2xl p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-t1 text-base">My Journey</h2>
              <Link href="/progress" className="text-xs text-accent hover:underline font-medium">
                Full view →
              </Link>
            </div>
            <StageTracker currentStage={student.stage} compact />
          </div>
        ) : null}

        {/* Quick stats */}
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={1} />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 animate-fade-in">
            <QuickStat
              label="Documents"
              value={pendingDocs.filter(d => d.status === 'rejected').length}
              sub="need action"
              color="text-red-400"
              bg="bg-red-500/5 border-red-500/15"
              href="/documents"
            />
            <QuickStat
              label="Payments"
              value={pendingPayments.length}
              sub="pending"
              color="text-amber-400"
              bg="bg-amber-500/5 border-amber-500/15"
              href="/payments"
            />
            <QuickStat
              label="Unread"
              value={notifications.filter(n => !n.read).length}
              sub="notifications"
              color="text-sky-400"
              bg="bg-sky-500/5 border-sky-500/15"
              href="/notifications"
            />
          </div>
        )}

        {/* Assigned counsellor */}
        {!loading && student?.assignedCounsellor && (
          <div className="bg-surface border border-line rounded-2xl p-4 flex items-center gap-4 animate-fade-in">
            <div className="w-12 h-12 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center text-lg font-bold flex-shrink-0">
              {student.assignedCounsellor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-t3 uppercase tracking-wider font-medium mb-0.5">Your Counsellor</p>
              <p className="font-semibold text-t1 truncate">{student.assignedCounsellor.name}</p>
              <p className="text-xs text-t3 truncate">{student.assignedCounsellor.email || ''}</p>
            </div>
            <Link
              href="/chat"
              className="px-4 py-2 rounded-xl bg-accent/15 text-accent text-sm font-semibold border border-accent/20 hover:bg-accent/25 transition flex-shrink-0"
            >
              Chat
            </Link>
          </div>
        )}

        {/* Pending docs */}
        {!loading && pendingDocs.length > 0 && (
          <div className="bg-surface border border-line rounded-2xl p-4 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-t1 text-sm">Documents Needing Attention</h2>
              <Link href="/documents" className="text-xs text-accent hover:underline">View all</Link>
            </div>
            <div className="space-y-2">
              {pendingDocs.slice(0, 3).map(doc => (
                <div key={doc._id} className="flex items-center gap-3 py-1.5">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${doc.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <span className="text-sm text-t1 flex-1 truncate capitalize">
                    {doc.label ?? doc.type.replace(/_/g, ' ')}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                    doc.status === 'rejected'
                      ? 'bg-red-500/10 text-red-400 border-red-500/25'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  }`}>
                    {doc.status === 'rejected' ? 'Rejected' : 'In Review'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent notifications */}
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <NotificationSkeleton key={i} />)}</div>
        ) : notifications.length > 0 ? (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-t1 text-base">Recent Notifications</h2>
              <Link href="/notifications" className="text-xs text-accent hover:underline">See all</Link>
            </div>
            <div className="space-y-2">
              {notifications.slice(0, 4).map(n => (
                <div
                  key={n._id}
                  className={`flex items-start gap-3 p-4 rounded-2xl border transition ${
                    n.read ? 'bg-surface border-line' : 'bg-sky-500/5 border-sky-500/20'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center text-sm flex-shrink-0">
                    🔔
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-t1">{n.title}</p>
                    <p className="text-xs text-t3 mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-t3 mt-1">{new Date(n.createdAt).toLocaleDateString()}</p>
                  </div>
                  {!n.read && <div className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0 mt-1.5" />}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Empty state */}
        {!loading && !student && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🎒</div>
            <p className="text-t2 font-medium">Your profile is being set up</p>
            <p className="text-t3 text-sm mt-1">Your counsellor will link your student profile shortly.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function QuickStat({ label, value, sub, color, bg, href }: {
  label: string; value: number; sub: string;
  color: string; bg: string; href: string;
}) {
  return (
    <Link href={href} className={`rounded-2xl border px-3 py-3 ${bg} hover:opacity-90 transition`}>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-t3 mt-0.5 font-semibold uppercase tracking-wider leading-tight">{label}</p>
      <p className="text-xs text-t3 leading-tight">{sub}</p>
    </Link>
  );
}
