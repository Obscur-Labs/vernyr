'use client';

import { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { DocCardSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { fileHref } from '@/lib/media';
import type { Document, DocType, DocumentRequest } from '@/types';

const DOC_LABELS: Record<DocType, string> = {
  passport:       'Passport',
  marksheet_10:   '10th Marksheet',
  marksheet_12:   '12th Marksheet',
  ielts:          'IELTS Score Card',
  toefl:          'TOEFL Score Card',
  gre:            'GRE Score Card',
  gmat:           'GMAT Score Card',
  sop:            'Statement of Purpose',
  lor:            'Letter of Recommendation',
  bank_statement: 'Bank Statement',
  photo:          'Photograph',
  offer_letter:   'Offer Letter',
  visa_copy:      'Visa Copy',
  other:          'Other',
};

const STATUS_STYLE: Record<string, string> = {
  uploaded:     'bg-sky-500/10 text-sky-400 border-sky-500/25',
  under_review: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  approved:     'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  rejected:     'bg-red-500/10 text-red-400 border-red-500/25',
};

const STATUS_ICON: Record<string, string> = {
  uploaded:     '📤',
  under_review: '🔍',
  approved:     '✅',
  rejected:     '❌',
};

function uploadError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'Upload failed';
}

export default function DocumentsPage() {
  const { studentId } = useAuthStore();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reqFileRef   = useRef<HTMLInputElement>(null);
  const [documents, setDocuments]  = useState<Document[]>([]);
  const [requests, setRequests]    = useState<DocumentRequest[]>([]);
  const [loading, setLoading]      = useState(true);
  const [uploading, setUploading]  = useState(false);
  const [uploadFor, setUploadFor]  = useState<DocType>('passport');
  const [filter, setFilter]        = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [uploadingReq, setUploadingReq] = useState<DocumentRequest | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // `?doc=<id>` arrives from a chat attachment: show that document, highlighted.
  useEffect(() => {
    setFocusId(new URLSearchParams(window.location.search).get('doc'));
  }, []);

  useEffect(() => {
    if (!focusId || loading) return;
    setFilter('all');
    requestAnimationFrame(() => {
      document.getElementById(`doc-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focusId, loading]);

  function loadDocuments() {
    if (!studentId) return;
    Promise.all([
      api.get<Document[]>(`/documents?studentId=${studentId}`),
      api.get<DocumentRequest[]>(`/documents/requests?studentId=${studentId}&status=pending`),
    ])
      .then(([docsRes, reqRes]) => { setDocuments(docsRes.data); setRequests(reqRes.data); })
      .catch(() => toast('Failed to load documents', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadDocuments(); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !studentId) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('studentId', studentId);
    form.append('type', uploadFor);
    try {
      await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Document uploaded!');
      setShowUploadPanel(false);
      loadDocuments();
    } catch (err) {
      toast(uploadError(err), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  /* Upload against a counsellor's pending request */
  async function handleRequestUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const req  = uploadingReq;
    if (!file || !studentId || !req) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('studentId', studentId);
    form.append('type', req.type);
    if (req.label) form.append('label', req.label);
    form.append('requestId', req._id);
    try {
      await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Document uploaded!');
      loadDocuments();
    } catch (err) {
      toast(uploadError(err), 'error');
    } finally {
      setUploading(false);
      setUploadingReq(null);
      if (reqFileRef.current) reqFileRef.current.value = '';
    }
  }

  const filtered = documents.filter(d => {
    if (filter === 'approved') return d.status === 'approved';
    if (filter === 'pending')  return d.status === 'uploaded' || d.status === 'under_review';
    if (filter === 'rejected') return d.status === 'rejected';
    return true;
  });

  const approvedCount  = documents.filter(d => d.status === 'approved').length;
  const rejectedCount  = documents.filter(d => d.status === 'rejected').length;
  const pendingCount   = documents.filter(d => d.status === 'uploaded' || d.status === 'under_review').length;

  return (
    <AppShell title="Documents">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-t1">Documents</h1>
            <p className="text-t3 text-sm mt-0.5">{documents.length} total · {approvedCount} approved</p>
          </div>
          <button
            onClick={() => setShowUploadPanel(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white text-sm font-semibold shadow hover:from-sky-500 hover:to-cyan-500 transition"
          >
            + Upload
          </button>
        </div>

        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Approved', value: approvedCount, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/15', filter: 'approved' as const },
              { label: 'In Review', value: pendingCount,  color: 'text-amber-400',   bg: 'bg-amber-500/5 border-amber-500/15',   filter: 'pending'  as const },
              { label: 'Rejected', value: rejectedCount, color: 'text-red-400',     bg: 'bg-red-500/5 border-red-500/15',       filter: 'rejected' as const },
            ].map(s => (
              <button
                key={s.label}
                onClick={() => setFilter(prev => prev === s.filter ? 'all' : s.filter)}
                className={`rounded-2xl border px-3 py-3 text-left transition ${s.bg} ${filter === s.filter ? 'ring-2 ring-offset-1 ring-offset-base ring-current' : ''}`}
              >
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-t3 mt-0.5 font-semibold uppercase tracking-wider">{s.label}</p>
              </button>
            ))}
          </div>
        )}

        {/* Pending requests from counsellor */}
        {!loading && requests.length > 0 && (
          <div className="glass-card border border-amber-500/30 rounded-2xl p-5 animate-slide-up">
            <input ref={reqFileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={handleRequestUpload} />
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">📋</span>
              <h3 className="font-semibold text-t1">Requested by your counsellor</h3>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/25">
                {requests.length} pending
              </span>
            </div>
            <div className="space-y-2.5">
              {requests.map(req => {
                const requester = typeof req.requestedBy === 'object' ? req.requestedBy.name : 'Your counsellor';
                return (
                  <div key={req._id} className="flex items-center gap-3 bg-muted/60 border border-line rounded-xl px-3.5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-t1 truncate">{req.label || DOC_LABELS[req.type]}</p>
                      <p className="text-xs text-t3 truncate">
                        {requester} · {new Date(req.createdAt).toLocaleDateString()}
                        {req.note && <> · {req.note}</>}
                      </p>
                    </div>
                    <button
                      onClick={() => { setUploadingReq(req); reqFileRef.current?.click(); }}
                      disabled={uploading}
                      className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-40 transition flex-shrink-0"
                    >
                      {uploading && uploadingReq?._id === req._id ? 'Uploading…' : '⬆ Upload'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upload panel */}
        {showUploadPanel && (
          <div className="bg-surface border border-sky-500/30 rounded-2xl p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-t1">Upload Document</h3>
              <button onClick={() => setShowUploadPanel(false)} className="text-t3 hover:text-t1 text-xl leading-none">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Document Type</label>
                <select
                  value={uploadFor}
                  onChange={e => setUploadFor(e.target.value as DocType)}
                  className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 focus:outline-none focus:border-accent transition"
                >
                  {(Object.entries(DOC_LABELS) as [DocType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleUpload}
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  disabled={uploading}
                  className="w-full text-sm text-t2 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent/15 file:text-accent file:font-semibold hover:file:bg-accent/25 cursor-pointer disabled:opacity-50"
                />
                <p className="text-xs text-t3 mt-1">Accepted: PDF, JPG, PNG, DOC (max 10 MB)</p>
              </div>
              {uploading && (
                <div className="flex items-center gap-2 text-sky-400 text-sm">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/>
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Uploading…
                </div>
              )}
            </div>
          </div>
        )}

        {/* Document list */}
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <DocCardSkeleton key={i} />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📂</div>
            <p className="text-t2 font-medium">No documents {filter !== 'all' ? `with "${filter}" status` : 'uploaded yet'}</p>
            <p className="text-t3 text-sm mt-1">Click Upload to add your first document</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(doc => (
              <div
                key={doc._id}
                id={`doc-${doc._id}`}
                className={`bg-surface border rounded-2xl p-4 flex items-center gap-4 animate-fade-in transition-shadow ${
                  focusId === doc._id ? 'border-accent ring-2 ring-accent/40' : 'border-line'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg flex-shrink-0">
                  {STATUS_ICON[doc.status]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-t1 text-sm truncate">
                    {doc.label ?? DOC_LABELS[doc.type]}
                  </p>
                  <p className="text-xs text-t3">
                    {doc.currentVersion.fileName} · {new Date(doc.currentVersion.uploadedAt).toLocaleDateString()}
                  </p>
                  {doc.status === 'rejected' && doc.rejectionReason && (
                    <p className="text-xs text-red-400 mt-0.5">Reason: {doc.rejectionReason}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border capitalize ${STATUS_STYLE[doc.status]}`}>
                    {doc.status.replace(/_/g, ' ')}
                  </span>
                  <div className="flex items-center gap-2">
                    {doc.versions.length > 1 && (
                      <span className="text-xs text-t3">v{doc.versions.length}</span>
                    )}
                    {doc.currentVersion?.fileUrl && (
                      <a
                        href={fileHref(doc.currentVersion.fileUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[32px] items-center text-xs font-semibold text-accent hover:underline"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
