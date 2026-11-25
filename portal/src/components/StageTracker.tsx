'use client';

import type { StudentStage } from '@/types';

const STAGES: { key: StudentStage; label: string; icon: string; desc: string }[] = [
  { key: 'inquiry',               label: 'Inquiry',              icon: '💡', desc: 'Initial interest registered' },
  { key: 'counselling',           label: 'Counselling',          icon: '🗣️', desc: 'Meeting with your counsellor' },
  { key: 'university_selection',  label: 'University Selection', icon: '🏫', desc: 'Shortlisting target universities' },
  { key: 'application_submitted', label: 'Application Sent',     icon: '📨', desc: 'Applications submitted to universities' },
  { key: 'offer_letter',          label: 'Offer Letter',         icon: '📜', desc: 'Offer received from university' },
  { key: 'fee_payment',           label: 'Fee Payment',          icon: '💳', desc: 'Tuition / service fee paid' },
  { key: 'cas_i20',               label: 'CAS / I-20',           icon: '🎓', desc: 'Study permit document issued' },
  { key: 'visa_filing',           label: 'Visa Filing',          icon: '🛂', desc: 'Visa application submitted' },
  { key: 'visa_approved',         label: 'Visa Approved',        icon: '✅', desc: 'Visa granted — almost there!' },
  { key: 'departure',             label: 'Departure',            icon: '✈️', desc: 'Journey begins!' },
];

const STAGE_INDEX: Record<StudentStage, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.key, i])
) as Record<StudentStage, number>;

interface Props {
  currentStage: StudentStage;
  compact?: boolean;
}

export function StageTracker({ currentStage, compact = false }: Props) {
  const current = STAGE_INDEX[currentStage];
  const pct = Math.round((current / (STAGES.length - 1)) * 100);

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-t2 mb-1">
          <span>{STAGES[current].label}</span>
          <span>{current + 1} / {STAGES.length}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-t3">{STAGES[current].desc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {STAGES.map((stage, idx) => {
        const done    = idx < current;
        const active  = idx === current;
        const future  = idx > current;

        return (
          <div key={stage.key} className="flex items-start gap-3">
            {/* Icon + connector */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all ${
                  done   ? 'bg-sky-500/20 text-sky-400 ring-0' :
                  active ? 'bg-sky-500/20 text-sky-400 ring-2 ring-sky-500/60' :
                           'bg-muted text-t3'
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                    <path d="M3 8l3.5 3.5 6.5-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className={future ? 'opacity-40' : ''}>{stage.icon}</span>
                )}
              </div>
              {idx < STAGES.length - 1 && (
                <div className={`w-0.5 h-5 mt-1 rounded-full transition-all ${done ? 'bg-sky-500/50' : 'bg-line'}`} />
              )}
            </div>

            {/* Text */}
            <div className={`pb-4 min-w-0 ${future ? 'opacity-40' : ''}`}>
              <p className={`text-sm font-semibold leading-tight ${active ? 'text-sky-400' : done ? 'text-t1' : 'text-t2'}`}>
                {stage.label}
              </p>
              {(done || active) && (
                <p className="text-xs text-t3 mt-0.5">{stage.desc}</p>
              )}
              {active && (
                <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-medium border border-sky-500/20">
                  Current stage
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
