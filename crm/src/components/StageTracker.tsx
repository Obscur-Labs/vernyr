'use client';
import {
  BuildingIcon, ChatIcon, CheckIcon, ClipboardIcon, CreditCardIcon, DocumentTextIcon,
  PassportIcon, PlaneIcon, UsersIcon, type IconProps,
} from '@/components/icons';
import type { StudentStage } from '@/types';

type Glyph = (props: IconProps) => React.ReactElement;

const STAGES: { id: StudentStage; label: string; Icon: Glyph; description: string }[] = [
  { id: 'inquiry',               label: 'Inquiry',               Icon: ChatIcon,         description: 'Initial contact made' },
  { id: 'counselling',           label: 'Counselling',           Icon: UsersIcon,        description: 'Sessions in progress' },
  { id: 'university_selection',  label: 'University Selection',  Icon: BuildingIcon,     description: 'Shortlisting universities' },
  { id: 'application_submitted', label: 'Application Submitted', Icon: DocumentTextIcon, description: 'Applications sent' },
  { id: 'offer_letter',          label: 'Offer Letter',          Icon: ClipboardIcon,    description: 'Offer received' },
  { id: 'fee_payment',           label: 'Fee Payment',           Icon: CreditCardIcon,   description: 'Fees paid' },
  { id: 'cas_i20',               label: 'CAS / I-20',            Icon: DocumentTextIcon, description: 'CAS or I-20 issued' },
  { id: 'visa_filing',           label: 'Visa Filing',           Icon: PassportIcon,     description: 'Visa application filed' },
  { id: 'visa_approved',         label: 'Visa Approved',         Icon: CheckIcon,        description: 'Visa granted' },
  { id: 'departure',             label: 'Departure',             Icon: PlaneIcon,        description: 'Student departed' },
];

interface Props {
  currentStage: StudentStage;
  onChange?: (stage: StudentStage) => void;
  readonly?: boolean;
}

export function StageTracker({ currentStage, onChange, readonly }: Props) {
  const currentIdx = STAGES.findIndex(s => s.id === currentStage);

  return (
    <div className="relative">
      {STAGES.map((stage, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent   = idx === currentIdx;
        const isFuture    = idx > currentIdx;

        return (
          <div key={stage.id} className="relative flex items-start gap-4 pb-6 last:pb-0">
            {/* Vertical connector line */}
            {idx < STAGES.length - 1 && (
              <div
                className={`absolute left-5 top-10 bottom-0 w-0.5 ${
                  isCompleted ? 'bg-indigo-500' : 'bg-line'
                }`}
              />
            )}

            {/* Circle indicator */}
            <button
              disabled={readonly}
              onClick={() => onChange?.(stage.id)}
              className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-all ${
                isCompleted
                  ? 'bg-indigo-500 shadow-lg shadow-indigo-500/30'
                  : isCurrent
                  ? 'bg-indigo-500/20 border-2 border-indigo-500 ring-4 ring-indigo-500/15'
                  : 'bg-muted border border-line'
              } ${!readonly ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
            >
              {isCompleted ? (
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 20 20">
                  <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className={`${isCurrent ? 'text-indigo-400' : 'text-t3'} ${isFuture ? 'opacity-45' : ''}`}>
                  <stage.Icon className="w-[18px] h-[18px]" />
                </span>
              )}
            </button>

            {/* Label and description */}
            <div className={`pt-1.5 ${isFuture ? 'opacity-40' : ''}`}>
              <p className={`text-sm font-semibold ${
                isCurrent ? 'text-indigo-400' : isCompleted ? 'text-t1' : 'text-t2'
              }`}>
                {stage.label}
                {isCurrent && (
                  <span className="ml-2 text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 px-1.5 py-0.5 rounded-full">
                    Current
                  </span>
                )}
              </p>
              <p className="text-xs text-t3 mt-0.5">{stage.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
