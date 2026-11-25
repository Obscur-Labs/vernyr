'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { openStoredFile } from '@/lib/media';
import { SkeletonTable } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import type { Document as Doc, DocStatus } from '@/types';

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_COLORS: Record<DocStatus, string> = {
  uploaded:      'bg-blue-500/15 text-blue-400',
  under_review:  'bg-amber-500/15 text-amber-400',
  approved:      'bg-emerald-500/15 text-emerald-400',
  rejected:      'bg-red-500/15 text-red-400',
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<FilterTab>('all');
  const [reviewDoc, setReviewDoc] = useState<Doc | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // `?doc=<id>` arrives from a chat attachment: open that document straight away.
    const docParam = new URLSearchParams(window.location.search).get('doc');
    setFocusId(docParam);
    api.get<Doc[]>('/documents')
      .then(r => {
        setDocuments(r.data);
        const target = docParam ? r.data.find(d => d._id === docParam) : undefined;
        if (target) setReviewDoc(target);
      })
      .catch(() => toast('Failed to load documents', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const openDoc = (docId: string) =>
    openStoredFile(`/documents/${docId}/open`).catch(() => toast('Could not open this file', 'error'));

  const handleReview = async (docId: string, status: DocStatus) => {
    try {
      const res = await api.put(`/documents/${docId}/status`, { status, rejectionReason: rejectReason });
      setDocuments(prev => prev.map(d => d._id === docId ? { ...d, status: res.data.status } : d));
      setReviewDoc(null);
      setRejectReason('');
      toast(`Document ${status}`, 'success');
    } catch {
      toast('Failed to update document', 'error');
    }
  };

  const filtered = documents.filter(d => {
    if (filter === 'all') return true;
    if (filter === 'pending') return d.status === 'uploaded' || d.status === 'under_review';
    if (filter === 'approved') return d.status === 'approved';
    if (filter === 'rejected') return d.status === 'rejected';
    return true;
  });

  const TABS: { id: FilterTab; label: string }[] = [
    { id: 'all',      label: 'All' },
    { id: 'pending',  label: 'Pending Review' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ];

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-t1">Document Verification</h1>
        <p className="text-t2 text-sm mt-1">Review and approve student documents</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filter === tab.id ? 'bg-accent text-white' : 'bg-surface border border-line text-t2 hover:text-t1'
            }`}
          >
            {tab.label}
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
              filter === tab.id ? 'bg-white/20' : 'bg-muted text-t3'
            }`}>
              {documents.filter(d => {
                if (tab.id === 'all') return true;
                if (tab.id === 'pending') return d.status === 'uploaded' || d.status === 'under_review';
                return d.status === tab.id;
              }).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonTable rows={8} />
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {['Student','Document Type','Filename','Uploaded','Status','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => {
                const student = doc.studentId as unknown as { personal?: { name: string } };
                const studentName = student?.personal?.name || 'Unknown Student';
                return (
                  <tr key={doc._id} className={`border-b border-line last:border-0 hover:bg-muted/50 transition-colors ${focusId === doc._id ? 'bg-accent/10' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-t1">{studentName}</td>
                    <td className="px-4 py-3 text-sm text-t2">{doc.type.replace(/_/g,' ')}</td>
                    <td className="px-4 py-3 text-xs text-t2 max-w-[150px] truncate">{doc.currentVersion?.fileName}</td>
                    <td className="px-4 py-3 text-xs text-t3">{new Date(doc.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[doc.status]}`}>
                        {doc.status.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {doc.currentVersion?.fileUrl && (
                          <button
                            type="button"
                            onClick={() => openDoc(doc._id)}
                            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent/20"
                          >
                            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-4 w-4"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                            Open
                          </button>
                        )}
                        {doc.status !== 'approved' && (
                          <button
                            onClick={() => setReviewDoc(doc)}
                            className="text-xs px-2 py-1 rounded-lg bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors"
                          >
                            Review
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-t3 text-sm">No documents found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Review modal */}
      {reviewDoc && (
        <>
          <div className="overlay-scrim animate-backdrop-in fixed inset-0 z-40" onClick={() => setReviewDoc(null)} />
          <div className="overlay-panel animate-overlay-in fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-6">
            <h3 className="text-base font-semibold text-t1 mb-1">Review Document</h3>
            <p className="text-sm text-t2 mb-4">{reviewDoc.type.replace(/_/g,' ')} — {reviewDoc.currentVersion?.fileName}</p>
            {reviewDoc.currentVersion?.fileUrl && (
              <button
                type="button"
                onClick={() => openDoc(reviewDoc._id)}
                className="flex w-full items-center justify-center gap-2 py-3 mb-4 rounded-xl border border-line text-sm font-semibold text-accent-ink hover:bg-muted transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-4 w-4"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                Open file in new tab
              </button>
            )}
            <div className="mb-4">
              <label className="block text-xs text-t3 mb-1.5">Rejection Reason (required only for reject)</label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Explain why this document is rejected…"
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-card border border-line text-t1 text-sm focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleReview(reviewDoc._id, 'approved')}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/25 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => handleReview(reviewDoc._id, 'rejected')}
                className="flex-1 py-2.5 rounded-xl bg-red-500/15 text-red-400 text-sm font-semibold hover:bg-red-500/25 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => { setReviewDoc(null); setRejectReason(''); }}
                className="flex-1 py-2.5 rounded-xl bg-muted text-t2 text-sm font-semibold hover:bg-line transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
