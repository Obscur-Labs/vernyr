'use client';

import { useEffect, useState } from 'react';
import '@/styles/le-infoform.css';
import { ApiError } from './api';

/** ONE student information form, the same in the portal and the CRM (legacy/public/js/infoform.js). The form definition comes from the server. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
interface Cfg { load: () => Promise<Any>; save: (key: string, body: Any) => Promise<Any>; mode: 'student' | 'staff' | 'university'; title?: string; intro?: string; onSubmit?: () => Promise<unknown> }

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '' && !(Array.isArray(v) && !v.length);
const shown = (f: Any, d: Any) => !f.show || Object.entries(f.show).every(([k, v]) => (Array.isArray(v) ? v.includes(d[k]) : v === true ? d[k] === 'yes' || d[k] === true : d[k] === v));
const optsOf = (f: Any): [string, string][] => (f.opts ?? []).map((o: any) => (Array.isArray(o) ? [String(o[0]), String(o[1])] : [String(o), String(o)]));
const EDU_RANK: Record<string, number> = { '10th': 1, '12th': 2, Diploma: 2, Bachelor: 3, Master: 4, PhD: 5 };
/** the last (highest) education decides which qualification rows must be filled (12th: 10th + 12th only) */
function eduRows(last: string | undefined, rows0: Any[] = []) {
  const r = EDU_RANK[last ?? ''] || 0;
  const rows = rows0.map((x) => ({ ...x }));
  if (!r) return { rows, fixed: 0 };
  const need = ['10th']; if (r >= 2) need.push('12th'); if (r >= 3) need.push('Bachelor'); if (r >= 4) need.push('Master'); if (r >= 5) need.push('PhD');
  const pool = [...rows], out: Any[] = [];
  for (const l of need) {
    const i = pool.findIndex((x) => (l === '12th' ? x.level === '12th' || x.level === 'Diploma' : x.level === l));
    out.push(i >= 0 ? pool.splice(i, 1)[0] : { level: l === '12th' && last === 'Diploma' ? 'Diploma' : l });
  }
  return { rows: [...out, ...pool.filter((x) => x.level === 'Other' || !x.level || (EDU_RANK[x.level] || 0) <= r)], fixed: out.length };
}
function emptyVal(f: Any, v: unknown) {
  if (f.type === 'countries') return !(Array.isArray(v) && v.length);
  if (f.type === 'yesno') return !(v === true || v === false || v === 'yes' || v === 'no');
  if (f.type === 'check') return false;
  return !has(v);
}
const ynOf = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : (v as string) || '');

/** search + scrolling list; ticks up to `max`, numbered in the order chosen */
function ScrollList({ items, order, max, disabled, onChange }: { items: [string, string][]; order: string[]; max: number; disabled: boolean; onChange: (o: string[]) => void }) {
  const [q, setQ] = useState('');
  const full = order.length >= max;
  return (
    <>
      <div className="if-scroll">
        <input className="q" type="search" placeholder="Search..." disabled={disabled} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ls">{items.filter(([, b]) => !q.trim() || b.toLowerCase().includes(q.trim().toLowerCase())).map(([a, b]) => {
          const i = order.indexOf(a), dis = disabled || (full && i < 0);
          return (
            <label key={a} className={`${i >= 0 ? 'on' : ''} ${full && i < 0 ? 'dis' : ''}`}>
              <input type="checkbox" checked={i >= 0} disabled={dis} onChange={(e) => onChange(e.target.checked ? (order.length < max ? [...order, a] : order) : order.filter((x) => x !== a))} />
              <span>{b}</span><span className="no" hidden={i < 0}>{i >= 0 ? i + 1 : ''}</span>
            </label>
          );
        })}</div>
      </div>
      <div className="if-picked">{order.map((v, i) => <span key={v}>{i + 1}. {items.find(([a]) => a === v)?.[1] ?? v}</span>)}</div>
    </>
  );
}

