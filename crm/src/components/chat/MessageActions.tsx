'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';
import type { Message } from '@/types';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => <div className="h-[340px] animate-pulse rounded-2xl bg-muted" />,
});

export const DEFAULT_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏'];
const QUICK_KEY = 'vernyr-quick-reactions';
const APPLE_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/';

/** The five reactions offered first. Each person can change theirs; kept in this browser. */
export function useQuickReactions(): [string[], (next: string[]) => void] {
  const [list, setList] = useState(DEFAULT_QUICK_REACTIONS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUICK_KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length === 5 && saved.every(e => typeof e === 'string')) setList(saved);
    } catch { /* keep defaults */ }
  }, []);
  const save = useCallback((next: string[]) => {
    setList(next);
    try { localStorage.setItem(QUICK_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);
  return [list, save];
}

const unifiedOf = (emoji: string) =>
  Array.from(emoji).map(c => c.codePointAt(0)!.toString(16)).join('-');

/** An emoji drawn with Apple's artwork, falling back to the platform glyph. */
export function AppleEmoji({ emoji, size = 22 }: { emoji: string; size?: number }) {
  const full = unifiedOf(emoji);
  const [src, setSrc] = useState<string | null>(`${APPLE_CDN}${full}.png`);
  useEffect(() => { setSrc(`${APPLE_CDN}${unifiedOf(emoji)}.png`); }, [emoji]);
  if (!src) return <span style={{ fontSize: size * 0.9, lineHeight: 1 }}>{emoji}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={emoji}
      width={size}
      height={size}
      draggable={false}
      className="inline-block select-none"
      onError={() => {
        const stripped = full.split('-').filter(p => p !== 'fe0f').join('-');
        setSrc(src.endsWith(`/${full}.png`) && stripped !== full ? `${APPLE_CDN}${stripped}.png` : null);
      }}
    />
  );
}

function useDarkTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(!el.classList.contains('light'));
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export const senderIdOf = (msg: Message): string => {
  const s = msg.senderId as string | { _id: string };
  return typeof s === 'object' && s ? s._id : s;
};

/** Text a message contributes when copied. */
export function copyTextOf(msg: Message): string {
  if (msg.deletedForEveryone) return '';
  if (msg.type === 'file') return msg.fileName ?? 'File';
  if (msg.type === 'form_request') return msg.meta?.title ?? 'Details requested';
  if (msg.type === 'form_response') return (msg.meta?.answers ?? []).map(a => `${a.label}: ${a.value}`).join('\n');
  return msg.text ?? '';
}

/** Scroll a message into view and flash it. Returns false when it is not loaded. */
export function jumpToMessage(id: string): boolean {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('msg-flash');
  void el.offsetWidth;
  el.classList.add('msg-flash');
  return true;
}

/* ── Icons ───────────────────────────────────────────────────────────────── */
const I = {
  reply: 'M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z',
  copy: 'M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2v-1h1a2 2 0 002-2V4a2 2 0 00-2-2H8zm4 13v1H5V7h1v6a2 2 0 002 2h4zm-4-2V4h7v9H8z',
  star: 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z',
  pin: 'M11.3 1.046a1 1 0 00-1.6.8v3.086L6.743 7.89a3 3 0 00-2.121.879l-.707.707a1 1 0 000 1.414l2.829 2.828-3.536 3.536a1 1 0 101.414 1.414l3.536-3.535 2.828 2.828a1 1 0 001.414 0l.707-.707a3 3 0 00.879-2.121l2.957-2.957h3.086a1 1 0 00.8-1.6l-7.53-7.529z',
  select: 'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z',
  edit: 'M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z',
  trash: 'M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z',
  open: 'M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5zM5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z',
  close: 'M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z',
  plus: 'M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z',
};
export type IconName = keyof typeof I;
export function Icon({ name, className = 'h-[18px] w-[18px]' }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden><path fillRule="evenodd" clipRule="evenodd" d={I[name]} /></svg>;
}

/* ── Gestures: right-click, long-press, swipe-to-reply, tap-to-select ────── */
const isField = (t: EventTarget) => !!(t as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]');

export function MessageGesture({
  children, id, align, selecting, selected, canReply, onMenu, onReply, onToggleSelect,
}: {
  children: React.ReactNode;
  id: string;
  align: 'left' | 'right';
  selecting: boolean;
  selected: boolean;
  canReply: boolean;
  onMenu: (x: number, y: number, touch: boolean) => void;
  onReply: () => void;
  onToggleSelect: () => void;
}) {
  const start = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout> | null; swiping: boolean; fired: boolean } | null>(null);
  const [dx, setDx] = useState(0);

  const end = () => {
    if (start.current?.t) clearTimeout(start.current.t);
    if (start.current?.swiping && dx > 56 && canReply) {
      navigator.vibrate?.(8);
      onReply();
    }
    start.current = null;
    setDx(0);
  };

  return (
    <div
      id={`msg-${id}`}
      data-selected={selected || undefined}
      className={`relative rounded-2xl transition-colors ${selecting ? 'cursor-pointer' : ''} ${selected ? 'bg-[#0a84ff]/10' : ''}`}
      style={{ touchAction: 'pan-y' }}
      onContextMenu={(e) => {
        if (isField(e.target)) return;
        e.preventDefault();
        if (selecting) { onToggleSelect(); return; }
        if (start.current?.fired) return;
        onMenu(e.clientX, e.clientY, false);
      }}
      onClickCapture={(e) => {
        if (!selecting) return;
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect();
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || isField(e.target)) return;
        const x = e.clientX, y = e.clientY;
        start.current = {
          x, y, swiping: false, fired: false,
          t: setTimeout(() => {
            if (!start.current || start.current.swiping) return;
            start.current.fired = true;
            navigator.vibrate?.(12);
            if (selecting) onToggleSelect(); else onMenu(x, y, true);
          }, 450),
        };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || e.pointerType !== 'touch') return;
        const mx = e.clientX - s.x, my = e.clientY - s.y;
        if (!s.swiping && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
          if (s.t) clearTimeout(s.t);
          s.t = null;
          s.swiping = !selecting && canReply && mx > 8 && Math.abs(mx) > Math.abs(my);
        }
        if (s.swiping) setDx(Math.max(0, Math.min(mx, 80)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {dx > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[#0a84ff]/15 text-[#0a84ff]"
          style={{ left: 4, opacity: Math.min(1, dx / 56), transform: `translateY(-50%) scale(${dx > 56 ? 1.1 : 0.9})` }}
        >
          <Icon name="reply" className="h-4 w-4" />
        </span>
      )}
      <div className="flex items-center gap-2" style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform 200ms ease-out' }}>
        {selecting && align === 'left' && <SelectDot selected={selected} />}
        <div className="min-w-0 flex-1">{children}</div>
        {selecting && align === 'right' && <SelectDot selected={selected} />}
      </div>
    </div>
  );
}

function SelectDot({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${selected ? 'border-[#0a84ff] bg-[#0a84ff] text-white' : 'border-[#8e8e93]/60'}`}>
      {selected && <Icon name="select" className="h-3.5 w-3.5" />}
    </span>
  );
}

/* ── Context menu / action sheet ─────────────────────────────────────────── */
export interface MenuAction {
  key: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
}

export function MessageMenu({
  x, y, sheet: sheetRequested, myReaction, onReact, actions, onClose,
}: {
  x: number;
  y: number;
  sheet: boolean;
  myReaction?: string;
  onReact?: (emoji: string) => void;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [mode, setMode] = useState<'menu' | 'picker' | 'edit'>('menu');
  const [sheet] = useState(() => sheetRequested || window.innerWidth < 640 || window.innerHeight < 520);
  const [slot, setSlot] = useState(0);
  const [quick, setQuick] = useQuickReactions();
  const dark = useDarkTheme();

  useLayoutEffect(() => {
    const el = ref.current;
    if (sheet || !el) return;
    const fit = () => {
      // offset* ignores the entry animation's scale, so the measurement is the real size.
      const width = el.offsetWidth, height = el.offsetHeight;
      setPos({
        left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
      });
    };
    fit();
    const obs = new ResizeObserver(fit);
    obs.observe(el);
    return () => obs.disconnect();
  }, [x, y, sheet, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mode === 'menu') onClose(); else setMode('menu');
    };
    const onScroll = (e: Event) => {
      if (!sheet && !ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, sheet, mode]);

  const run = (fn: () => void) => { onClose(); fn(); };

  const picked = (data: EmojiClickData) => {
    if (mode === 'edit') {
      const next = [...quick];
      next[slot] = data.emoji;
      setQuick(next);
      setSlot(s => (s + 1) % 5);
      return;
    }
    if (onReact) run(() => onReact(data.emoji));
  };

  const pickerHeight = Math.max(220, Math.min(340, window.innerHeight - (mode === 'edit' ? 260 : 150)));
  const picker = (
    <div className="px-2 pb-2">
      <EmojiPicker
        onEmojiClick={picked}
        emojiStyle={EmojiStyle.APPLE}
        theme={dark ? Theme.DARK : Theme.LIGHT}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
        width="100%"
        height={pickerHeight}
        searchPlaceHolder="Search emoji"
      />
    </div>
  );

  const body = (
    <>
      {onReact && mode === 'menu' && (
        <div className="flex items-center justify-between gap-0.5 border-b border-line p-2">
          {quick.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => run(() => onReact(e))}
              aria-label={`React ${e}`}
              aria-pressed={myReaction === e}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-90 ${myReaction === e ? 'bg-[#0a84ff]/20' : 'hover:bg-muted'}`}
            >
              <AppleEmoji emoji={e} size={26} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMode('picker')}
            aria-label="All emoji"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-t2 transition hover:text-t1"
          >
            <Icon name="plus" className="h-5 w-5" />
          </button>
        </div>
      )}

      {onReact && mode !== 'menu' && (
        <div className="border-b border-line">
          <div className="flex items-center gap-2 px-2 pt-2">
            <button
              type="button"
              onClick={() => setMode('menu')}
              aria-label="Back"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-t2 hover:bg-muted"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            </button>
            <p className="flex-1 text-[15px] font-semibold text-t1">
              {mode === 'edit' ? 'Quick reactions' : 'React'}
            </p>
            <button
              type="button"
              onClick={() => { setMode(mode === 'edit' ? 'picker' : 'edit'); setSlot(0); }}
              className="min-h-[44px] rounded-xl px-3 text-[15px] font-semibold text-[#0a84ff] hover:bg-muted"
            >
              {mode === 'edit' ? 'Done' : 'Edit'}
            </button>
          </div>

          {mode === 'edit' && (
            <div className="px-3 pb-1 pt-1">
              <p className="text-[12px] text-t3">Tap a slot, then pick its emoji.</p>
              <div className="mt-2 flex items-center justify-between gap-1">
                {quick.map((e, i) => (
                  <button
                    key={`slot-${i}`}
                    type="button"
                    onClick={() => setSlot(i)}
                    aria-label={`Slot ${i + 1}: ${e}`}
                    aria-pressed={slot === i}
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition ${slot === i ? 'border-[#0a84ff] bg-[#0a84ff]/10' : 'border-transparent bg-muted'}`}
                  >
                    <AppleEmoji emoji={e} size={26} />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setQuick(DEFAULT_QUICK_REACTIONS)}
                className="mt-1 min-h-[36px] text-[12px] font-medium text-t3 hover:text-t1"
              >
                Reset to defaults
              </button>
            </div>
          )}
          {picker}
        </div>
      )}

      {mode === 'menu' && (
        <div role="menu" className="p-1.5">
          {actions.map(a => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              onClick={() => run(a.onSelect)}
              className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition ${a.danger ? 'text-red-500 hover:bg-red-500/10' : 'text-t1 hover:bg-muted'}`}
            >
              <Icon name={a.icon} className={`h-[18px] w-[18px] ${a.danger ? '' : 'text-t3'}`} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );

  if (sheet) {
    return (
      <div className="fixed inset-0 z-[70]" onContextMenu={e => e.preventDefault()}>
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
        <div
          ref={ref}
          className="animate-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-md overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-surface shadow-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-[#8e8e93]/40" aria-hidden />
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70]" onMouseDown={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        onMouseDown={e => e.stopPropagation()}
        className={`animate-scale-in absolute overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface shadow-2xl ${mode === 'menu' ? 'w-[min(300px,calc(100vw-16px))]' : 'w-[min(340px,calc(100vw-16px))]'}`}
        style={{ left: pos.left, top: pos.top, maxHeight: 'calc(100dvh - 16px)' }}
      >
        {body}
      </div>
    </div>
  );
}

/* ── Reactions under a bubble ────────────────────────────────────────────── */
export function ReactionChips({
  reactions, myId, align, onToggle,
}: {
  reactions?: { userId: string; emoji: string }[];
  myId: string;
  align: 'left' | 'right';
  onToggle?: (emoji: string) => void;
}) {
  if (!reactions?.length) return null;
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (String(r.userId) === myId) g.mine = true;
    groups.set(r.emoji, g);
  }
  return (
    <div className={`-mt-1 flex flex-wrap gap-1 px-1 ${align === 'right' ? 'justify-end' : ''}`}>
      {[...groups].map(([emoji, g]) => (
        <button
          key={emoji}
          type="button"
          disabled={!onToggle}
          onClick={() => onToggle?.(emoji)}
          aria-label={`${emoji} ${g.count}${g.mine ? ', including you' : ''}`}
          className={`flex min-h-[28px] items-center gap-1 rounded-full border px-2 text-[13px] shadow-sm transition active:scale-95 ${
            g.mine ? 'border-[#0a84ff]/50 bg-[#0a84ff]/15' : 'border-line bg-surface'
          }`}
        >
          <AppleEmoji emoji={emoji} size={16} />
          {g.count > 1 && <span className="text-[12px] font-semibold text-t2">{g.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Pinned messages bar ─────────────────────────────────────────────────── */
export function PinnedBar({
  pins, preview, onJump, onUnpin,
}: {
  pins: Message[];
  preview: (m: Message) => string;
  onJump: (m: Message) => void;
  onUnpin?: (m: Message) => void;
}) {
  const [idx, setIdx] = useState(0);
  if (!pins.length) return null;
  const current = pins[Math.min(idx, pins.length - 1)];
  return (
    <div className="flex shrink-0 items-center gap-2 border-b im-chrome px-3 py-1.5 sm:px-5">
      <div className="flex flex-col gap-0.5 self-stretch py-1" aria-hidden>
        {pins.map((p, i) => (
          <span key={p._id} className={`w-[3px] flex-1 rounded-full ${i === Math.min(idx, pins.length - 1) ? 'bg-[#0a84ff]' : 'bg-[#8e8e93]/40'}`} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => { onJump(current); setIdx(i => (i + 1) % pins.length); }}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left"
        aria-label={`Pinned message ${Math.min(idx, pins.length - 1) + 1} of ${pins.length}. Jump to it`}
      >
        <Icon name="pin" className="h-4 w-4 shrink-0 text-[#0a84ff]" />
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold text-[#0a84ff]">
            Pinned{pins.length > 1 ? ` · ${Math.min(idx, pins.length - 1) + 1}/${pins.length}` : ''} · {current.senderName}
          </span>
          <span className="block truncate text-[13px] text-t2">{preview(current)}</span>
        </span>
      </button>
      {onUnpin && (
        <button
          type="button"
          onClick={() => onUnpin(current)}
          aria-label="Unpin"
          title="Unpin"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl im-sub transition hover:bg-muted"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/* ── Multi-select toolbar ────────────────────────────────────────────────── */
export function SelectionBar({
  count, onCancel, onCopy, onStar, onDelete,
}: {
  count: number;
  onCancel: () => void;
  onCopy: () => void;
  onStar?: () => void;
  onDelete?: () => void;
}) {
  const btn = 'flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold transition disabled:opacity-40';
  return (
    <div className="flex shrink-0 items-center gap-1 border-b im-chrome px-2 py-1.5 sm:px-4 animate-fade-in" role="toolbar" aria-label="Selected messages">
      <button type="button" onClick={onCancel} aria-label="Cancel selection" className={`${btn} im-sub hover:bg-muted`}>
        <Icon name="close" className="h-5 w-5" />
      </button>
      <p className="flex-1 text-[15px] font-semibold text-t1">{count} selected</p>
      <button type="button" onClick={onCopy} disabled={!count} className={`${btn} text-t2 hover:bg-muted`}>
        <Icon name="copy" /> <span className="hidden sm:inline">Copy</span>
      </button>
      {onStar && (
        <button type="button" onClick={onStar} disabled={!count} className={`${btn} text-t2 hover:bg-muted`}>
          <Icon name="star" /> <span className="hidden sm:inline">Star</span>
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} disabled={!count} className={`${btn} text-red-500 hover:bg-red-500/10`}>
          <Icon name="trash" /> <span className="hidden sm:inline">Delete</span>
        </button>
      )}
    </div>
  );
}

/* ── Delete confirmation ─────────────────────────────────────────────────── */
export function DeleteDialog({
  count, canEveryone, onChoose, onClose,
}: {
  count: number;
  canEveryone: boolean;
  onChoose: (scope: 'me' | 'everyone') => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const btn = 'flex h-12 w-full items-center justify-center rounded-xl text-[15px] font-semibold transition';
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="animate-scale-in relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl border border-line bg-surface p-5 shadow-2xl">
        <h2 id="delete-title" className="text-[17px] font-semibold text-t1">
          Delete {count > 1 ? `${count} messages` : 'message'}?
        </h2>
        <p className="mt-1 text-[13px] text-t3">
          {canEveryone
            ? '“Delete for everyone” leaves a note that a message was removed.'
            : 'This removes it from your view only.'}
        </p>
        <div className="mt-4 space-y-2">
          {canEveryone && (
            <button type="button" onClick={() => onChoose('everyone')} className={`${btn} bg-red-500 text-white hover:bg-red-600`}>
              Delete for everyone
            </button>
          )}
          <button type="button" onClick={() => onChoose('me')} className={`${btn} ${canEveryone ? 'bg-red-500/10 text-red-500 hover:bg-red-500/15' : 'bg-red-500 text-white hover:bg-red-600'}`}>
            Delete for me
          </button>
          <button type="button" onClick={onClose} className={`${btn} bg-muted text-t1 hover:opacity-80`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Starred messages panel ──────────────────────────────────────────────── */
export function StarredPanel({
  items, loading, preview, onJump, onUnstar, onClose,
}: {
  items: Message[];
  loading: boolean;
  preview: (m: Message) => string;
  onJump: (m: Message) => void;
  onUnstar: (m: Message) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-labelledby="starred-title">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div
        className="animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-h-[calc(100dvh-2rem)] sm:w-96 sm:rounded-3xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <Icon name="star" className="h-5 w-5 text-amber-400" />
          <h2 id="starred-title" className="flex-1 text-[17px] font-semibold text-t1">Starred messages</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-xl text-t3 hover:bg-muted">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-6 text-center text-[13px] text-t3">Loading…</p>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[15px] font-medium text-t2">No starred messages</p>
              <p className="mt-1 text-[13px] text-t3">Right-click or long-press a message and choose Star to keep it here.</p>
            </div>
          ) : (
            items.map(m => (
              <div key={m._id} className="flex items-start gap-2 rounded-2xl p-2 hover:bg-muted">
                <button type="button" onClick={() => onJump(m)} className="min-h-[44px] min-w-0 flex-1 text-left">
                  <p className="text-[12px] font-semibold text-t2">
                    {m.senderName} · <span className="font-normal text-t3">{new Date(m.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  <p className="line-clamp-2 text-[15px] text-t1">{preview(m)}</p>
                </button>
                <button type="button" onClick={() => onUnstar(m)} aria-label="Unstar" title="Unstar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-amber-400 hover:bg-muted">
                  <Icon name="star" className="h-5 w-5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


/* ── Emoji button beside the message box ─────────────────────────────────── */
export function ComposerEmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; bottom: number; width: number; height: number } | null>(null);
  const dark = useDarkTheme();
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(340, window.innerWidth - 16);
      setBox({
        width,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - r.top + 8,
        height: Math.max(220, Math.min(380, r.top - 16)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Insert emoji"
        aria-expanded={open}
        title="Emoji"
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${open ? 'bg-[#0a84ff]/15 text-[#0a84ff]' : 'im-sub hover:bg-muted hover:text-t1'}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5a4.5 4.5 0 007 0" />
          <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
        </svg>
      </button>
      {open && box && (
        <div
          className="animate-scale-in fixed z-[60] origin-bottom-left overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
          style={{ left: box.left, bottom: box.bottom, width: box.width }}
        >
          <EmojiPicker
            onEmojiClick={(d: EmojiClickData) => onPick(d.emoji)}
            emojiStyle={EmojiStyle.APPLE}
            theme={dark ? Theme.DARK : Theme.LIGHT}
            lazyLoadEmojis
            previewConfig={{ showPreview: false }}
            width="100%"
            height={box.height}
            searchPlaceHolder="Search emoji"
          />
        </div>
      )}
    </div>
  );
}

/* ── One hook behind every message action ────────────────────────────────── */
type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

interface ApiLike {
  get: <T>(url: string) => Promise<{ data: T }>;
  post: <T>(url: string, body?: unknown) => Promise<{ data: T }>;
  delete: <T>(url: string) => Promise<{ data: T }>;
}

export function useMessageActions({
  api, convId, myId, messages, setMessages, toast, preview,
  canInteract, canStar, canDelete, onReply, onEdit, openFile, openInDocuments,
}: {
  api: ApiLike;
  convId: string | null;
  myId: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  toast: Toast;
  preview: (m: Message) => string;
  /** Reply, react, pin and edit — participants of an open thread */
  canInteract: boolean;
  /** Star — any participant, open or closed thread */
  canStar: boolean;
  /** Delete for me — any participant */
  canDelete: boolean;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  openFile: (m: Message) => void;
  openInDocuments: (m: Message) => void;
}) {
  const [menu, setMenu] = useState<{ msg: Message; x: number; y: number; sheet: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [confirm, setConfirm] = useState<{ ids: string[]; canEveryone: boolean } | null>(null);
  const [starredOpen, setStarredOpen] = useState(false);
  const [starred, setStarred] = useState<Message[]>([]);
  const [starredLoading, setStarredLoading] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;

  const errorOf = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

  const loadPins = useCallback((id: string) => {
    apiRef.current.get<Message[]>(`/messages/${id}/pinned`).then(r => setPins(r.data)).catch(() => setPins([]));
  }, []);

  useEffect(() => {
    setMenu(null);
    setSelected(new Set());
    setSelecting(false);
    setConfirm(null);
    setStarredOpen(false);
    setPins([]);
    if (convId) loadPins(convId);
  }, [convId, loadPins]);

  const patch = useCallback((id: string, fields: Partial<Message>) => {
    setMessages(prev => prev.map(m => (m._id === id ? { ...m, ...fields } : m)));
  }, [setMessages]);

  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  /** Call for every `message_updated` socket event. */
  const onMessageUpdated = useCallback((msg: Message) => {
    if (!convId || msg.conversationId !== convId) return;
    const had = pinsRef.current.some(p => p._id === msg._id);
    if (had !== !!msg.pinnedAt || (had && msg.deletedForEveryone)) loadPins(convId);
  }, [convId, loadPins]);

  /** Call for the `message_starred` socket event — keeps other tabs in step. */
  const onStarredEvent = useCallback(({ messageId, starred: on }: { messageId: string; starred: boolean }) => {
    patch(messageId, { starred: on });
    if (!on) setStarred(prev => prev.filter(m => m._id !== messageId));
  }, [patch]);

  const react = useCallback(async (msg: Message, emoji: string) => {
    const mine = msg.reactions?.find(r => String(r.userId) === myId);
    const others = (msg.reactions ?? []).filter(r => String(r.userId) !== myId);
    patch(msg._id, { reactions: mine?.emoji === emoji ? others : [...others, { userId: myId, emoji }] });
    try {
      const { data } = await apiRef.current.post<Message>(`/messages/message/${msg._id}/react`, { emoji });
      patch(msg._id, { reactions: data.reactions });
    } catch (err) {
      patch(msg._id, { reactions: msg.reactions });
      toast(errorOf(err, 'Could not react'), 'error');
    }
  }, [myId, patch, toast]);

  const star = useCallback(async (list: Message[], on: boolean) => {
    if (!list.length) return;
    list.forEach(m => patch(m._id, { starred: on }));
    try {
      await Promise.all(list.map(m => apiRef.current.post(`/messages/message/${m._id}/star`, { starred: on })));
      toast(on ? (list.length > 1 ? `Starred ${list.length} messages` : 'Starred') : 'Unstarred', 'success');
      if (!on) setStarred(prev => prev.filter(s => !list.some(m => m._id === s._id)));
    } catch (err) {
      list.forEach(m => patch(m._id, { starred: !on }));
      toast(errorOf(err, 'Could not update star'), 'error');
    }
  }, [patch, toast]);

  const pin = useCallback(async (msg: Message, on: boolean) => {
    try {
      const { data } = await apiRef.current.post<Message>(`/messages/message/${msg._id}/pin`, { pinned: on });
      patch(msg._id, { pinnedAt: data.pinnedAt, pinnedBy: data.pinnedBy });
      if (convId) loadPins(convId);
      toast(on ? 'Pinned for everyone in this chat' : 'Unpinned', 'success');
    } catch (err) {
      toast(errorOf(err, 'Could not update pin'), 'error');
    }
  }, [convId, loadPins, patch, toast]);

  const copy = useCallback(async (list: Message[]) => {
    if (!list.length) return;
    const ordered = [...list].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const text = ordered.length === 1
      ? copyTextOf(ordered[0])
      : ordered.map(m => `[${new Date(m.createdAt).toLocaleString()}] ${m.senderName}: ${copyTextOf(m)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(list.length > 1 ? `Copied ${list.length} messages` : 'Copied', 'success');
    } catch {
      toast('Could not copy', 'error');
    }
  }, [toast]);

  const askDelete = useCallback((list: Message[]) => {
    if (!list.length) return;
    const canEveryone = canInteract && list.every(m => !m.deletedForEveryone && senderIdOf(m) === myId);
    setConfirm({ ids: list.map(m => m._id), canEveryone });
  }, [canInteract, myId]);

  const doDelete = useCallback(async (scope: 'me' | 'everyone') => {
    if (!confirm) return;
    const { ids } = confirm;
    setConfirm(null);
    try {
      if (ids.length === 1) await apiRef.current.delete(`/messages/message/${ids[0]}?scope=${scope}`);
      else await apiRef.current.post('/messages/message/bulk-delete', { ids, scope });
      if (scope === 'me') {
        setMessages(prev => prev.filter(m => !ids.includes(m._id)));
      } else {
        setMessages(prev => prev.map(m => (ids.includes(m._id)
          ? { ...m, deletedForEveryone: true, text: '', fileUrl: undefined, fileName: undefined, meta: undefined, replyTo: undefined, reactions: [], pinnedAt: undefined }
          : m)));
      }
      setSelected(new Set());
      setSelecting(false);
      if (convId && pinsRef.current.some(p => ids.includes(p._id))) loadPins(convId);
      toast(ids.length > 1 ? `Deleted ${ids.length} messages` : 'Message deleted', 'success');
    } catch (err) {
      toast(errorOf(err, 'Could not delete'), 'error');
    }
  }, [confirm, convId, loadPins, setMessages, toast]);

  const jump = useCallback((id: string) => {
    if (!jumpToMessage(id)) toast('That message is too far back to show here', 'info');
  }, [toast]);

  const openStarred = useCallback(() => {
    if (!convId) return;
    setStarredOpen(true);
    setStarredLoading(true);
    apiRef.current.get<Message[]>(`/messages/${convId}/starred`)
      .then(r => setStarred(r.data))
      .catch(() => toast('Could not load starred messages', 'error'))
      .finally(() => setStarredLoading(false));
  }, [convId, toast]);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) setSelecting(false);
      return next;
    });
  }, []);

  const startSelect = useCallback((id: string) => {
    setSelecting(true);
    setSelected(new Set([id]));
  }, []);

  const cancelSelect = useCallback(() => { setSelecting(false); setSelected(new Set()); }, []);

  const openMenu = useCallback((msg: Message, x: number, y: number, sheet: boolean) => {
    if (msg.type === 'system') return;
    setMenu({ msg, x, y, sheet });
  }, []);

  const menuActions = (msg: Message): MenuAction[] => {
    const tomb = !!msg.deletedForEveryone;
    const mine = senderIdOf(msg) === myId;
    const list: MenuAction[] = [];
    if (!tomb && canInteract) list.push({ key: 'reply', label: 'Reply', icon: 'reply', onSelect: () => onReply(msg) });
    if (!tomb && msg.type === 'file' && msg.fileUrl) list.push({ key: 'open', label: 'Open file', icon: 'open', onSelect: () => openFile(msg) });
    if (!tomb && msg.meta?.documentId) list.push({ key: 'docs', label: 'Open in Documents', icon: 'open', onSelect: () => openInDocuments(msg) });
    if (!tomb && copyTextOf(msg)) list.push({ key: 'copy', label: 'Copy', icon: 'copy', onSelect: () => copy([msg]) });
    if (!tomb && canStar) list.push({ key: 'star', label: msg.starred ? 'Unstar' : 'Star', icon: 'star', onSelect: () => star([msg], !msg.starred) });
    if (!tomb && canInteract) list.push({ key: 'pin', label: msg.pinnedAt ? 'Unpin' : 'Pin', icon: 'pin', onSelect: () => pin(msg, !msg.pinnedAt) });
    if (!tomb && canInteract && mine && msg.type === 'text') list.push({ key: 'edit', label: 'Edit', icon: 'edit', onSelect: () => onEdit(msg) });
    list.push({ key: 'select', label: 'Select', icon: 'select', onSelect: () => startSelect(msg._id) });
    if (canDelete) list.push({ key: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => askDelete([msg]) });
    return list;
  };

  const selectedMessages = messages.filter(m => selected.has(m._id));

  const selectionBar = selecting ? (
    <SelectionBar
      count={selected.size}
      onCancel={cancelSelect}
      onCopy={() => copy(selectedMessages.filter(m => copyTextOf(m)))}
      onStar={canStar ? () => star(selectedMessages.filter(m => !m.deletedForEveryone), !selectedMessages.every(m => m.starred)) : undefined}
      onDelete={canDelete ? () => askDelete(selectedMessages) : undefined}
    />
  ) : null;

  const pinnedBar = !selecting && pins.length > 0 ? (
    <PinnedBar pins={pins} preview={preview} onJump={m => jump(m._id)} onUnpin={canInteract ? m => pin(m, false) : undefined} />
  ) : null;

  const overlays = (
    <>
      {menu && (
        <MessageMenu
          x={menu.x}
          y={menu.y}
          sheet={menu.sheet}
          myReaction={menu.msg.reactions?.find(r => String(r.userId) === myId)?.emoji}
          onReact={canInteract && !menu.msg.deletedForEveryone ? e => react(menu.msg, e) : undefined}
          actions={menuActions(menu.msg)}
          onClose={() => setMenu(null)}
        />
      )}
      {confirm && (
        <DeleteDialog count={confirm.ids.length} canEveryone={confirm.canEveryone} onChoose={doDelete} onClose={() => setConfirm(null)} />
      )}
      {starredOpen && (
        <StarredPanel
          items={starred}
          loading={starredLoading}
          preview={preview}
          onJump={m => { setStarredOpen(false); setTimeout(() => jump(m._id), 50); }}
          onUnstar={m => star([m], false)}
          onClose={() => setStarredOpen(false)}
        />
      )}
    </>
  );

  return {
    selecting, selected, toggleSelect, openMenu, react, jump, openStarred,
    onMessageUpdated, onStarredEvent, selectionBar, pinnedBar, overlays,
  };
}
