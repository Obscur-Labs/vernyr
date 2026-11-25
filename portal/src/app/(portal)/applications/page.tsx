'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CardSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import type { Application, AppStatus } from '@/types';

const STATUS_STYLE: Record<AppStatus, { badge: string; icon: string; label: string }> = {
  drafting:         { badge: 'bg-t3/10 text-t3 border-line',                        icon: '✏️',  label: 'Drafting'         },
  submitted:        { badge: 'bg-sky-500/10 text-sky-400 border-sky-500/25',         icon: '📨',  label: 'Submitted'        },
  offer_received:   { badge: 'bg-violet-500/10 text-violet-400 border-violet-500/25',icon: '📬',  label: 'Offer Received'   },
  conditional_offer:{ badge: 'bg-amber-500/10 text-amber-400 border-amber-500/25',   icon: '📋',  label: 'Conditional Offer'},
  accepted:         { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',icon: '🎉',label: 'Accepted'         },
  rejected:         { badge: 'bg-red-500/10 text-red-400 border-red-500/25',         icon: '❌',  label: 'Rejected'         },
  withdrawn:        { badge: 'bg-t3/10 text-t3 border-line',                         icon: '↩️',  label: 'Withdrawn'        },
  deferred:         { badge: 'bg-orange-500/10 text-orange-400 border-orange-500/25',icon: '⏳',  label: 'Deferred'         },
};

const COUNTRY_FLAG: Record<string, string> = {
  'UK': '🇬🇧', 'United Kingdom': '🇬🇧',
  'USA': '🇺🇸', 'United States': '🇺🇸',
  'Canada': '🇨🇦', 'Australia': '🇦🇺',
  'Germany': '🇩🇪', 'France': '🇫🇷',
  'Ireland': '🇮🇪', 'New Zealand': '🇳🇿',
  'Netherlands': '🇳🇱', 'Sweden': '🇸🇪',
};

export default function ApplicationsPage() {
  const { studentId } = useAuthStore();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    api.get<Application[]>(`/applications?studentId=${studentId}`)
      .then(res => setApplications(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [studentId]);

  const accepted  = applications.filter(a => a.status === 'accepted').length;
  const pending   = applications.filter(a => ['submitted','offer_received','conditional_offer'].includes(a.status)).length;
  const rejected  = applications.filter(a => a.status === 'rejected').length;

  return (
    <AppShell title="Applications">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-t1">University Applications</h1>
          <p className="text-t3 text-sm mt-0.5">{applications.length} application{applications.length !== 1 ? 's' : ''} total</p>
        </div>

        {/* Stats */}
        {!loading && applications.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <StatBadge label="Accepted" value={accepted} color="text-emerald-400" bg="bg-emerald-500/5 border-emerald-500/15" />
            <StatBadge label="In Progress" value={pending}  color="text-sky-400"     bg="bg-sky-500/5 border-sky-500/15"         />
            <StatBadge label="Rejected"  value={rejected} color="text-red-400"     bg="bg-red-500/5 border-red-500/15"         />
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={3} />)}</div>
        ) : applications.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🏫</div>
            <p className="text-t2 font-medium">No applications yet</p>
            <p className="text-t3 text-sm mt-1">Your counsellor will add universities once you're in the selection stage.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map(app => {
              const s = STATUS_STYLE[app.status];
              const flag = COUNTRY_FLAG[app.country] ?? '🌍';
              const isDeadlineSoon = app.deadline
                ? Math.ceil((new Date(app.deadline).getTime() - Date.now()) / 86_400_000) <= 7
                : false;

              return (
                <div key={app._id} className="bg-surface border border-line rounded-2xl p-5 animate-fade-in space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl flex-shrink-0">
                      {flag}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-t1 truncate">{app.university}</p>
                      <p className="text-xs text-t3">{app.country} · {app.course} · {app.level}</p>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium border flex items-center gap-1.5 flex-shrink-0 ${s.badge}`}>
                      <span>{s.icon}</span>
                      {s.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-t3">
                    <span>📅 Intake: {app.intake}</span>
                    {app.appliedDate && <span>📨 Applied: {new Date(app.appliedDate).toLocaleDateString()}</span>}
                    {app.deadline && (
                      <span className={isDeadlineSoon ? 'text-red-400 font-medium' : ''}>
                        ⏰ Deadline: {new Date(app.deadline).toLocaleDateString()}
                        {isDeadlineSoon && ' (soon!)'}
                      </span>
                    )}
                    {app.tuitionFee && (
                      <span>💰 {new Intl.NumberFormat('en-US', { style: 'currency', currency: app.currency || 'GBP', maximumFractionDigits: 0 }).format(app.tuitionFee)}/yr</span>
                    )}
                  </div>

                  {app.notes && (
                    <p className="text-xs text-t3 bg-muted rounded-lg px-3 py-2">{app.notes}</p>
                  )}

                  {app.offerDate && (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-3 py-1.5">
                      <span>🎓</span>
                      Offer received on {new Date(app.offerDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatBadge({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`rounded-2xl border px-3 py-3 ${bg}`}>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-t3 mt-0.5 font-semibold uppercase tracking-wider">{label}</p>
    </div>
  );
}
