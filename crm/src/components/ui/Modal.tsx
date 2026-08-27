'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '@/components/ui/button';
import { CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * The one modal in the CRM.
 *
 * Closing is animated, which means the element has to outlive the `open` prop:
 * `open` going false starts the exit and a timer unmounts it after. Everything
 * below — the scrim, the panel, the focus trap, the scroll lock — is keyed off
 * that internal phase rather than the prop.
 */

const EXIT_MS = 180;

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const WIDTHS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-6xl',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** A line under the title — context, not instructions. */
  description?: React.ReactNode;
  size?: ModalSize;
  /** Docks to the right edge and slides in, for long detail panels. */
  variant?: 'center' | 'sheet';
  /** Pinned below the body; the body scrolls under it. */
  footer?: React.ReactNode;
  /** Set false while a submit is in flight. */
  dismissable?: boolean;
  children: React.ReactNode;
}

export function Modal({
  open, onClose, title, description, size = 'md',
  variant = 'center', footer, dismissable = true, children,
}: ModalProps) {
  const [phase, setPhase] = useState<'closed' | 'entering' | 'leaving'>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) { setPhase('entering'); return; }
    // Nothing to animate out if it was never shown.
    setPhase((p) => (p === 'closed' ? 'closed' : 'leaving'));
    const t = setTimeout(() => setPhase('closed'), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  const mounted = phase !== 'closed';

  const requestClose = useCallback(() => {
    if (dismissable) onClose();
  }, [dismissable, onClose]);

  // Escape, and a Tab that would otherwise walk out of the dialog.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); requestClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null);
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, requestClose]);

  // Lock the page behind the scrim, and give the width back so the layout
  // does not jump as the scrollbar disappears.
  useEffect(() => {
    if (!mounted) return;
    const { body } = document;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    const previous = { overflow: body.style.overflow, padding: body.style.paddingRight };
    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    return () => {
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.padding;
    };
  }, [mounted]);

  // Move focus in on open and hand it back on close.
  useEffect(() => {
    if (phase !== 'entering') return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? panelRef.current)?.focus();
    }, 20);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'closed') return;
    restoreFocus.current?.focus?.();
    restoreFocus.current = null;
  }, [phase]);

  if (!mounted || typeof document === 'undefined') return null;

  const leaving = phase === 'leaving';
  const isSheet = variant === 'sheet';

  const panelMotion = isSheet
    ? (leaving ? 'animate-sheet-out' : 'animate-sheet-in')
    : (leaving ? 'animate-overlay-out' : 'animate-overlay-in');

  const panelPosition = isSheet
    ? 'ml-auto h-full w-full sm:w-[min(560px,100%)] rounded-none sm:rounded-l-3xl'
    : `w-full ${WIDTHS[size]} rounded-3xl`;

  return createPortal(
    <div
      className={cn('fixed inset-0 z-[100] flex', !isSheet && 'items-center justify-center p-4 sm:p-6')}
      role="presentation"
    >
      <div
        aria-hidden
        onClick={requestClose}
        className={cn('overlay-scrim absolute inset-0', leaving ? 'animate-backdrop-out' : 'animate-backdrop-in')}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'overlay-panel relative flex max-h-[min(90vh,860px)] flex-col overflow-hidden outline-none',
          panelPosition, panelMotion,
        )}
      >
        {(title || dismissable) && (
          <header className="flex shrink-0 items-start gap-4 border-b border-line/60 px-6 py-5">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="truncate text-[19px] font-semibold tracking-tight text-t1">
                  {title}
                </h2>
              )}
              {description && <p className="mt-1 text-[13px] leading-relaxed text-t3">{description}</p>}
            </div>
            {dismissable && (
              <IconButton
                label="Close"
                onClick={onClose}
                className="-mr-1.5 -mt-1 rounded-full"
              >
                <CloseIcon className="h-4 w-4" />
              </IconButton>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2.5 border-t border-line/60 px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The destructive-action prompt. `window.confirm` blocks the thread, ignores
 * the theme and cannot say what is about to be lost.
 */
export function ConfirmModal({
  open, onClose, onConfirm, title, body, confirmLabel = 'Delete', busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[15px] leading-relaxed text-t2">{body}</p>
    </Modal>
  );
}
