'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt';
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'];

export interface StagedFile { id: string; file: File; url: string }

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const isImage = (f: File) => f.type.startsWith('image/');
const isPdf = (f: File) => f.type === 'application/pdf' || extOf(f.name) === 'pdf';

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Files waiting in the composer, with object URLs for previews. */
export function useStagedFiles(onReject: (message: string) => void) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  useEffect(() => () => stagedRef.current.forEach(s => URL.revokeObjectURL(s.url)), []);

  const add = useCallback((files: File[]) => {
    const ok: StagedFile[] = [];
    for (const file of files) {
      if (!isImage(file) && !ALLOWED_EXT.includes(extOf(file.name))) {
        onReject(`${file.name}: this file type can't be sent`); continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        onReject(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}`); continue;
      }
      ok.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, url: URL.createObjectURL(file) });
    }
    if (ok.length) setStaged(prev => [...prev, ...ok]);
  }, [onReject]);

  const remove = useCallback((id: string) => {
    setStaged(prev => {
      const gone = prev.find(s => s.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter(s => s.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setStaged(prev => { prev.forEach(s => URL.revokeObjectURL(s.url)); return []; });
  }, []);

  return { staged, add, remove, clear };
}

/** Drag handlers for a container; `dragging` drives the drop overlay. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  if (!enabled) return { dragging: false, dropHandlers: {} };
  return {
    dragging,
    dropHandlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'color-mix(in srgb, var(--im-chrome) 85%, transparent)' }}>
      <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#0a84ff] text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mb-3 h-10 w-10 text-[#0a84ff]">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <p className="text-[17px] font-semibold text-t1">Drop to attach</p>
        <p className="mt-1 text-[13px] im-sub">Images, PDF, Word, Excel or text — up to {formatBytes(MAX_FILE_BYTES)}</p>
      </div>
    </div>
  );
}

function FileGlyph({ file, className }: { file: File; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl bg-[#0a84ff]/12 text-[#0a84ff] ${className ?? ''}`}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
      <span className="mt-0.5 text-[11px] font-bold uppercase">{extOf(file.name) || 'file'}</span>
    </div>
  );
}

/** Preview of everything staged, shown above the composer until sent or cancelled. */
export function AttachmentTray({
  staged, onRemove, onClear, onAddMore, onSend, sending,
}: {
  staged: StagedFile[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onAddMore: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!staged.length) return null;
  const selected = staged.find(s => s.id === selectedId) ?? staged[staged.length - 1];
  const total = staged.reduce((n, s) => n + s.file.size, 0);

  return (
    <div className="flex-shrink-0 border-t im-chrome px-4 pt-3 sm:px-5 animate-slide-up" role="region" aria-label="Attachments to send">
      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--im-hairline)', background: 'var(--im-field-bg)' }}>
        <div className="flex h-56 items-center justify-center p-2 sm:h-64" style={{ background: 'var(--im-quote)' }}>
          {isImage(selected.file) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.url} alt={selected.file.name} className="max-h-full max-w-full rounded-lg object-contain" />
          ) : isPdf(selected.file) ? (
            <iframe src={`${selected.url}#toolbar=0&navpanes=0`} title={selected.file.name} className="h-full w-full rounded-lg bg-white" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <FileGlyph file={selected.file} className="h-16 w-16" />
              <p className="max-w-[260px] truncate text-[13px] font-medium text-t1">{selected.file.name}</p>
              <p className="text-[12px] im-sub">No preview for this file type</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2.5 pt-3.5">
          {staged.map(s => {
            const active = s.id === selected.id;
            return (
              <div key={s.id} className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  title={`${s.file.name} · ${formatBytes(s.file.size)}`}
                  aria-pressed={active}
                  className={`block h-14 w-14 overflow-hidden rounded-xl border-2 transition ${active ? 'border-[#0a84ff]' : 'border-transparent opacity-80 hover:opacity-100'}`}
                >
                  {isImage(s.file)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.url} alt="" className="h-full w-full object-cover" />
                    : <FileGlyph file={s.file} className="h-full w-full rounded-none" />}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(s.id)}
                  disabled={sending}
                  aria-label={`Remove ${s.file.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#8e8e93] text-white shadow disabled:opacity-40"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={onAddMore}
            disabled={sending}
            aria-label="Add more files"
            className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl border-2 border-dashed im-sub transition hover:text-[#0a84ff] disabled:opacity-40"
            style={{ borderColor: 'var(--im-field-line)' }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
          </button>
        </div>

        <div className="flex items-center gap-3 border-t px-3 py-2.5" style={{ borderColor: 'var(--im-hairline)' }}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-t1">{selected.file.name}</p>
            <p className="text-[12px] im-sub">
              {staged.length > 1 ? `${staged.length} files · ${formatBytes(total)}` : formatBytes(selected.file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={sending}
            className="min-h-[44px] rounded-full px-4 text-[15px] font-medium im-sub transition hover:opacity-70 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            className="flex min-h-[44px] items-center gap-2 rounded-full im-send px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-60"
          >
            {sending && (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {sending ? 'Sending…' : staged.length > 1 ? `Send ${staged.length}` : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
