'use client';

import { useRef, useState } from 'react';
import type { Message, DocType, DocRequestStatus, DocRequestItem, FormAnswer } from '@/types';

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

/* ── Read-receipt ticks ──────────────────────────────────────────────────── */
export function Ticks({ read }: { read: boolean }) {
  return (
    <svg viewBox="0 0 18 12" fill="none" className={`inline-block w-4 h-3 ${read ? 'text-[#0a84ff]' : 'text-[#8e8e93]'}`} aria-label={read ? 'Read' : 'Sent'}>
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

/* ── Document-request card with per-item upload ──────────────────────────── */
export function DocRequestCard({
  msg, onUpload, uploadingId,
}: {
  msg: Message;
  onUpload: (item: DocRequestItem, file: File) => void;
  uploadingId: string | null;
}) {
  const items = msg.meta?.items ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickFor, setPickFor] = useState<DocRequestItem | null>(null);

  function choose(item: DocRequestItem) {
    setPickFor(item);
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && pickFor) onUpload(pickFor, file);
    if (fileRef.current) fileRef.current.value = '';
    setPickFor(null);
  }

  return (
    <div className="msg-bubble rounded-[18px] border im-card overflow-hidden w-72 max-w-full">
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={onFile} />
      <div className="px-3.5 py-2.5 bg-[#0a84ff]/10 border-b border-[#0a84ff]/20 flex items-center gap-2">
        <span className="text-base">📋</span>
        <p className="text-xs font-bold text-[#0a84ff] uppercase tracking-wider">Documents Requested</p>
      </div>
      <div className="divide-y divide-line">
        {items.map(item => (
          <div key={item.requestId} className="px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-t1 truncate">{item.label || DOC_LABELS[item.type]}</p>
                {item.note && <p className="text-xs text-t3">{item.note}</p>}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border capitalize flex-shrink-0 ${REQ_STATUS_STYLE[item.status]}`}>
                {item.status === 'fulfilled' ? '✓ uploaded' : item.status}
              </span>
            </div>
            {item.status === 'pending' && (
              <button
                onClick={() => choose(item)}
                disabled={uploadingId !== null}
                className="mt-2 w-full py-1.5 rounded-lg bg-[#0a84ff] text-white text-xs font-semibold hover:bg-[#0974e0] disabled:opacity-40 transition"
              >
                {uploadingId === item.requestId ? 'Uploading…' : '⬆ Upload now'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Form-request card (student fills it inline) ─────────────────────────── */
export function FormRequestCard({
  msg, canAnswer, onSubmit, busy,
}: {
  msg: Message;
  canAnswer: boolean;
  onSubmit: (formMessageId: string, answers: FormAnswer[]) => void;
  busy: boolean;
}) {
  const meta = msg.meta ?? {};
  const fields = meta.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});

  const answered = !!meta.answered;
  const complete = fields.every(f => !f.required || (values[f.id] ?? '').trim());

  function submit() {
    if (!complete) return;
    onSubmit(msg._id, fields.map(f => ({ id: f.id, label: f.label, value: (values[f.id] ?? '').trim() })));
  }

  return (
    <div className="msg-bubble rounded-[18px] border im-card overflow-hidden w-72 max-w-full">
      <div className="px-3.5 py-2.5 bg-violet-500/10 border-b border-violet-500/20 flex items-center gap-2">
        <span className="text-base">📝</span>
        <p className="text-xs font-bold text-violet-500 uppercase tracking-wider truncate">
          {meta.title || 'Details Requested'}
        </p>
      </div>
      <div className="px-3.5 py-3 space-y-2.5">
        {answered ? (
          <>
            {fields.map(f => (
              <p key={f.id} className="text-sm text-t2 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-t3 flex-shrink-0" />{f.label}
              </p>
            ))}
            <p className="text-xs font-semibold text-emerald-500 pt-1">✓ You answered this form</p>
          </>
        ) : canAnswer ? (
          <>
            {fields.map(f => (
              <div key={f.id}>
                <label className="block text-[11px] font-semibold text-t3 uppercase tracking-wider mb-1">
                  {f.label}{f.required && <span className="text-red-400"> *</span>}
                </label>
                <input
                  value={values[f.id] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                  placeholder="Type your answer…"
                  className="w-full bg-muted border border-line rounded-lg px-2.5 py-1.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
                />
              </div>
            ))}
            <button
              onClick={submit}
              disabled={!complete || busy}
              className="w-full py-1.5 rounded-lg bg-[#0a84ff] text-white text-xs font-semibold hover:bg-[#0974e0] disabled:opacity-40 transition"
            >
              {busy ? 'Sending…' : 'Submit answers'}
            </button>
          </>
        ) : (
          <>
            {fields.map(f => (
              <p key={f.id} className="text-sm text-t2 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-t3 flex-shrink-0" />{f.label}
              </p>
            ))}
            <p className="text-xs font-semibold text-amber-500 pt-1">Awaiting response…</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Form-response card ──────────────────────────────────────────────────── */
export function FormResponseCard({ msg }: { msg: Message }) {
  const meta = msg.meta ?? {};
  return (
    <div className="msg-bubble rounded-[18px] border im-card overflow-hidden w-72 max-w-full">
      <div className="px-3.5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-2">
        <span className="text-base">📝</span>
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