export function InfoForm(cfg: Cfg) {
  const [st, setSt] = useState<Any | null>(null);
  const [data, setData] = useState<Any>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [decl, setDecl] = useState(false);
  const [subErr, setSubErr] = useState<React.ReactNode>(null);
  const take = (x: Any) => { setSt(x); setData(JSON.parse(JSON.stringify(x.data ?? {}))); };
  useEffect(() => { cfg.load().then(take).catch((e) => setSubErr(<div className="if-err">{(e as Error).message}</div>)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return subErr ?? <div className="empty">Loading...</div>;
  const ro = cfg.mode === 'university' || st.editable === false;
  const isLocked = (sec: string, k: string) => !!st.locked?.fields?.[`${sec}.${k}`] || !!st.locked?.sections?.[sec];
  const setSec = (key: string, patch: Any) => setData((d: Any) => ({ ...d, [key]: { ...(d[key] ?? {}), ...patch } }));
  const go = (key: string) => document.getElementById('if-sec-' + key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const field = (s: Any, f: Any, d: Any, set: (k: string, v: unknown) => void, rowKey = '') => {
    if (!shown(f, d)) return null;
    const id = `if_${s.key}_${rowKey}${f.k}`, v = d[f.k], lk = !ro && isLocked(s.key, f.k), dis = ro || lk;
    if (f.type === 'check') return <div key={f.k} className="if-f"><label className="if-check" style={{ marginTop: 22 }}><input type="checkbox" checked={!!v} disabled={dis} onChange={(e) => set(f.k, e.target.checked)} /> {f.label}</label></div>;
    let input: React.ReactNode;
    if (f.type === 'select') input = <select id={id} disabled={dis} value={v ?? ''} onChange={(e) => set(f.k, e.target.value || null)}><option value="">Select...</option>{optsOf(f).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>;
    else if (f.type === 'intake') input = <select id={id} disabled={dis} value={v ?? ''} onChange={(e) => set(f.k, e.target.value || null)}><option value="">Select...</option>{st.lists.intakes.map((i: Any) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>;
    else if (f.type === 'countries' || f.type === 'picklist') {
      const items: [string, string][] = f.type === 'countries' ? st.lists.countries.map((c: Any) => [String(c.id), c.name]) : optsOf(f);
      const parts = f.type === 'countries' ? (v ?? []).map(String) : String(v ?? '').split(',').map((x: string) => x.trim()).filter(Boolean);
      const order = parts.filter((x: string) => items.some(([a]) => a === x));
      const other = f.type === 'picklist' ? parts.filter((x: string) => !items.some(([a]) => a === x)).join(', ') : '';
      const write = (o: string[], oth: string) => set(f.k, f.type === 'countries' ? o : [...o, ...(oth.trim() ? [oth.trim().replace(/,/g, ' ')] : [])].join(', ') || null);
      input = <>
        <ScrollList items={items} order={order} max={f.max || 3} disabled={dis} onChange={(o) => write(o, other)} />
        {f.other ? <input type="text" maxLength={80} placeholder={f.other} value={other} disabled={dis} style={{ marginTop: 8 }} onChange={(e) => write(order, e.target.value)} /> : null}
      </>;
    } else if (f.type === 'yesno') {
      const y = ynOf(v);
      input = <div className="if-yn">{[['yes', 'Yes'], ['no', 'No']].map(([a, b]) => <button key={a} type="button" className={y === a ? 'on' : ''} disabled={dis} onClick={() => set(f.k, a)}>{b}</button>)}</div>;
    } else if (f.type === 'textarea') input = <textarea id={id} maxLength={2000} disabled={dis} value={v ?? ''} onChange={(e) => set(f.k, e.target.value)} />;
    else input = <input id={id} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'text'} step={f.type === 'number' ? 'any' : undefined} disabled={dis} value={v ?? ''} onChange={(e) => set(f.k, e.target.value === '' ? null : e.target.value)} />;
    const hint = f.hintBy && f.hintBy.map[d[f.hintBy.k]] ? `Range: ${f.hintBy.map[d[f.hintBy.k]]}` : f.help || '';
    const need = (f.req || (f.reqIf && Object.entries(f.reqIf).every(([k, vals]) => (vals as unknown[]).includes(d[k])))) && !ro && !lk;
    const wide = ['textarea', 'countries', 'picklist'].includes(f.type);
    return (
      <div key={f.k} className={`if-f ${wide ? 'wide' : ''} ${need && emptyVal(f, v) ? 'miss' : ''}`}>
        <label htmlFor={id}>{f.label}{need ? <> <span className="req">*</span></> : null}</label>{input}
        {hint ? <div className="if-help">{hint}</div> : null}
        {lk ? <div className="lk">Locked after you submitted: ask your counsellor to change it.</div> : null}
      </div>
    );
  };

  const section = (s: Any) => {
    const d: Any = data[s.key] ?? {};
    const ok = st.completion.sections[s.key];
    const setTop = (k: string, v: unknown) => setSec(s.key, { [k]: v });
    let body: React.ReactNode;
    if (s.list) {
      let rows: Any[] = d[s.list] ?? [], fixed = 0;
      if (s.auto === 'education') { const x = eduRows(d.last_education, rows); rows = x.rows; fixed = x.fixed; }
      const setRows = (r: Any[]) => setSec(s.key, { [s.list]: r });
      const rowField = (f: Any, r: Any, i: number) => (i < fixed && f.k === 'level' ? { ...f, opts: r.level === '12th' || r.level === 'Diploma' ? ['12th', 'Diploma'] : [r.level] } : f);
      const showRows = (!s.toggle || d[s.toggle.k] === 'yes' || d[s.toggle.k] === true) && !(s.auto === 'education' && !d.last_education);
      const locked = ro || isLocked(s.key, '');
      body = <>
        {s.intro ? <p className="if-note">{s.intro}</p> : null}
        {s.head ? <div className="if-grid" style={{ marginBottom: 12 }}>{s.head.map((f: Any) => field(s, f, d, setTop))}</div> : null}
        {s.toggle ? <div className="if-grid" style={{ marginBottom: 10 }}>{field(s, { k: s.toggle.k, label: s.toggle.label, type: 'yesno', req: true }, d, setTop)}</div> : null}
        {s.auto === 'education' && !d.last_education ? <p className="if-note">Select your last education above: then fill the marks for each level.</p> : null}
        {showRows ? <>
          <div>{rows.length ? rows.map((r, i) => (
            <div key={i} className="if-row">
              <div className="rh"><span>{i < fixed ? (r.level === '12th' || r.level === 'Diploma' ? '12th / Diploma' : r.level) : `${s.listLabel} ${i + 1}`}</span>
                {locked || i < fixed ? null : <button type="button" className="if-btn sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}</div>
              <div className="if-grid">{s.fields.map((f: Any) => field(s, rowField(f, r, i), r, (k, v) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x))), `${i}_`))}</div>
            </div>
          )) : <p className="if-note">None added yet.</p>}</div>
          {locked ? null : <button type="button" className="if-btn sm" onClick={() => setRows([...rows, {}])}>+ Add {s.auto === 'education' ? 'another qualification' : String(s.listLabel).toLowerCase()}</button>}
        </> : null}
      </>;
    } else body = <div className="if-grid">{s.fields.map((f: Any) => field(s, f, d, setTop))}</div>;
    const probs = ro ? [] : (st.problems ?? []).filter((p: Any) => p.section === s.key);
    const save = async () => {
      setBusy(s.key); setErr((x) => ({ ...x, [s.key]: '' }));
      const body0: Any = { ...d };
      if (s.auto === 'education' && s.list) body0[s.list] = eduRows(d.last_education, d[s.list] ?? []).rows;
      try { const r = await cfg.save(s.key, body0); take({ ...st, ...r }); setMsg({ [s.key]: '✓ Saved' }); }
      catch (e) { const list = e instanceof ApiError && e.data.errors ? Object.values(e.data.errors) : []; setErr((x) => ({ ...x, [s.key]: [(e as Error).message, ...list].join('\n') })); }
      finally { setBusy(''); }
    };
    return (
      <div key={s.key} className="if-sec" id={`if-sec-${s.key}`}>
        <div className="h"><h3>{s.title}</h3>{ok ? <span className="if-ok">✓ Complete</span> : <span className="if-todo">To complete</span>}</div>
        <div className="b">
          {probs.length && !st.submitted ? <div className="if-err"><b>Needed before you can send:</b><br />{probs.map((p: Any, i: number) => <span key={i}>• {p.text}<br /></span>)}</div> : null}
          {err[s.key] ? <div className="if-err" style={{ whiteSpace: 'pre-line' }}>{err[s.key]}</div> : null}
          {body}
          {ro ? null : <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}><button type="button" className="if-btn pri" disabled={busy === s.key} onClick={save}>Save</button><span className="if-ok">{msg[s.key] ?? ''}</span></div>}
        </div>
      </div>
    );
  };

  const submit = async () => {
    setSubErr(null);
    if (!decl) { setSubErr(<div className="if-err">Please tick the confirmation above.</div>); return; }
    try { await cfg.onSubmit!(); take(await cfg.load()); }
    catch (e) {
      const probs = (e instanceof ApiError && (e.data.problems as Any[])) || [];
      setSubErr(probs.length ? <div className="if-err"><b>Please complete these first:</b><br />{probs.map((p, i) => <span key={i}>• <a href="#" onClick={(ev) => { ev.preventDefault(); go(p.section === 'personal' && /^parent_/.test(p.key) ? 'family' : p.section); }}>{p.title}</a>: {p.text}<br /></span>)}</div>
        : <div className="if-err">{(e as Error).message}</div>);
      cfg.load().then((x) => { setSt(x); }).catch(() => {});
    }
  };

  return (
    <div className="if-wrap">
      {cfg.title ? <h2 style={{ margin: '0 0 4px' }}>{cfg.title}</h2> : null}
      {cfg.intro ? <p className="if-note">{cfg.intro}</p> : null}
      <div className="if-top"><div className="if-bar"><i style={{ width: `${st.completion.percent}%` }} /></div><b>{st.completion.percent}% complete</b>{st.submitted ? <span className="if-ok">✓ Sent to La Europa</span> : null}</div>
      {st.email || st.phone ? <p className="if-note">Email: <b>{st.email || '-'}</b>{st.phone ? <> · Mobile: <b>{st.phone}</b></> : null}</p> : null}
      <div className="if-chips">{st.form.map((s: Any) => (
        <span key={s.key} className={`if-chip ${st.completion.sections[s.key] ? 'ok' : ro ? '' : 'todo'}`} onClick={() => go(s.key)}>{st.completion.sections[s.key] ? '✓ ' : ''}{String(s.title).replace(/ \(.*\)$/, '')}</span>
      ))}</div>
      {st.form.map(section)}
      {cfg.onSubmit && !st.submitted ? (
        <div className="if-sec"><div className="b">
          <label className="if-check"><input type="checkbox" checked={decl} onChange={(e) => setDecl(e.target.checked)} /> I confirm that the information above is true and complete.</label>
          <div style={{ marginTop: 10 }}><button className="if-btn pri" onClick={submit}>Send my information to La Europa</button></div>
          <div style={{ marginTop: 10 }}>{subErr}</div>
        </div></div>
      ) : null}
    </div>
  );
}
