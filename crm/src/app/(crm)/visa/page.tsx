'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { SkeletonTable } from '@/components/Skeleton';
import { useToast } from '@/context/ToastContext';
import type { Visa, VisaStage } from '@/types';

const VISA_STAGES: { id: VisaStage; label: string; short: string }[] = [
  { id: 'not_started',        label: 'Not Started',         short: 'Start' },
  { id: 'documents_complete', label: 'Documents Complete',  short: 'Docs' },
  { id: 'visa_filed',         label: 'Visa Filed',          short: 'Filed' },
  { id: 'biometrics',         label: 'Biometrics',          short: 'Bio' },
  { id: 'interview',          label: 'Interview',           short: 'Interview' },
  { id: 'decision',           label: 'Decision',            short: 'Decision' },
  { id: 'approved',           label: 'Approved',            short: 'Approved' },
  { id: 'rejected',           label: 'Rejected',            short: 'Rejected' },
];

const STAGE_COLORS: Record<VisaStage, string> = {
  not_started:        'bg-slate-500/15 text-slate-400',
  documents_complete: 'bg-blue-500/15 text-blue-400',
  visa_filed:         'bg-indigo-500/15 text-indigo-400',
  biometrics:         'bg-violet-500/15 text-violet-400',
  interview:          'bg-amber-500/15 text-amber-400',
  decision:           'bg-orange-500/15 text-orange-400',
  approved:           'bg-emerald-500/15 text-emerald-400',
  rejected:           'bg-red-500/15 text-red-400',
  reapplied:          'bg-cyan-500/15 text-cyan-400',
};

export default function VisaPage() {
  const [visas, setVisas]           = useState<Visa[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterStage, setFilterStage] = useState<VisaStage | ''>('');
  const { toast }                   = useToast();

  useEffect(() => {
    api.get('/visas')
      .then(r => setVisas(r.data))
      .catch(() => toast('Failed to load visa records', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filterStage ? visas.filter(v => v.stage === filterStage) : visas;

  const getStudentName = (visa: Visa) => {
    const s = visa.studentId as unknown as { personal?: { name: string } };
    return s?.personal?.name || 'Unknown Student';
  };

  const getStageIdx = (stage: VisaStage) => {
    const mainStages: VisaStage[] = ['not_started','documents_complete','visa_filed','biometrics','interview','decision','approved'];
    const idx = mainStages.indexOf(stage);
    return idx >= 0 ? idx : 0;
  };

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-t1">Visa Tracker</h1>
          <p className="text-t2 text-sm mt-1">{visas.length} visa applications tracked</p>
        </div>
        <select
          value={filterStage}
          onChange={e => setFilterStage(e.target.value as VisaStage | '')}
          className="px-3 py-2 rounded-xl bg-surface border border-line text-t1 text-sm focus:outline-none focus:border-accent"
        >
          <option value="">All Stages</option>
          {VISA_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Stage summary row */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-6">
        {VISA_STAGES.map(stage => {
          const count = visas.filter(v => v.stage === stage.id).length;
          return (
            <button
              key={stage.id}
              onClick={() => setFilterStage(prev => prev === stage.id ? '' : stage.id)}
              className={`flex-shrink-0 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                filterStage === stage.id
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface border-line text-t2 hover:text-t1'
              }`}
            >
              {stage.short} <span className="ml-1 opacity-75">({count})</span>
            </button>
          );
        })}
      </div>

      {loading ? <SkeletonTable rows={6} /> : (
        <div className="space-y-3">
          {filtered.map(visa => {
            const stageIdx  = getStageIdx(visa.stage);
            const maxStages = 7;
            const pct       = (stageIdx / (maxStages - 1)) * 100;

            return (
              <div key={visa._id} className="bg-surface border border-line rounded-2xl p-5 hover:border-accent/40 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-accent/20 text-accent-ink text-sm font-bold flex items-center justify-center">
                      {getStudentName(visa).split(' ').map(n => n[0]).join('').slice(0,2)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-t1">{getStudentName(visa)}</p>
                      <p className="text-xs text-t2">{visa.country} — {visa.visaType}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STAGE_COLORS[visa.stage]}`}>
                    {visa.stage.replace(/_/g,' ')}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="relative">
                  <div className="flex justify-between text-xs text-t3 mb-1">
                    {['Start','Docs','Filed','Bio','Interview','Decision','Approved'].map(l => (
                      <span key={l} className="flex-1 text-center first:text-left last:text-right">{l}</span>
                    ))}
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${Math.max(pct, 5)}%` }}
                    />
                  </div>
                </div>

                {/* Dates */}
                <div className="flex flex-wrap gap-4 mt-3">
                  {[
                    { label: 'Filed',      val: visa.filedDate },
                    { label: 'Biometrics', val: visa.biometricsDate },
                    { label: 'Interview',  val: visa.interviewDate },
                    { label: 'Approved',   val: visa.approvalDate },
                  ].filter(d => d.val).map(d => (
                    <div key={d.label}>
                      <span className="text-xs text-t3">{d.label}: </span>
                      <span className="text-xs text-t1 font-medium">{new Date(d.val!).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-20 bg-surface border border-line rounded-2xl text-t3 text-sm">
              No visa records found for the selected filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
