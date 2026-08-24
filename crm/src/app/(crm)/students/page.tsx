'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
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
}

function AddStudentDrawer({ open, onClose, onSave, counsellors }: DrawerProps) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', nationality: '',
    assignedCounsellor: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        personal: { name: form.name, email: form.email, phone: form.phone, nationality: form.nationality },
        assignedCounsellor: form.assignedCounsellor ? ({ _id: form.assignedCounsellor } as unknown as User) : undefined,
        notes: form.notes,
        stage: 'inquiry',
        education: {},
        scores: {},
        passport: {},
        preferences: { countries: [], universities: [], courses: [] },
      });
      setForm({ name:'',email:'',phone:'',nationality:'',assignedCounsellor:'',notes:'' });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-surface border-l border-line z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-t1">Add New Student</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-t2 hover:bg-muted">
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
            <select
              value={form.assignedCounsellor}
              onChange={e => setForm(p => ({ ...p, assignedCounsellor: e.target.value }))}
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
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const { toast }                     = useToast();
  const router                        = useRouter();

  useEffect(() => {
    Promise.all([api.get('/students'), api.get('/users/counsellors')])
      .then(([sr, cr]) => { setStudents(sr.data); setCounsellors(cr.data); })
      .catch(() => toast('Failed to load students', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleAddStudent = async (data: Partial<Student>) => {
    try {
      const res = await api.post('/students', data);
      setStudents(prev => [res.data, ...prev]);
      setDrawerOpen(false);
      toast('Student added successfully', 'success');
    } catch {
      toast('Failed to add student', 'error');
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
          <p className="text-t2 text-sm mt-1">{students.length} students enrolled</p>
        </div>
        <div className="flex items-center gap-3">
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
                {['Student','Email','Stage','Counsellor','Countries','Created'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
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
                      <div className="w-8 h-8 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
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
                  <td className="px-4 py-3 text-sm text-t2">
                    {s.assignedCounsellor ? (typeof s.assignedCounsellor === 'string' ? s.assignedCounsellor : s.assignedCounsellor.name) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-t2">{s.preferences?.countries?.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-t3">{new Date(s.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-t3 text-sm">No students found</td></tr>
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
      />
    </div>
  );
}
