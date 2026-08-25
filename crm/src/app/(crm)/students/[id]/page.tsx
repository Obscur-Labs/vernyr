'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { suggestUsername } from '@/lib/credentials';
import { useBreadcrumbTail } from '@/context/BreadcrumbContext';
import { fileHref } from '@/lib/media';
import { apiUrl } from '@/lib/config';
import { StageTracker } from '@/components/StageTracker';
import { useToast } from '@/context/ToastContext';
import { useAuthStore } from '@/stores/authStore';
import type { Student, Application, Document as Doc, Visa, Payment, AppStatus, StudentStage, DocStatus } from '@/types';

const APP_STATUS_COLORS: Record<AppStatus, string> = {
  drafting:         'bg-slate-500/15 text-slate-400',
  submitted:        'bg-blue-500/15 text-blue-400',
  offer_received:   'bg-amber-500/15 text-amber-400',
  conditional_offer:'bg-orange-500/15 text-orange-400',
  accepted:         'bg-emerald-500/15 text-emerald-400',
  rejected:         'bg-red-500/15 text-red-400',
  withdrawn:        'bg-slate-500/15 text-slate-400',
  deferred:         'bg-violet-500/15 text-violet-400',
};

const DOC_STATUS_COLORS: Record<DocStatus, string> = {
  uploaded:      'bg-blue-500/15 text-blue-400',
  under_review:  'bg-amber-500/15 text-amber-400',
  approved:      'bg-emerald-500/15 text-emerald-400',
  rejected:      'bg-red-500/15 text-red-400',
};

const PAYMENT_STATUS_COLORS = {
  pending:  'bg-amber-500/15 text-amber-400',
  paid:     'bg-emerald-500/15 text-emerald-400',
  overdue:  'bg-red-500/15 text-red-400',
  refunded: 'bg-blue-500/15 text-blue-400',
  waived:   'bg-slate-500/15 text-slate-400',
};

const COUNTRY_FLAGS: Record<string, string> = {
  'UK': '🇬🇧', 'United Kingdom': '🇬🇧', 'USA': '🇺🇸', 'United States': '🇺🇸',
  'Canada': '🇨🇦', 'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷',
  'Ireland': '🇮🇪', 'New Zealand': '🇳🇿', 'Singapore': '🇸🇬', 'UAE': '🇦🇪',
};

const TABS = ['Profile', 'Applications', 'Documents', 'Visa', 'Payments', 'Notes'];

