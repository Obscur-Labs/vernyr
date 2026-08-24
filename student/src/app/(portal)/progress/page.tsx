'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { StageTracker } from '@/components/StageTracker';
import { CardSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
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

export default function ProgressPage() {
  const { studentId } = useAuthStore();
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    api.get<Student>(`/students/${studentId}`)
      .then(res => setStudent(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [studentId]);

  const currentTips = student ? (STAGE_TIPS[student.stage] ?? []) : [];
  const scores = student?.scores ?? {};
  const prefs  = student?.preferences ?? {};

  return (
    <AppShell title="My Progress">
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-t1">My Journey</h1>
          <p className="text-t3 text-sm mt-1">10 stages from inquiry to departure</p>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
        ) : student ? (
          <>
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
          </>
        ) : (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-t2 font-medium">Profile not linked yet</p>
            <p className="text-t3 text-sm mt-1">Contact your counsellor to get your profile set up.</p>
          </div>
        )}
      </div>
    </AppShell>
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
