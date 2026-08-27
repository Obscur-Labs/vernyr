'use client';

import { useState } from 'react';
import type { DocType, FormField } from '@/types';
import { DOC_LABELS } from './MessageCards';

/* ── Shared modal chrome ─────────────────────────────────────────────────── */
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="overlay-scrim animate-backdrop-in fixed inset-0 z-40" onClick={onClose} />
      <div className="overlay-panel animate-overlay-in fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] max-w-[500px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-t1">{title}</h3>
          <button onClick={onClose} className="text-t3 hover:text-t1 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </>
  );
}

/* ── Request documents modal ─────────────────────────────────────────────── */
export function RequestDocsModal({
  onClose, onSubmit, busy,
}: {
  onClose: () => void;
  onSubmit: (items: Array<{ type: DocType; label: string; note?: string }>) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<Set<DocType>>(new Set());
  const [otherLabel, setOtherLabel] = useState('');
  const [note, setNote] = useState('');

  function toggle(t: DocType) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  function submit() {
    const items = [...selected].map(type => ({
      type,
      label: type === 'other' && otherLabel.trim() ? otherLabel.trim() : DOC_LABELS[type],
      note: note.trim() || undefined,
    }));
    if (items.length === 0) return;
    onSubmit(items);
  }

  return (
    <ModalShell title="Request Documents" onClose={onClose}>
      <p className="text-sm text-t2 mb-3">Select the documents the student should upload:</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {(Object.entries(DOC_LABELS) as [DocType, string][]).map(([type, label]) => (
          <button
            key={type}
            onClick={() => toggle(type)}
            className={`px-3 py-2 rounded-xl border text-sm text-left transition ${
              selected.has(type)
                ? 'border-accent bg-accent/10 text-accent font-semibold'
                : 'border-line bg-card text-t2 hover:border-accent/40'
            }`}
          >
            {selected.has(type) ? '✓ ' : ''}{label}
          </button>
        ))}
      </div>
      {selected.has('other') && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Custom document name</label>
          <input
            value={otherLabel}
            onChange={e => setOtherLabel(e.target.value)}
            placeholder="e.g. Gap-year affidavit"
            className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
          />
        </div>
      )}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Note for the student (optional)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. Needed before we file your visa…"
          className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition resize-none"
        />
      </div>
      <button
        onClick={submit}
        disabled={selected.size === 0 || busy}
        className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition"
      >
        {busy ? 'Sending…' : `Request ${selected.size || ''} Document${selected.size === 1 ? '' : 's'}`}
      </button>
    </ModalShell>
  );
}

/* ── Request details (form builder) modal ────────────────────────────────── */
export function RequestFormModal({
  onClose, onSubmit, busy,
}: {
  onClose: () => void;
  onSubmit: (title: string, fields: FormField[]) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<string[]>(['']);

  function setField(i: number, v: string) {
    setFields(prev => prev.map((f, idx) => idx === i ? v : f));
  }

  function submit() {
    const clean = fields.map(f => f.trim()).filter(Boolean);
    if (!title.trim() || clean.length === 0) return;
    onSubmit(title.trim(), clean.map((label, i) => ({ id: `f${i + 1}`, label, required: true })));
  }

  return (
    <ModalShell title="Request Details" onClose={onClose}>
      <p className="text-sm text-t2 mb-4">
        Send a short form in the chat — the student fills it in without leaving the conversation.
      </p>
      <div className="mb-4">
        <label className="block text-xs font-semibold text-t2 mb-1.5 uppercase tracking-wider">Form title</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Passport details"
          className="w-full bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
        />
      </div>
      <div className="mb-4 space-y-2">
        <label className="block text-xs font-semibold text-t2 uppercase tracking-wider">Questions</label>
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={f}
              onChange={e => setField(i, e.target.value)}
              placeholder={`Question ${i + 1} — e.g. Passport number`}
              className="flex-1 bg-muted border border-line rounded-xl px-3 py-2.5 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
            />
            {fields.length > 1 && (
              <button
                onClick={() => setFields(prev => prev.filter((_, idx) => idx !== i))}
                className="w-8 h-8 rounded-lg text-t3 hover:text-red-400 hover:bg-muted flex-shrink-0"
                title="Remove question"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => setFields(prev => [...prev, ''])}
          className="text-sm text-accent font-semibold hover:underline"
        >
          + Add question
        </button>
      </div>
      <button
        onClick={submit}
        disabled={!title.trim() || fields.every(f => !f.trim()) || busy}
        className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition"
      >
        {busy ? 'Sending…' : 'Send Form'}
      </button>
    </ModalShell>
  );
}
