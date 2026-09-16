'use client';

import { StageTracker } from '@/components/StageTracker';
import type { Student } from '@/types';

const STAGE_TIPS: Record<string, string[]> = {
  inquiry:               ['Make a list of your target countries and courses', 'Attend free counselling sessions'],
  counselling:           ['Bring your academic transcripts', 'Discuss your budget and timeline'],
  university_selection:  ['Research rankings and placement rates', 'Check scholarship availability'],
  application_submitted: ['Track application portals regularly', 'Prepare for potential interviews'],
  offer_letter:          ['Review offer conditions carefully', 'Ask about conditional vs unconditional offers'],
  fee_payment:           ['Keep payment receipts', 'Ask for a tuition payment plan if needed'],
  cas_i20:               ['Check all details on the document carefully', 'Keep digital and physical copies'],
  visa_filing:           ['Double-check all documents before submission', 'Book biometrics early'],
  visa_approved:         ['Book your flights early for better prices', 'Arrange accommodation in advance'],
  departure:             ['Carry all original documents in hand luggage', 'Keep emergency contacts handy'],
};

/** The journey view — stage tracker, tips, summary and scores. Lives under Profile → Progress. */
export function JourneyProgress({ student }: { student: Student }) {
  const currentTips = STAGE_TIPS[student.stage] ?? [];
  const scores = student.scores ?? {};
  const prefs  = student.preferences ?? {};

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-line rounded-2xl p-5 animate-fade-in">
        <StageTracker currentStage={student.stage} />
      </div>

      {/* Tips for current stage */}
      {currentTips.length > 0 && (
        <div className="bg-sky-500/5 border border-sky-500/20 rounded-2xl p-5 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sky-400">💡</span>
            <h3 className="font-semibold text-sky-400 text-sm">Tips for this stage</h3>
          </div>
          <ul className="space-y-2">
            {currentTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-t2">
                <span className="text-sky-500 mt-0.5 flex-shrink-0">→</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Student details */}
      <div className="bg-surface border border-line rounded-2xl p-5 animate-fade-in">
        <h3 className="font-semibold text-t1 text-sm mb-4">Profile Summary</h3>
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
          <Detail label="Name"        value={student.personal.name} />
          <Detail label="Email"       value={student.personal.email || '—'} />
          <Detail label="Phone"       value={student.personal.phone} />
          <Detail label="Nationality" value={student.personal.nationality} />
          <Detail label="Intake"      value={prefs.intake} />
          <Detail label="Countries"   value={prefs.countries?.join(', ')} />
        </div>
      </div>

      {/* Scores */}
      {(scores.ielts || scores.toefl || scores.gre || scores.gmat || scores.sat) && (
        <div className="bg-surface border border-line rounded-2xl p-5 animate-fade-in">
          <h3 className="font-semibold text-t1 text-sm mb-4">Test Scores</h3>
          <div className="flex flex-wrap gap-3">
            {scores.ielts && <ScoreBadge label="IELTS" value={String(scores.ielts)} />}
            {scores.toefl && <ScoreBadge label="TOEFL" value={String(scores.toefl)} />}
            {scores.gre   && <ScoreBadge label="GRE"   value={String(scores.gre)} />}
            {scores.gmat  && <ScoreBadge label="GMAT"  value={String(scores.gmat)} />}
            {scores.sat   && <ScoreBadge label="SAT"   value={String(scores.sat)} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-t3 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-t1 mt-0.5 truncate">{value}</p>
    </div>
  );
}

function ScoreBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20">
      <span className="text-xs font-bold text-t3 uppercase">{label}</span>
      <span className="text-sky-400 font-bold text-base">{value}</span>
    </div>
  );
}