export default function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [student, setStudent]           = useState<Student | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [documents, setDocuments]       = useState<Doc[]>([]);
  const [visa, setVisa]                 = useState<Visa | null>(null);
  const [payments, setPayments]         = useState<Payment[]>([]);
  const [activeTab, setActiveTab]       = useState(0);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);

  // Replaces the record id in the breadcrumb once we know whose file this is
  useBreadcrumbTail(student?.personal?.name);

  // Forms
  const [editProfile, setEditProfile]   = useState(false);
  const [profileForm, setProfileForm]   = useState<Partial<Student>>({});
  const [showAddApp, setShowAddApp]     = useState(false);
  const [appForm, setAppForm]           = useState({ university:'', course:'', country:'', intake:'', level:'postgraduate', tuitionFee:'', currency:'GBP' });
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm]   = useState({ type:'service_fee', description:'', amount:'', currency:'USD', dueDate:'' });
  const [notes, setNotes]               = useState('');
  const [savingNotes, setSavingNotes]   = useState(false);
  const [reviewDoc, setReviewDoc]       = useState<Doc | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [zipBusy, setZipBusy]           = useState(false);

  async function handleDownloadZip() {
    if (!student) return;
    setZipBusy(true);
    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`${apiUrl}/documents/download-all/${student._id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) { toast('No documents uploaded yet', 'error'); return; }
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${student.personal.name.replace(/\s+/g, '_')}_documents.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast('Failed to download documents', 'error');
    } finally {
      setZipBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([
      api.get(`/students/${id}`),
      api.get(`/applications?studentId=${id}`),
      api.get(`/documents?studentId=${id}`),
      api.get(`/visas?studentId=${id}`),
      api.get(`/payments?studentId=${id}`),
    ]).then(([sr, ar, dr, vr, pr]) => {
      setStudent(sr.data);
      setNotes(sr.data.notes || '');
      setProfileForm(sr.data);
      setApplications(ar.data);
      setDocuments(dr.data);
      setVisa(vr.data[0] || null);
      setPayments(pr.data);
      // Initialise counsellor picker with current assignment
      const ac = sr.data.assignedCounsellor;
      const currentId = ac ? (typeof ac === 'object' ? (ac as { _id: string })._id : ac as string) : '';
      setSelectedCounsellor(currentId);
    }).catch(() => toast('Failed to load student data', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStageChange = async (stage: StudentStage) => {
    if (!student) return;
    setStudent({ ...student, stage });
    try {
      await api.put(`/students/${id}`, { stage });
      toast('Stage updated', 'success');
    } catch {
      toast('Failed to update stage', 'error');
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/students/${id}`, profileForm);
      setStudent(res.data);
      setEditProfile(false);
      toast('Profile saved', 'success');
    } catch {
      toast('Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/applications', { ...appForm, studentId: id, tuitionFee: appForm.tuitionFee ? Number(appForm.tuitionFee) : undefined });
      setApplications(prev => [res.data, ...prev]);
      setShowAddApp(false);
      setAppForm({ university:'',course:'',country:'',intake:'',level:'postgraduate',tuitionFee:'',currency:'GBP' });
      toast('Application added', 'success');
    } catch {
      toast('Failed to add application', 'error');
    }
  };

  const handleUpdateAppStatus = async (appId: string, status: AppStatus) => {
    try {
      const res = await api.put(`/applications/${appId}`, { status });
      setApplications(prev => prev.map(a => a._id === appId ? res.data : a));
      toast('Status updated', 'success');
    } catch {
      toast('Failed to update status', 'error');
    }
  };

  const handleDocReview = async (docId: string, status: DocStatus) => {
    try {
      await api.put(`/documents/${docId}/status`, { status, rejectionReason: rejectReason });
      setDocuments(prev => prev.map(d => d._id === docId ? { ...d, status } : d));
      setReviewDoc(null);
      setRejectReason('');
      toast(`Document ${status}`, 'success');
    } catch {
      toast('Failed to update document', 'error');
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/payments', { ...paymentForm, studentId: id, amount: Number(paymentForm.amount) });
      setPayments(prev => [res.data, ...prev]);
      setShowAddPayment(false);
      setPaymentForm({ type:'service_fee',description:'',amount:'',currency:'USD',dueDate:'' });
      toast('Payment added', 'success');
    } catch {
      toast('Failed to add payment', 'error');
    }
  };

  const handleMarkPaid = async (paymentId: string) => {
    try {
      const res = await api.put(`/payments/${paymentId}`, { status: 'paid', paidDate: new Date().toISOString() });
      setPayments(prev => prev.map(p => p._id === paymentId ? res.data : p));
      toast('Marked as paid', 'success');
    } catch {
      toast('Failed to update payment', 'error');
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.put(`/students/${id}`, { notes });
      toast('Notes saved', 'success');
    } catch {
      toast('Failed to save notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const canReviewDocs   = user && ['admin','counsellor'].includes(user.role);
  const canAssignCounsellor = user?.role === 'admin';

  // Assign counsellor
  const [counsellors, setCounsellors]           = useState<{ _id: string; name: string }[]>([]);
  const [assigningCounsellor, setAssigningCounsellor] = useState(false);
  const [selectedCounsellor, setSelectedCounsellor]   = useState('');

  useEffect(() => {
    if (canAssignCounsellor) {
      api.get('/users/counsellors').then(r => setCounsellors(r.data)).catch(() => {});
    }
  }, [canAssignCounsellor]);

  const handleAssignCounsellor = async () => {
    setAssigningCounsellor(true);
    try {
      const res = await api.patch(`/students/${id}/assign-counsellor`, { counsellorId: selectedCounsellor || null });
      setStudent(res.data);
      toast(selectedCounsellor ? 'Counsellor assigned' : 'Counsellor removed', 'success');
    } catch {
      toast('Failed to assign counsellor', 'error');
    } finally {
      setAssigningCounsellor(false);
    }
  };

  // Portal account creation
  const [showPortalForm, setShowPortalForm] = useState(false);
  const [portalUsername, setPortalUsername] = useState('');
  const [portalPassword, setPortalPassword] = useState('');
  const [creatingPortal, setCreatingPortal] = useState(false);
  const [portalCreated, setPortalCreated]   = useState(false);

  const handleCreatePortalAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingPortal(true);
    try {
      await api.post('/users/student-account', {
        studentId: id,
        name: student?.personal?.name,
        username: portalUsername.trim().toLowerCase(),
        email: student?.personal?.email,
        password: portalPassword,
      });
      setPortalCreated(true);
      setShowPortalForm(false);
      toast('Portal account created!', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to create portal account';
      toast(msg, 'error');
    } finally {
      setCreatingPortal(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="grid grid-cols-3 gap-6">
            <div className="h-96 bg-card border border-line rounded-2xl" />
            <div className="col-span-2 h-96 bg-card border border-line rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!student) {
    return <div className="p-6 text-center text-t2">Student not found.</div>;
  }

  return (
    <div className="p-6 animate-fade-in">
      {/* Back button */}
      <button onClick={() => history.back()} className="flex items-center gap-2 text-t2 hover:text-t1 text-sm mb-5 transition-colors">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
        </svg>
        Back to Students
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* LEFT: Stage tracker sidebar */}
        <div className="xl:col-span-1 space-y-5">
          {/* Student card */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-16 h-16 rounded-full bg-accent/20 text-accent text-xl font-bold flex items-center justify-center mb-3">
                {student.personal?.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
              </div>
              <h2 className="text-base font-bold text-t1">{student.personal?.name}</h2>
              <p className="text-xs text-t2 mt-0.5">{student.personal?.email || '—'}</p>
              <p className="text-xs text-t2">{student.personal?.phone}</p>
              {student.assignedCounsellor && (
                <p className="text-xs text-t3 mt-2">
                  Counsellor: {typeof student.assignedCounsellor === 'string' ? student.assignedCounsellor : student.assignedCounsellor.name}
                </p>
              )}
              {/* Chat button — needs a portal account; admins have no chat access */}
              {student.userId && user && user.role !== 'admin' && (
                <Link
                  href={`/chat?with=${student.userId}`}
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent/15 text-accent text-xs font-semibold hover:bg-accent/25 transition-colors"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd"/>
                  </svg>
                  Chat
                </Link>
              )}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-2 mb-5 border-t border-b border-line py-3">
              {[
                { label: 'Docs', value: documents.length },
                { label: 'Apps', value: applications.length },
                { label: 'Payments', value: payments.length },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <p className="text-lg font-bold text-t1">{stat.value}</p>
                  <p className="text-xs text-t3">{stat.label}</p>
                </div>
              ))}
            </div>

            <StageTracker currentStage={student.stage} onChange={handleStageChange} />
          </div>
        </div>

        {/* MAIN: Tabs */}
        <div className="xl:col-span-2 space-y-5">
          {/* Tab nav */}
          <div className="flex gap-1 bg-surface border border-line rounded-xl p-1">
            {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === i ? 'bg-accent text-white' : 'text-t2 hover:text-t1'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab 0: Profile */}
          {activeTab === 0 && (
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-t1">Personal Information</h3>
                {!editProfile ? (
                  <button onClick={() => setEditProfile(true)} className="text-xs text-accent hover:underline">Edit</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setEditProfile(false)} className="text-xs text-t2 hover:text-t1">Cancel</button>
                    <button onClick={handleSaveProfile} disabled={saving} className="text-xs text-accent hover:underline disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Date of Birth', key: 'dob', path: 'personal' },
                  { label: 'Gender', key: 'gender', path: 'personal' },
                  { label: 'Nationality', key: 'nationality', path: 'personal' },
                  { label: 'Address', key: 'address', path: 'personal' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-t3 mb-1">{f.label}</label>
                    {editProfile ? (
                      <input
                        value={(profileForm.personal as Record<string,string>)?.[f.key] || ''}
                        onChange={e => setProfileForm(p => ({ ...p, personal: { ...p.personal!, [f.key]: e.target.value } }))}
                        className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                      />
                    ) : (
                      <p className="text-sm text-t1">{(student.personal as Record<string,string>)?.[f.key] || '—'}</p>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-t2 uppercase tracking-wider mb-3">Education</h4>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: '10th Board', key: 'board10' }, { label: '10th %', key: 'percentage10' },
                    { label: '12th Board', key: 'board12' }, { label: '12th %', key: 'percentage12' },
                    { label: 'Graduation College', key: 'graduationCollege' }, { label: 'Graduation Score', key: 'graduationScore' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-t3 mb-1">{f.label}</label>
                      {editProfile ? (
                        <input
                          value={(profileForm.education as Record<string,string | number>)?.[f.key] || ''}
                          onChange={e => setProfileForm(p => ({ ...p, education: { ...p.education, [f.key]: e.target.value } }))}
                          className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                        />
                      ) : (
                        <p className="text-sm text-t1">{(student.education as Record<string,string | number>)?.[f.key] || '—'}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-t2 uppercase tracking-wider mb-3">Test Scores</h4>
                <div className="grid grid-cols-5 gap-3">
                  {(['ielts','toefl','gre','gmat','sat'] as const).map(score => (
                    <div key={score} className="bg-card border border-line rounded-xl p-3 text-center">
                      <p className="text-xs text-t3 uppercase mb-1">{score}</p>
                      {editProfile ? (
                        <input
                          type="number"
                          value={profileForm.scores?.[score] || ''}
                          onChange={e => setProfileForm(p => ({ ...p, scores: { ...p.scores, [score]: Number(e.target.value) } }))}
                          className="w-full text-center px-2 py-1 rounded-lg bg-muted border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                        />
                      ) : (
                        <p className="text-base font-bold text-t1">{student.scores?.[score] || '—'}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-t2 uppercase tracking-wider mb-3">Preferences</h4>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Countries', key: 'countries' },
                    { label: 'Universities', key: 'universities' },
                    { label: 'Courses', key: 'courses' },
                    { label: 'Intake', key: 'intake' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-t3 mb-1">{f.label}</label>
                      {editProfile ? (
                        <input
                          value={
                            f.key === 'intake'
                              ? profileForm.preferences?.intake || ''
                              : (profileForm.preferences?.[f.key as 'countries' | 'universities' | 'courses'] || []).join(', ')
                          }
                          onChange={e => setProfileForm(p => ({
                            ...p,
                            preferences: {
                              ...p.preferences!,
                              [f.key]: f.key === 'intake' ? e.target.value : e.target.value.split(',').map(s => s.trim()),
                            }
                          }))}
                          className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                          placeholder={f.key !== 'intake' ? 'Comma separated' : ''}
                        />
                      ) : (
                        <p className="text-sm text-t1">
                          {f.key === 'intake'
                            ? student.preferences?.intake || '—'
                            : student.preferences?.[f.key as 'countries'|'universities'|'courses']?.join(', ') || '—'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 1: Applications */}
          {activeTab === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-t1">University Applications ({applications.length})</h3>
                <button
                  onClick={() => setShowAddApp(!showAddApp)}
                  className="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-indigo-500 transition-colors"
                >
                  + Add Application
                </button>
              </div>

              {showAddApp && (
                <form onSubmit={handleAddApplication} className="bg-surface border border-line rounded-2xl p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'University *', key: 'university' },
                      { label: 'Course *', key: 'course' },
                      { label: 'Country *', key: 'country' },
                      { label: 'Intake *', key: 'intake' },
                      { label: 'Tuition Fee', key: 'tuitionFee' },
                      { label: 'Currency', key: 'currency' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="block text-xs text-t3 mb-1">{f.label}</label>
                        <input
                          value={(appForm as Record<string,string>)[f.key]}
                          onChange={e => setAppForm(p => ({ ...p, [f.key]: e.target.value }))}
                          required={f.label.endsWith('*')}
                          className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs text-t3 mb-1">Level</label>
                    <select value={appForm.level} onChange={e => setAppForm(p => ({ ...p, level: e.target.value }))}
                      className="px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent">
                      {['undergraduate','postgraduate','phd','diploma'].map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition-colors">Save</button>
                    <button type="button" onClick={() => setShowAddApp(false)} className="px-4 py-2 rounded-xl bg-muted text-t2 text-sm font-semibold hover:bg-line transition-colors">Cancel</button>
                  </div>
                </form>
              )}

              <div className="bg-surface border border-line rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      {['University','Course','Country','Intake','Status','Actions'].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map(app => (
                      <tr key={app._id} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 text-sm font-medium text-t1">{app.university}</td>
                        <td className="px-4 py-3 text-sm text-t2 max-w-[100px] truncate">{app.course}</td>
                        <td className="px-4 py-3 text-sm text-t2">
                          {COUNTRY_FLAGS[app.country] || ''} {app.country}
                        </td>
                        <td className="px-4 py-3 text-sm text-t2">{app.intake}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${APP_STATUS_COLORS[app.status]}`}>
                            {app.status.replace(/_/g,' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={app.status}
                            onChange={e => handleUpdateAppStatus(app._id, e.target.value as AppStatus)}
                            className="text-xs px-2 py-1 rounded-lg bg-card border border-line text-t1 focus:outline-none focus:border-accent"
                          >
                            {(['drafting','submitted','offer_received','conditional_offer','accepted','rejected','withdrawn','deferred'] as AppStatus[]).map(s => (
                              <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {applications.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-10 text-t3 text-sm">No applications yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2: Documents */}
          {activeTab === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-t1">Documents ({documents.length})</h3>
                {documents.length > 0 && (
                  <button
                    onClick={handleDownloadZip}
                    disabled={zipBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-t2 hover:text-accent hover:border-accent/40 text-xs font-semibold transition disabled:opacity-40"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                    {zipBusy ? 'Preparing…' : 'Download all (.zip)'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {documents.map(doc => (
                  <div key={doc._id} className="bg-surface border border-line rounded-2xl p-4 hover:border-accent/40 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-t1">{doc.type.replace(/_/g,' ')}</p>
                        {doc.label && <p className="text-xs text-t2">{doc.label}</p>}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOC_STATUS_COLORS[doc.status]}`}>
                        {doc.status.replace(/_/g,' ')}
                      </span>
                    </div>
                    <p className="text-xs text-t3 mb-3 truncate">{doc.currentVersion?.fileName}</p>
                    <div className="flex items-center gap-2">
                      <a
                        href={fileHref(doc.currentVersion?.fileUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        View File
                      </a>
                      {doc.versions?.length > 0 && (
                        <span className="text-xs text-t3">{doc.versions.length + 1} versions</span>
                      )}
                    </div>
                    {canReviewDocs && doc.status !== 'approved' && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-line">
                        <button
                          onClick={() => handleDocReview(doc._id, 'approved')}
                          className="flex-1 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setReviewDoc(doc)}
                          className="flex-1 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {documents.length === 0 && (
                  <div className="col-span-2 text-center py-12 text-t3 text-sm bg-surface border border-line rounded-2xl">
                    No documents uploaded yet
                  </div>
                )}
              </div>

              {/* Reject modal */}
              {reviewDoc && (
                <>
                  <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setReviewDoc(null)} />
                  <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-96 bg-surface border border-line rounded-2xl p-6 shadow-2xl">
                    <h3 className="text-base font-semibold text-t1 mb-3">Reject Document</h3>
                    <p className="text-sm text-t2 mb-4">{reviewDoc.type.replace(/_/g,' ')}</p>
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection…"
                      rows={3}
                      className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent resize-none mb-4"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleDocReview(reviewDoc._id, 'rejected')}
                        className="flex-1 py-2 rounded-xl bg-red-500/15 text-red-400 text-sm font-semibold hover:bg-red-500/25 transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => { setReviewDoc(null); setRejectReason(''); }}
                        className="flex-1 py-2 rounded-xl bg-muted text-t2 text-sm font-semibold hover:bg-line transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab 3: Visa */}
          {activeTab === 3 && (
            <div className="bg-surface border border-line rounded-2xl p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-semibold text-t1">Visa Application</h3>
                {!visa && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await api.post('/visas', { studentId: id, country: student.preferences?.countries?.[0] || 'UK', visaType: 'Student Visa' });
                        setVisa(res.data);
                        toast('Visa record created', 'success');
                      } catch { toast('Failed to create visa', 'error'); }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-indigo-500 transition-colors"
                  >
                    + File Visa
                  </button>
                )}
              </div>
              {visa ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-sm text-t2">Country:</span>
                    <span className="text-sm font-medium text-t1">{visa.country}</span>
                    <span className="text-sm text-t2 ml-4">Type:</span>
                    <span className="text-sm font-medium text-t1">{visa.visaType}</span>
                  </div>
                  <div className="space-y-3">
                    {[
                      { key: 'not_started', label: 'Not Started', dateKey: null },
                      { key: 'documents_complete', label: 'Documents Complete', dateKey: null },
                      { key: 'visa_filed', label: 'Visa Filed', dateKey: 'filedDate' },
                      { key: 'biometrics', label: 'Biometrics', dateKey: 'biometricsDate' },
                      { key: 'interview', label: 'Interview', dateKey: 'interviewDate' },
                      { key: 'decision', label: 'Decision', dateKey: 'decisionDate' },
                      { key: 'approved', label: 'Approved', dateKey: 'approvalDate' },
                    ].map((s, idx) => {
                      const stages = ['not_started','documents_complete','visa_filed','biometrics','interview','decision','approved','rejected','reapplied'];
                      const curIdx  = stages.indexOf(visa.stage);
                      const thisIdx = stages.indexOf(s.key);
                      const done    = thisIdx < curIdx;
                      const current = thisIdx === curIdx;
                      return (
                        <div key={s.key} className="flex items-center gap-4">
                          <button
                            onClick={async () => {
                              try {
                                const res = await api.put(`/visas/${visa._id}`, { stage: s.key });
                                setVisa(res.data);
                                toast('Visa stage updated', 'success');
                              } catch { toast('Failed', 'error'); }
                            }}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all hover:scale-110 ${
                              done ? 'bg-indigo-500' : current ? 'bg-indigo-500/20 border-2 border-indigo-500' : 'bg-muted border border-line'
                            }`}
                          >
                            {done ? (
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 20 20">
                                <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <span className={`text-xs font-bold ${current ? 'text-indigo-400' : 'text-t3'}`}>{idx + 1}</span>
                            )}
                          </button>
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${current ? 'text-indigo-400' : done ? 'text-t1' : 'text-t3'}`}>
                              {s.label}
                              {current && <span className="ml-2 text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 px-1.5 py-0.5 rounded-full">Current</span>}
                            </p>
                            {s.dateKey && (visa as unknown as Record<string,string>)[s.dateKey] && (
                              <p className="text-xs text-t3">{new Date((visa as unknown as Record<string,string>)[s.dateKey]).toLocaleDateString()}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {visa.refusalReason && (
                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-xs font-medium text-red-400 mb-1">Refusal Reason</p>
                      <p className="text-sm text-t2">{visa.refusalReason}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-t3 text-sm">No visa application filed yet.</div>
              )}
            </div>
          )}

          {/* Tab 4: Payments */}
          {activeTab === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-t1">Payments ({payments.length})</h3>
                <button
                  onClick={() => setShowAddPayment(!showAddPayment)}
                  className="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-indigo-500 transition-colors"
                >
                  + Add Payment
                </button>
              </div>

              {showAddPayment && (
                <form onSubmit={handleAddPayment} className="bg-surface border border-line rounded-2xl p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-t3 mb-1">Type</label>
                      <select value={paymentForm.type} onChange={e => setPaymentForm(p => ({ ...p, type: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent">
                        {['application_fee','university_fee','visa_fee','service_fee','courier_fee','other'].map(t => (
                          <option key={t} value={t}>{t.replace(/_/g,' ')}</option>
                        ))}
                      </select>
                    </div>
                    {[
                      { label: 'Description *', key: 'description' },
                      { label: 'Amount *', key: 'amount' },
                      { label: 'Currency', key: 'currency' },
                      { label: 'Due Date', key: 'dueDate' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="block text-xs text-t3 mb-1">{f.label}</label>
                        <input
                          type={f.key === 'dueDate' ? 'date' : f.key === 'amount' ? 'number' : 'text'}
                          required={f.label.endsWith('*')}
                          value={(paymentForm as Record<string,string>)[f.key]}
                          onChange={e => setPaymentForm(p => ({ ...p, [f.key]: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 transition-colors">Save</button>
                    <button type="button" onClick={() => setShowAddPayment(false)} className="px-4 py-2 rounded-xl bg-muted text-t2 text-sm font-semibold">Cancel</button>
                  </div>
                </form>
              )}

              <div className="bg-surface border border-line rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      {['Type','Description','Amount','Due','Status','Actions'].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p._id} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 text-xs text-t2">{p.type.replace(/_/g,' ')}</td>
                        <td className="px-4 py-3 text-sm text-t1 max-w-[100px] truncate">{p.description}</td>
                        <td className="px-4 py-3 text-sm font-medium text-t1">{p.currency} {p.amount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-t3">{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${PAYMENT_STATUS_COLORS[p.status]}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {p.status === 'pending' && (
                            <button
                              onClick={() => handleMarkPaid(p._id)}
                              className="text-xs text-emerald-400 hover:underline"
                            >
                              Mark Paid
                            </button>
                          )}
                          {p.receiptUrl && (
                            <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline ml-2">Receipt</a>
                          )}
                        </td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-10 text-t3 text-sm">No payments recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 5: Notes */}
          {activeTab === 5 && (
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-t1">Internal Notes</h3>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={12}
                placeholder="Add internal notes about this student…"
                className="w-full px-4 py-3 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent resize-none"
              />
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60 transition-colors"
              >
                {savingNotes ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: Quick info sidebar */}
        <div className="xl:col-span-1 space-y-5">
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-t2 uppercase tracking-wider">Quick Info</h3>
            <div className="space-y-3">
              {[
                { label: 'Nationality', value: student.personal?.nationality },
                { label: 'Passport Expiry', value: student.passport?.expiry ? new Date(student.passport.expiry).toLocaleDateString() : undefined },
                { label: 'IELTS Score', value: student.scores?.ielts },
                { label: 'TOEFL Score', value: student.scores?.toefl },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center">
                  <span className="text-xs text-t3">{item.label}</span>
                  <span className="text-xs font-medium text-t1">{item.value || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-t2 uppercase tracking-wider">Target Countries</h3>
            {student.preferences?.countries?.length ? (
              <div className="flex flex-wrap gap-2">
                {student.preferences.countries.map(c => (
                  <span key={c} className="text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 px-2 py-1 rounded-lg">
                    {COUNTRY_FLAGS[c] || ''} {c}
                  </span>
                ))}
              </div>
            ) : <p className="text-xs text-t3">None specified</p>}
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-t2 uppercase tracking-wider">Timeline</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-t3">Created</span>
                <span className="text-xs text-t1">{new Date(student.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-t3">Updated</span>
                <span className="text-xs text-t1">{new Date(student.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Assign / Reassign Counsellor */}
          {canAssignCounsellor && (
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-semibold text-t2 uppercase tracking-wider">Assign Counsellor</h3>
              {student.assignedCounsellor ? (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {typeof student.assignedCounsellor === 'object'
                      ? student.assignedCounsellor.name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()
                      : '?'}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-t1">
                      {typeof student.assignedCounsellor === 'object'
                        ? (student.assignedCounsellor as { name: string }).name
                        : student.assignedCounsellor}
                    </p>
                    <p className="text-xs text-t3">Current counsellor</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-t3">No counsellor assigned</p>
              )}
              <div className="space-y-2">
                <select
                  value={selectedCounsellor}
                  onChange={e => setSelectedCounsellor(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">— Unassign —</option>
                  {counsellors.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
                <button
                  onClick={handleAssignCounsellor}
                  disabled={assigningCounsellor}
                  className="w-full py-2 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-60 transition-colors"
                >
                  {assigningCounsellor ? 'Saving…' : student.assignedCounsellor ? 'Reassign' : 'Assign'}
                </button>
              </div>
            </div>
          )}

          {/* Student portal account */}
          {user?.role === 'admin' && (
            <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-t2 uppercase tracking-wider">Student Portal</h3>
                {!portalCreated && !showPortalForm && (
                  <button
                    onClick={() => { setPortalUsername(suggestUsername(student.personal?.name ?? '')); setShowPortalForm(true); }}
                    className="text-xs text-accent hover:underline"
                  >
                    + Create Account
                  </button>
                )}
              </div>
              {portalCreated ? (
                <div className="flex items-center gap-2 text-emerald-400 text-xs">
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                    <path d="M3 8l3.5 3.5 6.5-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Portal account active — student can log in at the Vernyr portal
                </div>
              ) : showPortalForm ? (
                <form onSubmit={handleCreatePortalAccount} className="space-y-3">
                  <div>
                    <label className="block text-xs text-t3 mb-1">Username</label>
                    <input
                      type="text"
                      value={portalUsername}
                      onChange={e => setPortalUsername(e.target.value.toLowerCase())}
                      required
                      pattern="[a-z0-9][a-z0-9._-]{2,31}"
                      title="3–32 characters: letters, numbers, dot, underscore or hyphen"
                      className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-t3 mb-1">Temporary Password</label>
                    <input
                      type="text"
                      value={portalPassword}
                      onChange={e => setPortalPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="min. 6 characters"
                      className="w-full px-3 py-1.5 rounded-lg bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={creatingPortal}
                      className="flex-1 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50 hover:bg-indigo-500 transition-colors">
                      {creatingPortal ? 'Creating…' : 'Create'}
                    </button>
                    <button type="button" onClick={() => setShowPortalForm(false)}
                      className="flex-1 py-1.5 rounded-lg bg-muted text-t2 text-xs font-semibold hover:bg-line transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-xs text-t3">No portal account yet. Create one so the student can track their journey.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
