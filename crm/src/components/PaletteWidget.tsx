'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { Palette } from '@/context/ThemeContext';

/* ─── palette definitions ─────────────────────────────────────────────────── */
const PALETTES: { id: Palette; label: string; dark: string; light: string }[] = [
  { id: 'indigo',  label: 'Indigo',  dark: '#6366f1', light: '#4f46e5' },
  { id: 'violet',  label: 'Violet',  dark: '#7c3aed', light: '#7c3aed' },
  { id: 'emerald', label: 'Emerald', dark: '#10b981', light: '#059669' },
  { id: 'rose',    label: 'Rose',    dark: '#f43f5e', light: '#e11d48' },
  { id: 'amber',   label: 'Amber',   dark: '#f59e0b', light: '#d97706' },
  { id: 'sky',     label: 'Sky',     dark: '#0ea5e9', light: '#0284c7' },
];

/* ─── icons ───────────────────────────────────────────────────────────────── */
const IconMoon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
  </svg>
);

const IconSun = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
    <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/>
  </svg>
);

const IconPalette = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white">
    <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd"/>
  </svg>
);

const IconClose = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white">
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
  </svg>
);

/* ─── component ────────────────────────────────────────────────────────────── */
export function PaletteWidget() {
  const { theme, toggle, palette, setPalette } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current    = PALETTES.find(p => p.id === palette) ?? PALETTES[0];
  const accentHex  = theme === 'dark' ? current.dark : current.light;

  return (
    <div
      ref={ref}
      className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex items-center select-none"
    >
      {/* ── Expanded panel ────────────────────────────────────────────── */}
      {open && (
        <div className="overlay-panel animate-popover-in mr-2 w-56 origin-right rounded-2xl p-4">
          {/* Section: Mode */}
          <p className="text-[10px] font-semibold text-t3 uppercase tracking-widest mb-2.5">
            Mode
          </p>

          {/* Dark / Light segmented control */}
          <div className="flex bg-muted rounded-xl p-1 gap-1 mb-4">
            <button
              onClick={() => theme !== 'dark' && toggle()}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                theme === 'dark'
                  ? 'bg-surface text-t1 shadow-sm'
                  : 'text-t3 hover:text-t2'
              }`}
            >
              <IconMoon /> Dark
            </button>
            <button
              onClick={() => theme !== 'light' && toggle()}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                theme === 'light'
                  ? 'bg-surface text-t1 shadow-sm'
                  : 'text-t3 hover:text-t2'
              }`}
            >
              <IconSun /> Light
            </button>
          </div>

          {/* Section: Color */}
          <p className="text-[10px] font-semibold text-t3 uppercase tracking-widest mb-2.5">
            Color
          </p>
          <div className="grid grid-cols-3 gap-2">
            {PALETTES.map(p => {
              const isActive = palette === p.id;
              const color    = theme === 'dark' ? p.dark : p.light;
              return (
                <button
                  key={p.id}
                  onClick={() => setPalette(p.id)}
                  title={p.label}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all ${
                    isActive ? 'bg-surface' : 'hover:bg-muted'
                  }`}
                  style={
                    isActive
                      ? { outline: `2px solid ${color}`, outlineOffset: '0px' }
                      : undefined
                  }
                >
                  <div
                    className="w-5 h-5 rounded-full shadow-sm flex-shrink-0"
                    style={{ background: color }}
                  />
                  <span
                    className={`text-[10px] font-medium leading-none ${
                      isActive ? 'text-t1' : 'text-t3'
                    }`}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tab / handle ──────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Appearance"
        aria-label="Open appearance settings"
        className="flex flex-col items-center justify-center w-7 py-5 rounded-l-2xl shadow-xl transition-all duration-200 hover:w-8 active:scale-95 focus:outline-none"
        style={{ background: accentHex }}
      >
        {open ? <IconClose /> : <IconPalette />}
      </button>
    </div>
  );
}
