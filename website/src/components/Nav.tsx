'use client';

import { useEffect, useState } from 'react';
import { Logo } from './Brand';
import { nav, site } from '@/lib/site';

export function Nav() {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        stuck ? 'bg-paper/70 backdrop-blur-xl' : ''
      }`}
    >
      <div className={`mx-auto flex h-20 max-w-6xl items-center justify-between px-6 ${stuck ? 'border-b border-hairline/70' : ''}`}>
        <a href="#top" className="text-[17px]" aria-label="Vernyr home">
          <Logo />
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[14px] text-ink-soft transition-colors hover:text-ink"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href={site.portalUrl}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-white/60 hover:text-ink"
          >
            Student portal
          </a>
          <a
            href={site.crmUrl}
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-85"
          >
            Staff sign in
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="grid h-10 w-10 place-items-center rounded-full text-ink md:hidden"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            {open ? <><path d="M5 5l10 10" /><path d="M15 5L5 15" /></> : <><path d="M3 7h14" /><path d="M3 13h14" /></>}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-b border-hairline bg-paper/95 backdrop-blur-xl md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-[15px] text-ink-soft hover:bg-white/70 hover:text-ink"
              >
                {n.label}
              </a>
            ))}
            <div className="mt-2 flex gap-2">
              <a href={site.portalUrl} className="flex-1 rounded-full bg-white/70 py-2.5 text-center text-[14px] font-medium text-ink">
                Student portal
              </a>
              <a href={site.crmUrl} className="flex-1 rounded-full bg-ink py-2.5 text-center text-[14px] font-medium text-paper">
                Staff sign in
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
