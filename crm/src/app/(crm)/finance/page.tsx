'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Stat, StatSkeleton } from '@/components/ui/stat';
import { ClockIcon, RefundIcon, TrendingUpIcon, WalletIcon } from '@/components/icons';
import { SkeletonTable } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import type { Payment, PaymentStatus, PaymentType } from '@/types';

const STATUS_COLORS: Record<PaymentStatus, string> = {
  pending:  'bg-amber-500/15 text-amber-400',
  paid:     'bg-emerald-500/15 text-emerald-400',
  overdue:  'bg-red-500/15 text-red-400',
  refunded: 'bg-blue-500/15 text-blue-400',
  waived:   'bg-slate-500/15 text-slate-400',
};

const PAYMENT_TYPES: PaymentType[] = ['application_fee','university_fee','visa_fee','service_fee','courier_fee','other'];

export default function FinancePage() {
  const [payments, setPayments]     = useState<Payment[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterStatus, setFilterStatus] = useState<PaymentStatus | ''>('');
  const [confirmPayId, setConfirmPayId] = useState<string | null>(null);
  const { toast }                   = useToast();

  useEffect(() => {
    api.get('/payments')
      .then(r => setPayments(r.data))
      .catch(() => toast('Failed to load payments', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const totalCollected    = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending      = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const totalRefunded     = payments.filter(p => p.status === 'refunded').reduce((s, p) => s + p.amount, 0);
  const thisMonth         = payments.filter(p => {
    if (!p.paidDate) return false;
    const d = new Date(p.paidDate);
    const n = new Date();
    return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear() && p.status === 'paid';
  }).reduce((s, p) => s + p.amount, 0);

  const handleMarkPaid = async (paymentId: string) => {
    try {
      const res = await api.put(`/payments/${paymentId}`, { status: 'paid', paidDate: new Date().toISOString() });
      setPayments(prev => prev.map(p => p._id === paymentId ? res.data : p));
      setConfirmPayId(null);
      toast('Payment marked as paid', 'success');
    } catch {
      toast('Failed to update payment', 'error');
    }
  };

  // Type distribution for simple chart
  const typeCounts = PAYMENT_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = payments.filter(p => p.type === t).length;
    return acc;
  }, {});
  const maxTypeCount = Math.max(...Object.values(typeCounts), 1);

  const filtered = filterStatus ? payments.filter(p => p.status === filterStatus) : payments;

  const getStudentName = (payment: Payment) => {
    const s = payment.studentId as unknown as { personal?: { name: string } };
    return s?.personal?.name || 'Unknown';
  };

  return (
    <div className="p-6 animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-t1">Finance</h1>
        <p className="text-t2 text-sm mt-1">Track all payments and revenue</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {loading ? (
          [...Array(4)].map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <Stat label="Total Collected" value={`$${totalCollected.toLocaleString()}`} icon={<WalletIcon />} accent="emerald" />
            <Stat label="Pending Payments" value={`$${totalPending.toLocaleString()}`} icon={<ClockIcon />} accent="amber" />
            <Stat label="This Month Revenue" value={`$${thisMonth.toLocaleString()}`} icon={<TrendingUpIcon />} accent="indigo" />
            <Stat label="Refunds" value={`$${totalRefunded.toLocaleString()}`} icon={<RefundIcon />} accent="blue" />
          </>
        )}
      </div>

      {/* Filter and table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-t1">Payment Records</h2>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as PaymentStatus | '')}
            className="px-3 py-2 rounded-xl bg-surface border border-line text-t1 text-sm focus:outline-none focus:border-accent"
          >
            <option value="">All Statuses</option>
            {(['pending','paid','overdue','refunded','waived'] as PaymentStatus[]).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {loading ? <SkeletonTable rows={6} /> : (
          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  {['Student','Type','Description','Amount','Status','Due Date','Paid Date','Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-t2 px-4 py-3 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p._id} className="border-b border-line last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-t1">{getStudentName(p)}</td>
                    <td className="px-4 py-3 text-xs text-t2">{p.type.replace(/_/g,' ')}</td>
                    <td className="px-4 py-3 text-sm text-t2 max-w-[120px] truncate">{p.description}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-t1">{p.currency} {p.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[p.status]}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-t3">{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-xs text-t3">{p.paidDate ? new Date(p.paidDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {p.status === 'pending' && (
                          <button
                            onClick={() => setConfirmPayId(p._id)}
                            className="text-xs text-emerald-400 hover:underline"
                          >
                            Mark Paid
                          </button>
                        )}
                        {p.receiptUrl && (
                          <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Receipt</a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-t3 text-sm">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment type distribution */}
      <div className="bg-surface border border-line rounded-2xl p-5">
        <h2 className="text-base font-semibold text-t1 mb-5">Payment Type Distribution</h2>
        <div className="space-y-3">
          {PAYMENT_TYPES.map(type => {
            const count = typeCounts[type] || 0;
            const pct   = (count / maxTypeCount) * 100;
            return (
              <div key={type} className="flex items-center gap-3">
                <span className="text-xs text-t2 w-32 flex-shrink-0 text-right">{type.replace(/_/g,' ')}</span>
                <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-t1 w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirm mark paid modal */}
      {confirmPayId && (
        <>
          <div className="overlay-scrim animate-backdrop-in fixed inset-0 z-40" onClick={() => setConfirmPayId(null)} />
          <div className="overlay-panel animate-overlay-in fixed left-1/2 top-1/2 z-50 w-[min(92vw,20rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-6">
            <h3 className="text-base font-semibold text-t1 mb-2">Mark as Paid?</h3>
            <p className="text-sm text-t2 mb-5">This will record today as the payment date and update the status to paid.</p>
            <div className="flex gap-3">
              <button onClick={() => handleMarkPaid(confirmPayId)} className="flex-1 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/25 transition-colors">Confirm</button>
              <button onClick={() => setConfirmPayId(null)} className="flex-1 py-2.5 rounded-xl bg-muted text-t2 text-sm font-semibold hover:bg-line transition-colors">Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
