'use client';

import { useId, useState } from 'react';

/** Progressive disclosure for the parts of a screen most people never need. */
export function Disclosure({
  summary, detail, defaultOpen = false, children,
}: {
  summary: string;
  detail?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="hig-press flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/50"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
          className={`h-4 w-4 shrink-0 text-t3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          style={{ transitionTimingFunction: 'var(--ease-out)' }}
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-t1">{summary}</span>
          {detail && <span className="mt-0.5 block text-[13px] text-t2">{detail}</span>}
        </span>
      </button>

      {open && <div className="border-t border-line p-5">{children}</div>}
    </div>
  );
}
