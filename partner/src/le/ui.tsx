'use client';

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

/** The client's toast, modal and confirm box (legacy/public/js/core.js), as React. Hosts live inside the .le-ui shell. */

type ToastKind = '' | 'ok' | 'err';
interface Overlay { id: number; node: (close: () => void) => React.ReactNode; dismiss: boolean; onClose?: () => void }
interface UiState {
  toasts: { id: number; msg: string; kind: ToastKind }[];
  overlays: Overlay[];
}
let seq = 0;
const useUi = create<UiState>(() => ({ toasts: [], overlays: [] }));

export function toast(msg: string, kind: ToastKind = '') {
  const id = ++seq;
  useUi.setState((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'err' ? 6000 : 3500);
}
export const showError = (e: unknown) => toast((e as Error)?.message || 'Something went wrong', 'err');

/** Opens an overlay; `render(close)` draws it. Returns close(). */
export function openOverlay(render: (close: () => void) => React.ReactNode, opts: { dismiss?: boolean; onClose?: () => void } = {}) {
  const id = ++seq;
  const close = () => {
    const o = useUi.getState().overlays.find((x) => x.id === id);
    useUi.setState((s) => ({ overlays: s.overlays.filter((x) => x.id !== id) }));
    o?.onClose?.();
  };
  useUi.setState((s) => ({ overlays: [...s.overlays, { id, node: render, dismiss: opts.dismiss !== false, onClose: opts.onClose }] }));
  return close;
}

export function Modal({ title, size = '', close, children, foot }: {
  title: string; size?: '' | 'sm' | 'lg' | 'xl'; close: () => void; children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <div className={`modal ${size}`} role="dialog" aria-modal="true">
      <div className="mh"><h2>{title}</h2><button className="btn ghost sm" aria-label="Close" onClick={close}>✕</button></div>
      <div className="mb">{children}</div>
      {foot ? <div className="mf">{foot}</div> : null}
    </div>
  );
}

export function confirmBox(message: React.ReactNode, o: { title?: string; ok?: string; cancel?: string; danger?: boolean; reason?: boolean; reasonLabel?: string } = {}) {
  return new Promise<boolean | string>((resolve) => {
    let done = false;
    const finish = (v: boolean | string) => { if (!done) { done = true; resolve(v); } };
    openOverlay((close) => <ConfirmBody message={message} o={o} close={close} finish={finish} />, { onClose: () => finish(false) });
  });
}
function ConfirmBody({ message, o, close, finish }: { message: React.ReactNode; o: Parameters<typeof confirmBox>[1] & object; close: () => void; finish: (v: boolean | string) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(false);
  const yes = () => {
    if (o.reason) { if (!reason.trim()) { setErr(true); return; } finish(reason.trim()); }
    else finish(true);
    close();
  };
  return (
    <Modal title={o.title ?? 'Please confirm'} size="sm" close={close} foot={<>
      <button className="btn" onClick={close}>{o.cancel ?? 'No'}</button>
      <button className={`btn ${o.danger ? 'danger solid' : 'primary'}`} onClick={yes}>{o.ok ?? 'Yes'}</button>
    </>}>
      <p style={{ marginTop: 0 }}>{message}</p>
      {o.reason ? (
        <div className={`f c6${err ? ' err' : ''}`}>
          <label>{o.reasonLabel ?? 'Reason'}<span className="req">*</span></label>
          <textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="msg">{err ? 'Required' : ''}</div>
        </div>
      ) : null}
    </Modal>
  );
}

/** Rendered once by the shell. */
export function UiHost() {
  const { toasts, overlays } = useUi();
  const down = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = useUi.getState().overlays.at(-1);
      if (e.key === 'Escape' && top?.dismiss) {
        useUi.setState((s) => ({ overlays: s.overlays.slice(0, -1) }));
        top.onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      {overlays.map((o) => {
        const close = () => { useUi.setState((s) => ({ overlays: s.overlays.filter((x) => x.id !== o.id) })); o.onClose?.(); };
        return (
          <div key={o.id} className="overlay"
            onMouseDown={(e) => { if (e.target === e.currentTarget && o.dismiss) down.current = o.id; }}
            onMouseUp={(e) => { if (e.target === e.currentTarget && down.current === o.id) close(); down.current = null; }}>
            {o.node(close)}
          </div>
        );
      })}
      <div id="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </>
  );
}
