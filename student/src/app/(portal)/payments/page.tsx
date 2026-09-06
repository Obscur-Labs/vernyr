'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CardSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import type { Payment, PaymentStatus, PaymentType } from '@/types';

const STATUS_STYLE: Record<PaymentStatus, string> = {
  pending:  'bg-amber-500/10 text-amber-400 border-amber-500/25',
  paid:     'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  overdue:  'bg-red-500/10 text-red-400 border-red-500/25',
  refunded: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
  waived:   'bg-t3/10 text-t3 border-line',
};

const TYPE_LABEL: Record<PaymentType, string> = {
  application_fee: 'Application Fee',
  university_fee:  'University Fee',
  visa_fee:        'Visa Fee',
  service_fee:     'Service Fee',
  courier_fee:     'Courier Fee',
  other:           'Other',
};

const TYPE_ICON: Record<PaymentType, string> = {
  application_fee: '🏫',
  university_fee:  '🎓',
  visa_fee:        '🛂',
  service_fee:     '💼',
  courier_fee:     '📦',
  other:           '💳',
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export default function PaymentsPage() {
  const { studentId } = useAuthStore();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<'all' | 'pending' | 'paid'>('all');

  useEffect(() => {
    if (!studentId) return;
    api.get<Payment[]>(`/payments?studentId=${studentId}`)
      .then(res => setPayments(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [studentId]);

  const totalPaid    = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter(p => p.status === 'pending' || p.status === 'overdue').reduce((s, p) => s + p.amount, 0);
  const overdueCount = payments.filter(p => p.status === 'overdue').length;

  const filtered = payments.filter(p => {
    if (tab === 'pending') return p.status === 'pending' || p.status === 'overdue';
    if (tab === 'paid')    return p.status === 'paid';
    return true;
  });

  return (
    <AppShell title="Payments">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-t1">Payments</h1>
          <p className="text-t3 text-sm mt-0.5">{payments.length} total transactions</p>
        </div>

        {!loading && payments.length > 0 && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl p-4">
                <p className="text-emerald-400 text-xl font-bold">
                  {formatCurrency(totalPaid, payments.find(p => p.status === 'paid')?.currency ?? 'INR')}
                </p>
                <p className="text-xs text-t3 mt-0.5 uppercase tracking-wider font-medium">Total Paid</p>
              </div>
              <div className={`${overdueCount > 0 ? 'bg-red-500/5 border-red-500/15' : 'bg-amber-500/5 border-amber-500/15'} rounded-2xl p-4 border`}>
                <p className={`text-xl font-bold ${overdueCount > 0 ? 'text-red-400' : 'text-amber-400'}`}>
                  {formatCurrency(totalPending, payments.find(p => p.status === 'pending')?.currency ?? 'INR')}
                </p>
                <p className="text-xs text-t3 mt-0.5 uppercase tracking-wider font-medium">
                  Due {overdueCount > 0 && <span className="text-red-400">({overdueCount} overdue)</span>}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
              {(['all', 'pending', 'paid'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded-xl text-sm font-semibold border transition capitalize ${
                    tab === t
                      ? 'bg-sky-500/15 border-sky-500/20 text-sky-400'
                      : 'border-line text-t2 hover:text-t1 hover:bg-muted'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={2} />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">💳</div>
            <p className="text-t2 font-medium">No payments {tab !== 'all' ? `with "${tab}" status` : 'yet'}</p>
            <p className="text-t3 text-sm mt-1">Payment records will appear here once added by your counsellor.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(p => {
              const isOverdue = p.status === 'overdue' ||
                (p.status === 'pending' && p.dueDate && new Date(p.dueDate) < new Date());

              return (
                <div key={p._id} className={`bg-surface border rounded-2xl p-4 animate-fade-in ${isOverdue ? 'border-red-500/30' : 'border-line'}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl flex-shrink-0">
                      {TYPE_ICON[p.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-t1 text-sm">{p.description}</p>
                          <p className="text-xs text-t3">{TYPE_LABEL[p.type]}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-t1">{formatCurrency(p.amount, p.currency)}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border capitalize ${STATUS_STYLE[p.status]}`}>
                            {p.status}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs text-t3">
                        {p.dueDate && (
                          <span className={isOverdue ? 'text-red-400 font-medium' : ''}>
                            Due: {new Date(p.dueDate).toLocaleDateString()}
                            {isOverdue && ' ⚠️'}
                          </span>
                        )}
                        {p.paidDate  && <span>Paid: {new Date(p.paidDate).toLocaleDateString()}</span>}
                        {p.invoiceNumber && <span>Invoice: {p.invoiceNumber}</span>}
                      </div>

                      {p.receiptUrl && (
                        <a
                          href={p.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1.5 text-xs text-sky-400 hover:underline"
                        >
                          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                            <path d="M2 10v3h12v-3M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Download Receipt
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
