'use client';

import { useMemo, useRef, useState } from 'react';
import { fromLocalInput, toLocalInput } from './format';
import { ApiError } from './api';
import { Modal, confirmBox, openOverlay, showError } from './ui';

/** The client's form builder (legacy/public/js/core.js fieldHtml / formModal): same field descriptors, React state. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Vals = Record<string, any>;
export type OptIn = string | [unknown, string] | { id: string; name: string };
export interface Field {
  k: string; label?: string; type?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'url' | 'section' | 'select' | 'multi' | 'textarea' | 'checkbox' | 'yesno' | 'phone' | 'password' | 'datetime' | 'html';
  req?: boolean; opts?: OptIn[] | ((v: Vals) => OptIn[]); show?: (v: Vals) => boolean; help?: string; col?: number; placeholder?: string;
  disabled?: boolean; maxlength?: number; min?: number; max?: number; step?: number; rows?: number; noBlank?: boolean; blank?: string;
  list?: string[]; ccKey?: string; html?: (v: Vals) => React.ReactNode;
}

const pair = (o: OptIn): [string, string] =>
  Array.isArray(o) ? [String(o[0]), o[1]] : typeof o === 'object' ? [o.id, o.name] : [o, o];
export const Options = ({ list }: { list: OptIn[] }) => <>{list.map((o) => { const [v, l] = pair(o); return <option key={v} value={v}>{l}</option>; })}</>;
const PHONE_CODES = ['+91', '+1', '+44', '+971', '+61', '+49', '+33', '+39', '+86', '+65', '+977', '+880', '+94'];

/** Values the client's readVisible() would send: hidden fields null, empty strings null, datetimes as ISO. */
export function visibleValues(fields: Field[], v: Vals): Vals {
  const out: Vals = { ...v };
  for (const f of fields) {
    if (f.type === 'section' || f.type === 'html') continue;
    if (f.show && !f.show(v)) { out[f.k] = null; continue; }
    const x = v[f.k];
    if (f.type === 'datetime') out[f.k] = fromLocalInput(x);
    else if (typeof x === 'string') out[f.k] = x.trim() === '' ? null : x.trim();
  }
  return out;
}

export function FormGrid({ fields, vals, set, errors = {} }: {
  fields: Field[]; vals: Vals; set: (k: string, v: unknown) => void; errors?: Record<string, string>;
}) {
  return (
    <div className="form-grid">
      {fields.map((f) => <FieldView key={f.k} f={f} vals={vals} set={set} error={errors[f.k]} />)}
    </div>
  );
}

