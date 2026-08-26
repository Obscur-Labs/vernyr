'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { SkeletonTable } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import { useAuthStore } from '@/stores/authStore';
import type { Application, AppStatus } from '@/types';

const ALL_COLUMNS: { id: AppStatus; label: string; dot: string; badge: string }[] = [
  { id: 'drafting',          label: 'Drafting',          dot: 'bg-slate-400',   badge: 'bg-slate-500/15 text-slate-400' },
  { id: 'submitted',         label: 'Submitted',         dot: 'bg-blue-500',    badge: 'bg-blue-500/15 text-blue-400' },
  { id: 'offer_received',    label: 'Offer Received',    dot: 'bg-amber-500',   badge: 'bg-amber-500/15 text-amber-400' },
  { id: 'conditional_offer', label: 'Conditional Offer', dot: 'bg-orange-500',  badge: 'bg-orange-500/15 text-orange-400' },
  { id: 'accepted',          label: 'Accepted',          dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-400' },
  { id: 'deferred',          label: 'Deferred',          dot: 'bg-violet-500',  badge: 'bg-violet-500/15 text-violet-400' },
  { id: 'rejected',          label: 'Rejected',          dot: 'bg-red-500',     badge: 'bg-red-500/15 text-red-400' },
];

// University reps only need decision-stage columns
const UNI_COLUMNS: AppStatus[] = ['submitted','offer_received','conditional_offer','accepted','deferred','rejected'];

const STATUS_COLORS: Record<AppStatus, string> = {
  drafting:         'bg-slate-500/15 text-slate-400',
  submitted:        'bg-blue-500/15 text-blue-400',
  offer_received:   'bg-amber-500/15 text-amber-400',
  conditional_offer:'bg-orange-500/15 text-orange-400',
  accepted:         'bg-emerald-500/15 text-emerald-400',
  rejected:         'bg-red-500/15 text-red-400',
  withdrawn:        'bg-slate-500/15 text-slate-400',
  deferred:         'bg-violet-500/15 text-violet-400',
};

const COUNTRY_FLAGS: Record<string, string> = {
  'UK': '🇬🇧','United Kingdom': '🇬🇧','USA': '🇺🇸','United States': '🇺🇸',
  'Canada': '🇨🇦','Australia': '🇦🇺','Germany': '🇩🇪','France': '🇫🇷',
  'Ireland': '🇮🇪','New Zealand': '🇳🇿','Singapore': '🇸🇬',
};

export default function ApplicationsPage() {
  const { user }                        = useAuthStore();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading]           = useState(true);
  const [view, setView]                 = useState<'kanban' | 'table'>('kanban');
  const [dragId, setDragId]             = useState<string | null>(null);
  const [overCol, setOverCol]           = useState<AppStatus | null>(null);
  const { toast }                       = useToast();

  const isUniUser = user?.role === 'university';
  const COLUMNS = isUniUser
    ? ALL_COLUMNS.filter(c => UNI_COLUMNS.includes(c.id))
    : ALL_COLUMNS;

  useEffect(() => {
    api.get('/applications')
      .then(r => setApplications(r.data))
      .catch(() => toast('Failed to load applications', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleStatusChange = async (appId: string, newStatus: AppStatus) => {
    setApplications(prev => prev.map(a => a._id === appId ? { ...a, status: newStatus } : a));
    try {
      await api.put(`/applications/${appId}`, { status: newStatus });
      toast('Status updated', 'success');
    } catch {
      toast('Failed to update status', 'error');
    }
  };

  const handleDrop = (e: React.DragEvent, colId: AppStatus) => {
    e.preventDefault();
    if (dragId) handleStatusChange(dragId, colId);
    setDragId(null);
    setOverCol(null);
  };

  const getStudentName = (app: Application) => {
    const s = app.studentId as unknown as { personal?: { name: string } };
    return s?.personal?.name || 'Unknown';
  };

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-t1">Applications</h1>
          <p className="text-t2 text-sm mt-1">{applications.length} applications tracked</p>
        </div>
        <div className="flex rounded-xl border border-line overflow-hidden">
          <button onClick={() => setView('kanban')} className={`px-3 py-2 text-sm font-medium transition-colors ${view === 'kanban' ? 'bg-accent text-white' : 'text-t2 hover:bg-muted'}`}>Kanban</button>
          <button onClick={() => setView('table')}  className={`px-3 py-2 text-sm font-medium transition-colors ${view === 'table'  ? 'bg-accent text-white' : 'text-t2 hover:bg-muted'}`}>Table</button>
        </div>
      </div>

      {isUniUser && user && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-teal-500/5 border border-teal-500/20 rounded-xl">
          <span className="text-teal-400 text-lg">🏛️</span>
          <div>
            <p className="text-sm font-semibold text-teal-400">Partner Portal — {(user as unknown as { universityName?: string }).universityName ?? 'Your University'}</p>
            <p className="text-xs text-t3">You can view and update statuses for applications addressed to your institution.</p>
          </div>
        </div>
      )}

      {loading ? <SkeletonTable rows={6} /> : view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map(col => {
            const colApps = applications.filter(a => a.status === col.id);
            const isOver  = overCol === col.id;
            return (
              <div
                key={col.id}
                className={`flex-shrink-0 w-64 bg-surface border border-line rounded-2xl flex flex-col transition-colors ${isOver ? 'border-accent/50 bg-accent/5' : ''}`}
                onDragOver={e => { e.preventDefault(); setOverCol(col.id); }}
                onDragLeave={() => setOverCol(null)}
                onDrop={e => handleDrop(e, col.id)}
              >
                <div className="px-4 py-3 border-b border-line rounded-t-2xl">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-t1">
                      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${col.dot}`} />
                      <span className="truncate">{col.label}</span>
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${col.badge}`}>{colApps.length}</span>
                  </div>
                </div>
                <div className="flex-1 p-3 space-y-3 overflow-y-auto min-h-32">
                  {colApps.map(app => (
                    <div
                      key={app._id}
                      draggable
                      onDragStart={e => { setDragId(app._id); e.dataTransfer.effectAllowed = 'move'; }}
                      className={`bg-card border border-line rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-accent/40 transition-all ${dragId === app._id ? 'opacity-40' : ''}`}
                    >
                      <p className="text-sm font-semibold text-t1 mb-1">{app.university}</p>
                      <p className="text-xs text-t2 mb-1 truncate">{app.course}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-t3">{COUNTRY_FLAGS[app.country] || ''} {app.country}</span>
                        <span className="text-xs text-t3">{app.intake}</span>
                      </div>
                      <p className="text-xs text-t3 truncate">Student: {getStudentName(app)}</p>
                    </div>
                  ))}
                  {colApps.length === 0 && (
                    <div className={`h-16 flex items-center justify-center border-2 border-dashed rounded-xl text-xs text-t3 ${isOver ? 'border-accent/40 text-accent' : 'border-line'}`}>
                      {isOver ? 'Drop here' : 'Empty'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {['Student','University','Course','Country','Intake','Status','Fee'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map(app => (
                <tr key={app._id} className="border-b border-line last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-t1">{getStudentName(app)}</td>
                  <td className="px-4 py-3 text-sm text-t1">{app.university}</td>
                  <td className="px-4 py-3 text-sm text-t2 max-w-[120px] truncate">{app.course}</td>
                  <td className="px-4 py-3 text-sm text-t2">{COUNTRY_FLAGS[app.country] || ''} {app.country}</td>
                  <td className="px-4 py-3 text-sm text-t2">{app.intake}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[app.status]}`}>
                      {app.status.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-t2">
                    {app.tuitionFee ? `${app.currency || ''} ${app.tuitionFee.toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-t3 text-sm">No applications found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
