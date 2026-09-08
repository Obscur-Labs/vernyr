'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { SkeletonTable } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import type { Student, StudentStage, User } from '@/types';

const STAGE_COLORS: Record<StudentStage, string> = {
  inquiry:               'bg-slate-500/15 text-slate-400',
  counselling:           'bg-blue-500/15 text-blue-400',
  university_selection:  'bg-violet-500/15 text-violet-400',
  application_submitted: 'bg-indigo-500/15 text-indigo-400',
  offer_letter:          'bg-amber-500/15 text-amber-400',
  fee_payment:           'bg-orange-500/15 text-orange-400',
  cas_i20:               'bg-cyan-500/15 text-cyan-400',
  visa_filing:           'bg-blue-500/15 text-blue-400',
  visa_approved:         'bg-emerald-500/15 text-emerald-400',
  departure:             'bg-green-500/15 text-green-400',
};

const ALL_STAGES: StudentStage[] = [
  'inquiry','counselling','university_selection','application_submitted',
  'offer_letter','fee_payment','cas_i20','visa_filing','visa_approved','departure',
];

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Student>) => void;
  counsellors: User[];
  /** Counsellors only ever see their own caseload — the server assigns them. */
  ownsCaseload: boolean;
}

function AddStudentDrawer({ open, onClose, onSave, counsellors, ownsCaseload }: DrawerProps) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', nationality: '',
    counsellorId: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        personal: { name: form.name, email: form.email, phone: form.phone, nationality: form.nationality },
        // The server adds the creator when they are a counsellor.
        counsellors: form.counsellorId ? [{ _id: form.counsellorId } as User] : [],
        notes: form.notes,
        stage: 'inquiry',
        education: {},
        scores: {},
        passport: {},
        preferences: { countries: [], universities: [], courses: [] },
      });
      setForm({ name:'',email:'',phone:'',nationality:'',counsellorId:'',notes:'' });
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
      <div className="overlay-scrim animate-backdrop-in fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="overlay-panel animate-sheet-in fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col rounded-none border-y-0 border-r-0 sm:rounded-l-3xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-t1">Add New Student</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hig-press hig-touch grid h-9 w-9 place-items-center rounded-xl text-t2 hover:bg-muted hover:text-t1"
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
            { label: 'Nationality', key: 'nationality', type: 'text' },
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
            <label className="block text-xs font-medium text-t2 mb-1">Assign Counsellor</label>
            {ownsCaseload ? (
              <p className="w-full px-3 py-2 rounded-xl bg-muted border border-line text-t2 text-sm">
                Assigned to you — others can join the case later.
              </p>
            ) : (
              <select
                value={form.counsellorId}
                onChange={e => setForm(p => ({ ...p, counsellorId: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
              >
                <option value="">Unassigned</option>
                {counsellors.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            )}
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
            {saving ? 'Saving…' : 'Add Student'}
          </button>
        </form>
      </div>
    </>
  );
}

export default function StudentsPage() {
  const [students, setStudents]       = useState<Student[]>([]);
  const [counsellors, setCounsellors] = useState<User[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filterStage, setFilterStage] = useState<StudentStage | ''>('');
  const [scope, setScope]             = useState<'all' | 'mine'>('all');
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [busyId, setBusyId]           = useState('');
  const { toast }                     = useToast();
  const router                        = useRouter();
  const me                            = useAuthStore(s => s.user);
  const isCounsellor                  = me?.role === 'counsellor';

  const load = useCallback(async (which: 'all' | 'mine') => {
    const { data } = await api.get('/students', { params: which === 'mine' ? { counsellor: 'me' } : {} });
    setStudents(data);
  }, []);

  useEffect(() => {
    // Separate catches: the counsellor list failing must not blank the table.
    load(scope)
      .catch(() => toast('Failed to load students', 'error'))
      .finally(() => setLoading(false));
  }, [scope, load]);

  useEffect(() => {
    api.get('/users/counsellors').then(r => setCounsellors(r.data)).catch(() => {});
  }, []);

  const handleAddStudent = async (data: Partial<Student>) => {
    try {
      await api.post('/students', data);
      // Re-read rather than prepend, so the row shown is the row the list
      // actually returns — a record outside the caller's scope stays out.
      await load(scope);
      setDrawerOpen(false);
      toast('Student added successfully', 'success');
    } catch {
      toast('Failed to add student', 'error');
    }
  };

  /** Self-assign straight from the row — a counsellor picking up a case. */
  const toggleMe = async (s: Student) => {
    if (!me) return;
    const mine = (s.counsellors ?? []).some(c => c._id === me._id);
    setBusyId(s._id);
    try {
      const { data } = mine
        ? await api.delete(`/students/${s._id}/counsellors/${me._id}`)
        : await api.post(`/students/${s._id}/counsellors`, { counsellorId: me._id });
      setStudents(prev => prev.map(x => (x._id === s._id ? data : x)));
      toast(mine ? 'You left this case' : 'You joined this case', 'success');
      if (scope === 'mine') await load(scope);
    } catch {
      toast('Could not change the assignment', 'error');
    } finally {
      setBusyId('');
    }
  };

  const filtered = students.filter(s => {
    const name = s.personal?.name?.toLowerCase() || '';
    const email = s.personal?.email?.toLowerCase() || '';
    const matchSearch = !search || name.includes(search.toLowerCase()) || email.includes(search.toLowerCase());
    const matchStage  = !filterStage || s.stage === filterStage;
    return matchSearch && matchStage;
  });

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-t1">Students</h1>
          <p className="text-t2 text-sm mt-1">
            {students.length} {scope === 'mine' ? 'assigned to you' : 'students enrolled'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isCounsellor && (
            <div className="flex rounded-xl bg-surface border border-line p-0.5">
              {(['all', 'mine'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => { setLoading(true); setScope(v); }}
                  className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${
                    scope === v ? 'bg-accent text-white' : 'text-t2 hover:text-t1'
                  }`}
                >
                  {v === 'all' ? 'All students' : 'My students'}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search students…"
              className="w-56 pl-9 pr-3 py-2 rounded-xl bg-surface border border-line text-t1 text-sm placeholder-t3 focus:outline-none focus:border-accent"
            />
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-t3 absolute left-3 top-2.5">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
          </div>
          <select
            value={filterStage}
            onChange={e => setFilterStage(e.target.value as StudentStage | '')}
            className="px-3 py-2 rounded-xl bg-surface border border-line text-t1 text-sm focus:outline-none focus:border-accent"
          >
            <option value="">All Stages</option>
            {ALL_STAGES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <button
            onClick={() => setDrawerOpen(true)}
            className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
          >
            + Add Student
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={8} />
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {['Student','Email','Stage','Counsellors','Countries','Created'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
                {isCounsellor && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr
                  key={s._id}
                  onClick={() => router.push(`/students/${s._id}`)}
                  className="border-b border-line last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-accent/20 text-accent-ink text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {s.personal?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-t1">{s.personal?.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-t2">{s.personal?.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_COLORS[s.stage]}`}>
                      {s.stage.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {s.counsellors?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {s.counsellors.map(c => (
                          <span
                            key={c._id}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              c._id === me?._id ? 'bg-accent/15 text-accent-ink' : 'bg-muted text-t2'
                            }`}
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-sm text-t3">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-t2">{s.preferences?.countries?.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-t3">{new Date(s.createdAt).toLocaleDateString()}</td>
                  {isCounsellor && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={e => { e.stopPropagation(); toggleMe(s); }}
                        disabled={busyId === s._id}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                          (s.counsellors ?? []).some(c => c._id === me?._id)
                            ? 'bg-muted text-t2 hover:text-t1'
                            : 'bg-accent/15 text-accent-ink hover:bg-accent/25'
                        }`}
                      >
                        {busyId === s._id ? '…' : (s.counsellors ?? []).some(c => c._id === me?._id) ? 'Leave' : 'Assign me'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={isCounsellor ? 7 : 6} className="text-center py-12 text-t3 text-sm">
                  {scope === 'mine' ? 'No students assigned to you yet' : 'No students found'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AddStudentDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSave={handleAddStudent}
        counsellors={counsellors}
        ownsCaseload={isCounsellor}
      />
    </div>
  );
}