function FieldView({ f, vals, set, error }: { f: Field; vals: Vals; set: (k: string, v: unknown) => void; error?: string }) {
  const [shown, setShown] = useState(false);
  const id = useMemo(() => `f_${f.k}_${Math.random().toString(36).slice(2, 6)}`, [f.k]);
  const hidden = f.show ? !f.show(vals) : false;
  const t = f.type ?? 'text';
  const v = vals[f.k];
  const cls = (base: string) => `${base}${f.col ? ` c${f.col}` : ''}${error ? ' err' : ''}${hidden ? ' hide' : ''}`;
  const on = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(f.k, e.target.value);
  const common = { id, name: f.k, disabled: f.disabled, maxLength: f.maxlength, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step };

  if (t === 'section') return <div className={`form-section${hidden ? ' hide' : ''}`}>{f.label}</div>;
  if (t === 'html') return <div className={`f c6${hidden ? ' hide' : ''}`}>{f.html?.(vals)}</div>;
  if (t === 'checkbox') {
    return (
      <div className={cls('f check')}>
        <input type="checkbox" id={id} checked={!!v} disabled={f.disabled} onChange={(e) => set(f.k, e.target.checked)} />
        <label htmlFor={id}>{f.label}</label>
        {f.help ? <div className="help">{f.help}</div> : null}
        <div className="msg">{error ?? ''}</div>
      </div>
    );
  }
  const opts = typeof f.opts === 'function' ? f.opts(vals) : (f.opts ?? []);
  let input: React.ReactNode;
  if (t === 'select') {
    input = <select {...common} value={v ?? ''} onChange={on}>{f.noBlank ? null : <option value="">{f.blank ?? 'Select...'}</option>}<Options list={opts} /></select>;
  } else if (t === 'multi') {
    const sel = new Set((Array.isArray(v) ? v : []).map(String));
    input = (
      <div className="ms">
        {opts.map((o) => { const [ov, ol] = pair(o); return (
          <label key={ov}><input type="checkbox" checked={sel.has(ov)} disabled={f.disabled}
            onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(ov); else n.delete(ov); set(f.k, [...n]); }} />{ol}</label>
        ); })}
      </div>
    );
  } else if (t === 'textarea') input = <textarea {...common} rows={f.rows ?? 3} value={v ?? ''} onChange={on} />;
  else if (t === 'yesno') {
    input = (
      <select {...common} value={v === true || v === 1 || v === '1' ? '1' : v === false || v === 0 || v === '0' ? '0' : ''}
        onChange={(e) => set(f.k, e.target.value === '' ? null : e.target.value === '1')}>
        <option value="">Select...</option><option value="1">Yes</option><option value="0">No</option>
      </select>
    );
  } else if (t === 'phone') {
    const cc = f.ccKey ?? 'country_code';
    input = (
      <div className="phone">
        <select value={vals[cc] || '+91'} disabled={f.disabled} onChange={(e) => set(cc, e.target.value)}><Options list={PHONE_CODES} /></select>
        <input type="tel" {...common} value={v ?? ''} onChange={on} />
      </div>
    );
  } else if (t === 'password') {
    input = <div className="pw"><input type={shown ? 'text' : 'password'} {...common} value={v ?? ''} onChange={on} /><button type="button" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button></div>;
  } else if (t === 'datetime') {
    // kept as the datetime-local string while editing; visibleValues() turns it into ISO
    const local = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : toLocalInput(v);
    input = <input type="datetime-local" {...common} value={local} onChange={on} />;
  } else {
    input = (
      <>
        <input type={t} {...common} value={v ?? ''} onChange={on} list={f.list ? `${id}_l` : undefined} />
        {f.list ? <datalist id={`${id}_l`}>{f.list.map((x) => <option key={x} value={x} />)}</datalist> : null}
      </>
    );
  }
  return (
    <div className={cls('f')}>
      {f.label ? <label htmlFor={id}>{f.label}{f.req ? <span className="req">*</span> : null}</label> : null}
      {input}
      {f.help ? <div className="help">{f.help}</div> : null}
      <div className="msg">{error ?? ''}</div>
    </div>
  );
}

/** formModal(): resolves with what save() returned, or null when closed. save() returning false keeps it open. */
export function formModal<R = unknown>(o: {
  title: string; fields: Field[]; values?: Vals; size?: '' | 'sm' | 'lg' | 'xl'; saveLabel?: string; intro?: React.ReactNode;
  save: (vals: Vals) => Promise<R | false>; extraButtons?: (doSave: (extra?: Vals) => void) => React.ReactNode;
}) {
  return new Promise<R | null>((resolve) => {
    let done = false;
    const finish = (v: R | null) => { if (!done) { done = true; resolve(v); } };
    openOverlay((close) => <FormModalBody o={o} close={close} finish={finish} />, { onClose: () => finish(null) });
  });
}
function FormModalBody<R>({ o, close, finish }: { o: Parameters<typeof formModal<R>>[0]; close: () => void; finish: (v: R | null) => void }) {
  const start = useRef(JSON.stringify(o.values ?? {}));
  const [vals, setVals] = useState<Vals>({ ...(o.values ?? {}) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setVals((s) => ({ ...s, [k]: v }));
  const doSave = async (extra: Vals = {}) => {
    setBusy(true); setErrors({});
    try {
      const r = await o.save({ ...visibleValues(o.fields, vals), ...extra });
      if (r !== false) { finish((r ?? true) as R); close(); }
    } catch (e) {
      if (e instanceof ApiError && e.data.errors) setErrors(e.data.errors);
      showError(e);
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (JSON.stringify(vals) === start.current || (await confirmBox('Discard your changes?', { ok: 'Discard', cancel: 'Keep editing' }))) close();
  };
  return (
    <Modal title={o.title} size={o.size} close={cancel} foot={<>
      {o.extraButtons?.(doSave)}
      <button className="btn" type="button" onClick={cancel}>Cancel</button>
      <button className="btn primary" type="button" disabled={busy} onClick={() => doSave()}>{o.saveLabel ?? 'Save'}</button>
    </>}>
      {o.intro}
      <form noValidate onSubmit={(e) => { e.preventDefault(); doSave(); }}>
        <FormGrid fields={o.fields} vals={vals} set={set} errors={errors} />
      </form>
    </Modal>
  );
}
