'use client';

import type { Message, DocType, DocRequestStatus } from '@/types';
import { CheckIcon, ClipboardIcon, CloseIcon, DocumentTextIcon } from '@/components/icons';

export const DOC_LABELS: Record<DocType, string> = {
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

export const REQ_STATUS_STYLE: Record<DocRequestStatus, string> = {
  pending:   'bg-amber-500/10 text-amber-500 border-amber-500/25',
  fulfilled: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/25',
  cancelled: 'bg-muted text-t3 border-line',
};

/* ── Read-receipt ticks (WhatsApp style) ─────────────────────────────────── */
export function Ticks({ read, onAccent }: { read: boolean; onAccent: boolean }) {
  const color = read
    ? (onAccent ? 'text-cyan-200' : 'text-[#0a84ff]')
    : (onAccent ? 'text-white/60' : 'text-[#8e8e93]');
  return (
    <svg viewBox="0 0 18 12" fill="none" className={`inline-block w-4 h-3 ${color}`} aria-label={read ? 'Read' : 'Sent'}>
      <path d="M1 6.5L4 9.5L10 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 6.5L10 9.5L16 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Quoted reply block inside a bubble ──────────────────────────────────── */
export function ReplyQuote({ replyTo, isMe }: { replyTo: NonNullable<Message['replyTo']>; isMe: boolean }) {
  return (
    <div className={`mb-1.5 px-2.5 py-1.5 rounded-lg border-l-2 text-xs ${
      isMe ? 'bg-white/15 border-white/60 text-white/85' : 'im-quote border-[#0a84ff] opacity-90'
    }`}>
      <p className={`font-semibold ${isMe ? 'text-white' : 'text-[#0a84ff]'}`}>{replyTo.senderName}</p>
      <p className="truncate">{replyTo.preview}</p>
    </div>
  );
}

/* ── Document-request card ───────────────────────────────────────────────── */
export function DocRequestCard({
  msg, isMe, onCancelItem,
}: {
  msg: Message;
  isMe: boolean;
  onCancelItem?: (requestId: string) => void;
}) {
  const items = msg.meta?.items ?? [];
  return (
    <div className="msg-bubble rounded-[18px] border im-card overflow-hidden w-72 max-w-full">
      <div className="px-3.5 py-2.5 bg-[#0a84ff]/10 border-b border-[#0a84ff]/20 flex items-center gap-2">
        <ClipboardIcon className="w-4 h-4 text-[#0a84ff] shrink-0" />
        <p className="text-xs font-bold text-[#0a84ff] uppercase tracking-wider">Documents Requested</p>
      </div>
      <div className="divide-y divide-line">
        {items.map(item => (
          <div key={item.requestId} className="px-3.5 py-2.5 flex items-center gap-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-t1 truncate">{item.label || DOC_LABELS[item.type]}</p>
              {item.note && <p className="text-xs text-t3 truncate">{item.note}</p>}
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border capitalize flex-shrink-0 ${REQ_STATUS_STYLE[item.status]}`}>
              {item.status}
            </span>
            {onCancelItem && item.status === 'pending' && (
              <button
                onClick={() => onCancelItem(item.requestId)}
                title="Cancel request"
                className="text-t3 hover:text-red-400 flex-shrink-0"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Form-request card (CRM view: status only) ───────────────────────────── */
export function FormRequestCard({ msg, isMe }: { msg: Message; isMe: boolean }) {
  const meta = msg.meta ?? {};
  return (
    <div className="msg-bubble rounded-[18px] border im-card overflow-hidden w-72 max-w-full">
      <div className="px-3.5 py-2.5 bg-violet-500/10 border-b border-violet-500/20 flex items-center gap-2">
        <DocumentTextIcon className="w-4 h-4 text-violet-500 shrink-0" />
        <p className="text-xs font-bold text-violet-500 uppercase tracking-wider truncate">
          {meta.title || 'Details Requested'}
        </p>
      </div>
      <div className="px-3.5 py-2.5 space-y-1.5">
        {(meta.fields ?? []).map(f => (
          <p key={f.id} className="text-sm text-t2 flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-t3 flex-shrink-0" />{f.label}
          </p>
        ))}
        <div className="pt-1.5">
          {meta.answered ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500">
              <CheckIcon className="w-3.5 h-3.5" />Answered
            </span>
          ) : (
            <span className="text-xs font-semibold text-amber-500">Awaiting response…</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Form-response card (answers) ────────────────────────────────────────── */
export function FormResponseCard({ msg, isMe }: { msg: Message; isMe: boolean }) {
  const meta = msg.meta ?? {};
  return (
    <div className="msg-bubble rounded-[18px] border im-card overflow-hidden w-72 max-w-full">
      <div className="px-3.5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-2">
        <DocumentTextIcon className="w-4 h-4 text-emerald-600 shrink-0" />
        <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider truncate">
          {meta.title ? `${meta.title} — Response` : 'Details Submitted'}
        </p>
      </div>
      <div className="px-3.5 py-2.5 space-y-2">
        {(meta.answers ?? []).map(a => (
          <div key={a.id}>
            <p className="text-[11px] font-semibold text-t3 uppercase tracking-wider">{a.label}</p>
            <p className="text-sm text-t1 break-words">{a.value || '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
