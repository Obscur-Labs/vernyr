'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { LeadKanban } from '@/components/LeadKanban';
import { SkeletonTable } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import type { Lead, LeadStatus, User } from '@/types';

const STATUS_COLORS: Record<LeadStatus, string> = {
  new:                 'bg-indigo-500/15 text-indigo-400',
  contacted:           'bg-blue-500/15 text-blue-400',
  counselling:         'bg-violet-500/15 text-violet-400',
  interested:          'bg-amber-500/15 text-amber-400',
  application_started: 'bg-orange-500/15 text-orange-400',
  closed_won:          'bg-emerald-500/15 text-emerald-400',
  closed_lost:         'bg-red-500/15 text-red-400',
};

const LEAD_STATUSES: LeadStatus[] = ['new','contacted','counselling','interested','application_started','closed_won','closed_lost'];

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead>) => void;
  counsellors: User[];
}

function AddLeadDrawer({ open, onClose, onSave, counsellors }: DrawerProps) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', source: 'website',
    intendedCountry: '', intendedCourse: '', intakeYear: '',
    assignedTo: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        intakeYear: form.intakeYear ? Number(form.intakeYear) : undefined,
        assignedTo: form.assignedTo ? (form.assignedTo as unknown as User) : undefined,
      });
      setForm({ name:'',email:'',phone:'',source:'website',intendedCountry:'',intendedCourse:'',intakeYear:'',assignedTo:'',notes:'' });
    } finally {
      setSaving(false);
    }
  };

  // A sheet must dismiss on Escape — the drawer covers the page behind it, so
  // without it the only way out is finding the one small close target.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="animate-fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="animate-slide-in-right fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-t1">Add New Lead</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hig-press grid h-9 w-9 place-items-center rounded-lg text-t2 hover:bg-muted hover:text-t1"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {[
            { label: 'Full Name *', key: 'name', type: 'text', required: true },
            { label: 'Email *', key: 'email', type: 'email', required: true },
            { label: 'Phone *', key: 'phone', type: 'tel', required: true },
            { label: 'Intended Country', key: 'intendedCountry', type: 'text' },
            { label: 'Intended Course', key: 'intendedCourse', type: 'text' },
            { label: 'Intake Year', key: 'intakeYear', type: 'number' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-t2 mb-1">{f.label}</label>
              <input
                type={f.type}
                required={f.required}
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-t2 mb-1">Source</label>
            <select
              value={form.source}
              onChange={e => setForm(p => ({ ...p, source: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
            >
              {['website','referral','social_media','walk_in','phone','email','other'].map(s => (
                <option key={s} value={s}>{s.replace('_',' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-t2 mb-1">Assign To</label>
            <select
              value={form.assignedTo}
              onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
            >
              <option value="">Unassigned</option>
              {counsellors.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-t2 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-white font-semibold text-sm hover:bg-indigo-500 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Add Lead'}
          </button>
        </form>
      </div>
    </>
  );
}

export default function LeadsPage() {
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [counsellors, setCounsellors] = useState<User[]>([]);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState<'kanban' | 'table'>('kanban');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch]         = useState('');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | ''>('');
  const { toast }                   = useToast();

  useEffect(() => {
    Promise.all([
      api.get('/leads'),
      api.get('/users/counsellors'),
    ]).then(([lr, cr]) => {
      setLeads(lr.data);
      setCounsellors(cr.data);
    }).catch(() => toast('Failed to load leads', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    setLeads(prev => prev.map(l => l._id === leadId ? { ...l, status: newStatus } : l));
    try {
      const res = await api.put<Lead>(`/leads/${leadId}`, { status: newStatus });
      // Replace with server response so we get convertedStudentId if it was just set
      setLeads(prev => prev.map(l => l._id === leadId ? res.data : l));
      toast('Lead status updated', 'success');
    } catch {
      toast('Failed to update status', 'error');
    }
  };

  const handleAddLead = async (data: Partial<Lead>) => {
    try {
      const res = await api.post('/leads', data);
      setLeads(prev => [res.data, ...prev]);
      setDrawerOpen(false);
      toast('Lead added successfully', 'success');
    } catch {
      toast('Failed to add lead', 'error');
    }
  };

  const filtered = leads.filter(l => {
    const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !filterStatus || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="p-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-t1">Leads</h1>
          <p className="text-t2 text-sm mt-1">{leads.length} total leads in pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search leads…"
              className="w-56 pl-9 pr-3 py-2 rounded-xl bg-surface border border-line text-t1 text-sm placeholder-t3 focus:outline-none focus:border-accent"
            />
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-t3 absolute left-3 top-2.5">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
          </div>
          {/* Filter */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as LeadStatus | '')}
            className="px-3 py-2 rounded-xl bg-surface border border-line text-t1 text-sm focus:outline-none focus:border-accent"
          >
            <option value="">All Statuses</option>
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          {/* View toggle */}
          <div className="flex rounded-xl border border-line overflow-hidden">
            <button onClick={() => setView('kanban')} className={`px-3 py-2 text-sm font-medium transition-colors ${view === 'kanban' ? 'bg-accent text-white' : 'text-t2 hover:bg-muted'}`}>Kanban</button>
            <button onClick={() => setView('table')}  className={`px-3 py-2 text-sm font-medium transition-colors ${view === 'table'  ? 'bg-accent text-white' : 'text-t2 hover:bg-muted'}`}>Table</button>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
          >
            + Add Lead
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <SkeletonTable rows={6} />
      ) : view === 'kanban' ? (
        <LeadKanban leads={filtered} onStatusChange={handleStatusChange} />
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {['Name','Phone','Country','Course','Status','Assigned','Created'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr key={lead._id} className="border-b border-line last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-t1">{lead.name}</p>
                    <p className="text-xs text-t2">{lead.email}</p>
                    {lead.convertedStudentId && (
                      <Link
                        href={`/students/${lead.convertedStudentId}`}
                        className="inline-flex items-center gap-1 mt-1 text-xs bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full font-medium hover:bg-emerald-500/25 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        🎓 View Student
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-t2">{lead.phone}</td>
                  <td className="px-4 py-3 text-sm text-t2">{lead.intendedCountry || '—'}</td>
                  <td className="px-4 py-3 text-sm text-t2 max-w-[120px] truncate">{lead.intendedCourse || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium w-fit ${STATUS_COLORS[lead.status]}`}>
                        {lead.status.replace(/_/g,' ')}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-t2">
                    {lead.assignedTo ? (typeof lead.assignedTo === 'string' ? lead.assignedTo : lead.assignedTo.name) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-t3">{new Date(lead.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-t3 text-sm">No leads found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AddLeadDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSave={handleAddLead}
        counsellors={counsellors}
      />
    </div>
  );
}
