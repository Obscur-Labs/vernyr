'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DEL, GET, POST, PUT, SEND, ApiError, download } from './api';
import { M, useMeta } from './meta';
import { ago, fmtDate, fmtDT, money, qs } from './format';
import { FormGrid, Options, formModal, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { LEVELS } from './work/shortlist';

/** The client's course catalogue admin and student portal admin (legacy/public/js/pages/portalcrm.js). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const CUR = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'NZD', 'CNY', 'JPY', 'AED', 'MYR', 'SEK', 'CHF', 'INR'];
const LANG = ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Japanese', 'Other'];
const day = (s: unknown) => (s ? String(s).slice(0, 10) : '');
const fail = (setErr: (e: Record<string, string>) => void) => (e: unknown) => { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); };

// ---------- shared row editors: intakes and English tests ----------
function IntakeRows({ rows, set }: { rows: Any[]; set: (r: Any[]) => void }) {
  const ch = (n: number, k: string, v: unknown) => set(rows.map((r, i) => (i === n ? { ...r, [k]: v } : r)));
  return <>
    {rows.map((i, n) => (
      <div key={n} className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 150 }} value={String(i.intake_id ?? '')} onChange={(e) => ch(n, 'intake_id', e.target.value)}><option value="">Intake...</option><Options list={M.intakes(true)} /></select>
        <label className="small">Opens <input type="date" className="input" style={{ width: 160 }} value={day(i.open_date)} onChange={(e) => ch(n, 'open_date', e.target.value)} /></label>
        <label className="small">Deadline <input type="date" className="input" style={{ width: 160 }} value={day(i.deadline)} onChange={(e) => ch(n, 'deadline', e.target.value)} /></label>
        <input className="input" style={{ width: 200 }} placeholder="Note (e.g. Round 1)" value={i.deadline_note ?? ''} onChange={(e) => ch(n, 'deadline_note', e.target.value)} />
        <button type="button" className="btn xs danger" aria-label="Remove" onClick={() => set(rows.filter((_, j) => j !== n))}>✕</button>
      </div>
    ))}
    <button type="button" className="btn xs" onClick={() => set([...rows, {}])}>+ Intake</button>
  </>;
}
function EnglishRows({ rows, set }: { rows: Any[]; set: (r: Any[]) => void }) {
  const ch = (n: number, k: string, v: unknown) => set(rows.map((r, i) => (i === n ? { ...r, [k]: v } : r)));
  return <>
    {rows.map((e, n) => (
      <div key={n} className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 130 }} value={e.test_type ?? 'IELTS'} onChange={(x) => ch(n, 'test_type', x.target.value)}><Options list={['IELTS', 'TOEFL', 'PTE', 'Duolingo']} /></select>
        <input type="number" step="0.5" className="input" style={{ width: 120 }} placeholder="Min overall" value={e.min_overall ?? ''} onChange={(x) => ch(n, 'min_overall', x.target.value)} />
        <input type="number" step="0.5" className="input" style={{ width: 120 }} placeholder="Min band" value={e.min_band ?? ''} onChange={(x) => ch(n, 'min_band', x.target.value)} />
        <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={!!e.moi_accepted} onChange={(x) => ch(n, 'moi_accepted', x.target.checked)} /> MOI accepted</label>
        <input type="number" className="input" style={{ width: 160 }} placeholder="12th English waiver %" value={e.min_12th_english_percent ?? ''} onChange={(x) => ch(n, 'min_12th_english_percent', x.target.value)} />
        <button type="button" className="btn xs danger" aria-label="Remove" onClick={() => set(rows.filter((_, j) => j !== n))}>✕</button>
      </div>
    ))}
    <button type="button" className="btn xs" onClick={() => set([...rows, { test_type: 'IELTS' }])}>+ Test</button>
  </>;
}
const ACADEMIC: Field[] = [{ k: 'required_level', label: 'Required previous level', type: 'select', opts: ['12th', 'Bachelor', 'Master'], col: 2 }, { k: 'min_percent', label: 'Minimum %', type: 'number', col: 1 },
  { k: 'max_backlogs', label: 'Max backlogs', type: 'number', col: 1 }, { k: 'min_work_months', label: 'Work exp. (months)', type: 'number', col: 1 }, { k: 'entrance_test', label: 'Entrance test', type: 'select', opts: ['none', 'GMAT', 'GRE', 'SAT'], col: 1 }];

// after a publish: how many went live, and the ones that stayed Draft with what is missing
function publishResult(r: Any, word = 'Published') {
  toast(`${word}: ${r.changed} course(s)${r.skipped.length ? `, ${r.skipped.length} not complete` : ''}`, r.skipped.length ? undefined : 'ok');
  if (r.skipped.length) openOverlay((close) => (
    <Modal title={`${r.skipped.length} course(s) not published: details missing`} size="lg" close={close}>
      <p className="small muted" style={{ marginTop: 0 }}>Fill these in Excel (or click the course) and publish again.</p>
      <table className="t small"><thead><tr><th>Course ID</th><th>Course</th><th>Missing</th></tr></thead><tbody>{r.skipped.map((x: Any, i: number) => <tr key={i}><td className="mono">{x.course_id || ''}</td><td>{x.name || ''}</td><td>{x.missing}</td></tr>)}</tbody></table>
    </Modal>
  ));
}

function UniSettings({ id, close, done }: { id: string; close: () => void; done: () => void }) {
  const [d, setD] = useState<Any | null>(null);
  const [v, setV] = useState<Vals>({}), [ac, setAc] = useState<Vals>({});
  const [intakes, setIntakes] = useState<Any[]>([]), [english, setEnglish] = useState<Any[]>([]);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => {
    GET(`/admin/catalogue/universities/${id}/settings`).then((x) => {
      const s = x.settings; setD(x); setV(s); setAc(s.academic ?? {});
      setIntakes(s.intakes.length ? s.intakes.map((i: Any) => ({ ...i })) : [{}]); setEnglish(s.english.length ? s.english.map((e: Any) => ({ ...e })) : [{ test_type: 'IELTS' }]);
    }).catch((e) => { showError(e); close(); });
  }, [id, close]);
  const save = async () => {
    setErr({});
    try { const r = await PUT(`/admin/catalogue/universities/${id}/settings`, { application_fee: v.application_fee, application_fee_currency: v.application_fee_currency, currency: v.currency, language: v.language, intakes: intakes.filter((i) => i.intake_id), english, academic: ac });
      toast(`Saved. Applied to ${r.applied_to} course(s).`, 'ok'); close(); done(); } catch (e) { fail(setErr)(e); }
  };
  return (
    <Modal title={d ? `University settings: ${d.university.uni_code} ${d.university.name}` : 'University settings'} size="xl" close={close}
      foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save} disabled={!d}>Save and apply to the courses</button></>}>
      {!d ? <div className="empty">Loading...</div> : <>
        <p className="small muted" style={{ marginTop: 0 }}>Set once, used by every course of this university ({d.courses.length} course(s); {d.courses.filter((c: Any) => !c.own_intakes).length} follow these intakes). A course can still have its own values in its course form.</p>
        <FormGrid fields={[{ k: 'application_fee', label: 'Application fee (0 = free)', type: 'number', col: 2 }, { k: 'application_fee_currency', label: 'App fee currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
          { k: 'currency', label: 'Tuition currency (default)', type: 'select', opts: CUR, col: 1 }, { k: 'language', label: 'Language (default)', type: 'select', opts: LANG, col: 2 }]} vals={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errors={err} />
        <h3 style={{ margin: '16px 0 6px' }}>Intakes: application opens and deadline</h3><IntakeRows rows={intakes} set={setIntakes} />
        <h3 style={{ margin: '16px 0 6px' }}>English tests</h3><EnglishRows rows={english} set={setEnglish} />
        <h3 style={{ margin: '16px 0 6px' }}>Minimum academic requirement</h3><FormGrid fields={ACADEMIC} vals={ac} set={(k, x) => setAc((o) => ({ ...o, [k]: x }))} />
      </>}
    </Modal>
  );
}

function UniUpload({ u, close, done }: { u: Any; close: () => void; done: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pub, setPub] = useState(true);
  const [r, setR] = useState<Any | null>(null);
  const [mode, setMode] = useState<'preview' | 'commit' | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (m: 'preview' | 'commit') => {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file); if (pub) fd.append('publish', '1');
    setBusy(true);
    try { const x = await SEND('post', `/admin/catalogue/universities/${u.id}/import/${m}`, fd); setR(x); setMode(m); if (m === 'commit') { toast('Import finished', 'ok'); done(); } } catch (e) { showError(e); } finally { setBusy(false); }
  };
  const s = r?.settings;
  const setTxt = s ? `${s.intakes.length} intake(s), English: ${s.english.map((e: Any) => `${e.test_type} ${e.min_overall ?? ''}`).join(', ') || '-'}, application fee ${s.application_fee ?? '-'} ${s.application_fee_currency || ''}` : 'University sheet not in the file: settings unchanged';
  return (
    <Modal title={`Upload courses: ${u.uni_code} ${u.name}`} size="xl" close={close}
      foot={<><button className="btn" onClick={close}>Close</button><button className="btn" disabled={!file || busy} onClick={() => run('preview')}>Preview</button>
        <button className="btn primary" disabled={!r || mode !== 'preview' || r.settings_errors.length > 0 || busy} onClick={() => run('commit')}>Import</button></>}>
      <p className="small" style={{ marginTop: 0 }}>Only the Excel of <b>{u.uni_code}</b> is accepted (download it with ⬇ Excel). You see a preview first; nothing is saved until you press Import.</p>
      <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setR(null); setMode(null); }} />
      <label className="row small" style={{ gap: 6, marginTop: 10 }}><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> Publish the courses straight away (new and Draft courses whose Status cell is empty; students see them at once)</label>
      {r ? <div style={{ marginTop: 12 }}>
        <div className={mode === 'commit' ? 'ok-box' : 'info-box'}><b>{mode === 'commit' ? 'Imported' : 'Preview'}</b> · {Object.entries(r.counts).map(([k, x]) => `${k} ${x}`).join(' · ') || 'no course rows'}{mode === 'commit' ? ` · university settings applied to ${r.applied_to} course(s)` : ''}
          <div className="small" style={{ marginTop: 4 }}>University settings: {setTxt}</div></div>
        {r.settings_errors.length ? <div className="err-box" style={{ marginTop: 8 }}>{r.settings_errors.map((x: string, i: number) => <div key={i}>{x}</div>)}</div> : null}
        <table className="t small" style={{ marginTop: 8 }}><thead><tr><th>Row</th><th>Result</th><th>Course ID</th><th>Course</th><th>Reason</th></tr></thead><tbody>
          {r.rows.map((x: Any, i: number) => <tr key={i} className={x.status === 'Error' ? 'overdue' : ''}><td>{x.row}</td><td>{x.status}</td><td className="mono">{x.course_id || (x.status === 'New' ? 'new' : '')}</td><td>{x.course || ''}</td><td>{x.reason || ''}</td></tr>)}</tbody></table>
      </div> : null}
    </Modal>
  );
}

function CourseForm({ c, close, done }: { c: Any | null; close: () => void; done: () => void }) {
  const fields = M.list('field_of_study');
  const [v, setV] = useState<Vals>(() => (c ? { ...c, university_id: String(c.university_id ?? ''), field_of_study_id: String(c.field_of_study_id ?? ''), last_verified_on: day(c.last_verified_on), scholarship: !!c.scholarship }
    : { status: 'Draft', currency: 'EUR', language: 'English', last_verified_on: new Date().toISOString().slice(0, 10) }));
  const [intakes, setIntakes] = useState<Any[]>(c?.intakes?.length ? c.intakes.map((i: Any) => ({ ...i, intake_id: String(i.intake_id ?? '') })) : [{}]);
  const [english, setEnglish] = useState<Any[]>(c?.english?.length ? c.english.map((e: Any) => ({ ...e })) : [{ test_type: 'IELTS' }]);
  const [ac, setAc] = useState<Vals>(() => (c?.academic ? { ...c.academic, accepted_fields: c.academic.accepted_fields ?? JSON.parse(c.academic.accepted_fields_json || '[]') } : {}));
  const [fl, setFl] = useState({ intakes: c ? !c.own_intakes : true, english: c ? !c.own_english : true, academic: c ? !c.own_academic : true });
  const [err, setErr] = useState<Record<string, string>>({});
  const main: Field[] = [
    { k: 'university_id', label: 'University', type: 'select', req: true, opts: useMeta.getState().meta?.universities ?? [], col: 3 }, { k: 'name', label: 'Course name', req: true, maxlength: 200, col: 3 },
    { k: 'level', label: 'Level', type: 'select', req: true, opts: LEVELS }, { k: 'field_of_study_id', label: 'Field of study', type: 'select', req: true, opts: fields }, { k: 'city', label: 'City / campus' },
    { k: 'duration_months', label: 'Duration (months)', type: 'number', req: true }, { k: 'language', label: 'Language of instruction', type: 'select', req: true, opts: ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'] },
    { k: 'status', label: 'Status', type: 'select', req: true, noBlank: true, opts: ['Draft', 'Published', 'Hidden', 'Archived'] },
    { k: 'tuition_fee', label: 'Tuition fee / year (0 allowed)', type: 'number', req: true }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: ['EUR', 'CNY', 'USD', 'SEK', 'GBP', 'INR'], col: 1 }, { k: 'tuition_fee_non_eu', label: 'Non-EU fee (if different)', type: 'number', col: 1 },
    { k: 'fee_note', label: 'Fee note' }, { k: 'application_fee', label: 'Application fee (0 = free)', type: 'number' }, { k: 'application_fee_currency', label: 'App fee currency', type: 'select', noBlank: true, opts: ['EUR', 'CNY', 'USD', 'INR'] },
    { k: 'course_link', label: 'Official course link (https://)', type: 'url', req: true, col: 4 }, { k: 'last_verified_on', label: 'Last verified on', type: 'date', req: true },
    { k: 'description', label: 'Short description (max 1500)', type: 'textarea', col: 6, maxlength: 1500 }, { k: 'scholarship', label: 'Scholarship available', type: 'checkbox' }, { k: 'scholarship_text', label: 'Scholarship text (public)', col: 4, show: (x) => !!x.scholarship },
    { k: 'internal_note', label: 'Internal note (never sent to the portal)', type: 'textarea', col: 6 }];
  const follow = (k: keyof typeof fl, what: string) => (
    <label className="consent" style={{ margin: '0 0 8px' }}><input type="checkbox" checked={fl[k]} onChange={(e) => setFl({ ...fl, [k]: e.target.checked })} /> <span>Use the university settings for {what}{c ? '' : ' (recommended)'}. Untick to give this course its own values.</span></label>
  );
  const save = async () => {
    setErr({});
    const keep = Object.fromEntries(main.filter((f) => f.type !== 'section').map((f) => [f.k, v[f.k]]));
    // sections that follow the university are not sent: the server fills them from the university settings
    const b = { ...keep, follow_intakes: fl.intakes, follow_english: fl.english, follow_academic: fl.academic, ...(fl.intakes ? {} : { intakes: intakes.filter((i) => i.intake_id) }), ...(fl.english ? {} : { english }), ...(fl.academic ? {} : { academic: ac }) };
    try { if (c) await PUT('/admin/catalogue/' + c.id, b); else await POST('/admin/catalogue', b); toast('Course saved', 'ok'); close(); done(); } catch (e) { fail(setErr)(e); }
  };
  return (
    <Modal title={c ? `Edit course ${c.course_uid || c.course_code || ''}` : 'Add course'} size="xl" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <form noValidate onSubmit={(e) => e.preventDefault()}><FormGrid fields={main} vals={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errors={err} /></form>
      <h3 style={{ margin: '14px 0 6px' }}>Intakes</h3>{follow('intakes', 'intakes and deadlines')}{fl.intakes ? null : <IntakeRows rows={intakes} set={setIntakes} />}
      <h3 style={{ margin: '14px 0 6px' }}>English requirements</h3>{follow('english', 'English tests')}{fl.english ? null : <EnglishRows rows={english} set={setEnglish} />}
      <h3 style={{ margin: '14px 0 6px' }}>Academic requirement</h3>{follow('academic', 'minimum academic requirement')}
      {fl.academic ? null : <FormGrid fields={[...ACADEMIC.map((f) => (f.k === 'min_percent' ? { ...f, label: 'Minimum % (CGPA converted)' } : f)), { k: 'accepted_fields', label: 'Accepted backgrounds', type: 'multi', opts: fields.map((f) => [f.name, f.name] as [string, string]), col: 6 }, { k: 'note', label: 'Note', col: 6 }]}
        vals={ac} set={(k, x) => setAc((o) => ({ ...o, [k]: x }))} />}
      {c?.history?.length ? <details style={{ marginTop: 12 }}><summary>Change history</summary><table className="t small"><tbody>{c.history.map((h: Any) => <tr key={h.id}><td>{fmtDT(h.changed_at)}</td><td>{h.field}</td><td>{h.old_value || ''} → {h.new_value || ''}</td><td>{h.by}</td></tr>)}</tbody></table></details> : null}
    </Modal>
  );
}

// University logos: one by one, or many at once (file name = university name)
function LogoManager({ close }: { close: () => void }) {
  const [unis, setUnis] = useState<Any[] | null>(null);
  const [f, setF] = useState(''), [miss, setMiss] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const [prev, setPrev] = useState<Any | null>(null);
  const load = useCallback(() => GET('/admin/universities').then(setUnis).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  const send = (mode: string, files = picked) => { const fd = new FormData(); files.forEach((x) => fd.append('logos', x, x.name)); return SEND('post', `/admin/universities/logos/${mode}`, fd); };
  const onPick = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter((x) => /\.(png|jpe?g)$/i.test(x.name));
    setPicked(files); setPrev(null);
    if (files.length) try { setPrev(await send('preview', files)); } catch (e) { showError(e); }
  };
  const one = async (id: string, file?: File) => { if (!file) return; const fd = new FormData(); fd.append('logo', file); try { await SEND('post', `/admin/universities/${id}/logo`, fd); toast('Logo saved', 'ok'); load(); } catch (e) { showError(e); } };
  const tone = (s: string) => (s === 'Error' ? 'red' : s === 'New' ? 'green' : 'blue');
  const rows = (unis ?? []).filter((u) => (!f || u.name.toLowerCase().includes(f.toLowerCase())) && (!miss || !u.has_logo));
  return (
    <Modal title="University logos" size="xl" close={close} foot={<button className="btn" onClick={close}>Close</button>}>
      <div className="card" style={{ marginBottom: 12 }}><div className="bd"><b>Bulk upload</b>
        <p className="small" style={{ margin: '4px 0 8px' }}>Name every image exactly like the university, e.g. <code>University of Milan.png</code> (short name or university ID also work). PNG or JPG, max 2 MB each. Logos are resized to 256 × 256 automatically.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="btn">Choose images<input type="file" accept=".png,.jpg,.jpeg" multiple hidden onChange={(e) => onPick(e.target.files)} /></label>
          {/* @ts-expect-error webkitdirectory is not in the React types */}
          <label className="btn">Choose a folder<input type="file" accept=".png,.jpg,.jpeg" webkitdirectory="" multiple hidden onChange={(e) => onPick(e.target.files)} /></label>
          <span className="small muted">{picked.length ? `${picked.length} image(s) selected` : ''}</span><span className="grow" />
          {prev?.rows.some((x: Any) => x.status !== 'Error') ? <button className="btn primary" onClick={async () => { try { const r = await send('commit'); toast(`${r.rows.filter((x: Any) => x.status !== 'Error').length} logo(s) saved`, 'ok'); setPrev(null); setPicked([]); load(); } catch (e) { showError(e); } }}>Save logos</button> : null}
        </div>
        {prev ? <div style={{ marginTop: 10 }}>
          <div className="small" style={{ marginBottom: 6 }}>{Object.entries(prev.counts).map(([k, x]) => <span key={k} className={`badge ${tone(k)}`}>{k}: {String(x)}</span>)}</div>
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}><table className="t"><thead><tr><th>File</th><th>Result</th><th>University / reason</th></tr></thead><tbody>
            {prev.rows.map((x: Any, i: number) => <tr key={i}><td className="small">{x.file}</td><td><span className={`badge ${tone(x.status)}`}>{x.status}</span></td><td className="small">{x.university || x.reason}</td></tr>)}</tbody></table></div>
        </div> : null}
      </div></div>
      <div className="row" style={{ marginBottom: 8, gap: 8 }}><input className="input" placeholder="Filter universities" style={{ maxWidth: 280 }} value={f} onChange={(e) => setF(e.target.value)} />
        <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={miss} onChange={(e) => setMiss(e.target.checked)} /> Only without logo</label><span className="grow" />
        <span className="small muted">{unis ? `${unis.filter((u) => u.has_logo).length} of ${unis.length} have a logo` : ''}</span></div>
      <div className="logo-grid">{!unis ? <div className="empty">Loading...</div> : rows.length ? rows.map((u) => (
        <div key={u.id} className="logo-item">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u.logo} alt="" />
          <div className="grow" style={{ minWidth: 0 }}><div className="small" style={{ fontWeight: 600 }}>{u.name}</div><div className="small muted">{u.country || ''} · {u.courses} courses</div>
            <div className="row" style={{ gap: 4, marginTop: 4 }}><label className="btn xs">{u.has_logo ? 'Replace' : 'Upload'}<input type="file" accept=".png,.jpg,.jpeg" hidden onChange={(e) => one(u.id, e.target.files?.[0])} /></label>
              {u.has_logo ? <button className="btn xs ghost" onClick={async () => { try { await DEL(`/admin/universities/${u.id}/logo`); load(); } catch (e) { showError(e); } }}>Remove</button> : null}</div></div>
        </div>
      )) : <div className="empty">No universities</div>}</div>
    </Modal>
  );
}

function ImportReports({ close }: { close: () => void }) {
  const [b, setB] = useState<Any[] | null>(null);
  useEffect(() => { GET('/admin/catalogue-batches').then(setB).catch(showError); }, []);
  return (
    <Modal title="Import reports" size="lg" close={close}>
      <table className="t"><thead><tr><th>When</th><th>File</th><th>By</th><th>Result</th><th>Errors</th></tr></thead><tbody>
        {!b ? <tr><td colSpan={5} className="empty">Loading...</td></tr> : b.length ? b.map((x) => (
          <tr key={x.id}><td>{fmtDT(x.run_at)}</td><td>{x.file_name}</td><td>{x.by}</td><td className="small">{Object.entries(x.counts).map(([k, v]) => `${k} ${v}`).join(', ')}</td>
            <td>{x.errors ? <a href="#" onClick={(e) => { e.preventDefault(); download(`/admin/catalogue-batches/${x.id}/errors.xlsx`, `import-errors-${x.id}.xlsx`).catch(showError); }}>{x.errors} (Excel)</a> : '0'}</td></tr>
        )) : <tr><td colSpan={5} className="empty">No imports yet</td></tr>}</tbody></table>
    </Modal>
  );
}

// courses one university at a time: university list, settings (once for all its courses), Excel per university
function UniPanel({ tick, refresh }: { tick: number; refresh: () => void }) {
  const [unis, setUnis] = useState<Any[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => GET('/admin/catalogue/universities').then(setUnis).catch(showError), []);
  useEffect(() => { load(); }, [load, tick]);
  const both = () => { load(); refresh(); };
  const newUni = async () => {
    const r = await formModal<Any>({ title: 'New university', size: 'sm', values: {}, save: (v) => POST('/admin/catalogue/universities', v),
      fields: [{ k: 'name', label: 'University name', req: true, col: 6 }, { k: 'country_id', label: 'Country', type: 'select', req: true, opts: M.countries(true), col: 6 }, { k: 'city', label: 'City', col: 6 }, { k: 'website', label: 'Website (https://)', col: 6 }],
      intro: <p className="small muted" style={{ marginTop: 0 }}>The University ID is made automatically: country code + number (e.g. IT-004).</p> });
    if (r) { toast(`University created: ${r.uni_code}`, 'ok'); load(); }
  };
  const publish = async (u: Any) => {
    if (!(await confirmBox(`Publish all ${u.drafts} draft course(s) of ${u.uni_code} ${u.name}? Students will see them in course search. Courses with missing details stay Draft and are listed.`, { title: 'Publish courses', ok: 'Publish' }))) return;
    try { publishResult(await POST(`/admin/catalogue/universities/${u.id}/publish`, {})); both(); } catch (e) { showError(e); }
  };
  const rows = (unis ?? []).filter((u) => !q || `${u.uni_code} ${u.name} ${u.country}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="hd"><h2>Universities</h2><span className="muted small">Upload courses one university at a time. Intakes, deadlines and English tests are set once per university.</span><span className="grow" />
        <input className="input" style={{ maxWidth: 240 }} placeholder="Find a university" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn primary" onClick={newUni}>+ New university</button></div>
      <div className="bd flush"><div className="table-wrap"><table className="t cards"><thead><tr><th>University ID</th><th>University</th><th>Courses</th><th>University settings</th><th /></tr></thead><tbody>
        {!unis ? <tr><td colSpan={5} className="empty">Loading...</td></tr> : rows.length ? rows.map((u) => (
          <tr key={u.id}>
            <td data-label="University ID"><span className="badge blue mono">{u.uni_code || '-'}</span></td>
            <td data-label="University"><b>{u.name}</b><div className="small muted">{[u.city, u.country].filter(Boolean).join(', ')}</div></td>
            <td data-label="Courses">{u.courses} <span className="small muted">({u.published} published{u.own_values ? `, ${u.own_values} with own values` : ''})</span></td>
            <td data-label="Settings" className="small">{u.settings.intakes ? `${u.settings.intakes} intake(s)${u.settings.next_deadline ? ` · first deadline ${fmtDate(u.settings.next_deadline)}` : ''}` : <span className="badge orange">not set</span>}{u.settings.english ? <div className="muted">{u.settings.english}</div> : null}</td>
            <td><div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn xs" onClick={() => openOverlay((close) => <UniSettings id={u.id} close={close} done={both} />)}>Settings</button>
              <button className="btn xs" onClick={() => download(`/admin/catalogue/universities/${u.id}/excel`, `${u.uni_code || 'university'}-courses.xlsx`).catch(showError)}>⬇ Excel</button>
              <button className="btn xs primary" onClick={() => openOverlay((close) => <UniUpload u={u} close={close} done={both} />)}>⬆ Upload Excel</button>
              {u.drafts ? <button className="btn xs" style={{ borderColor: 'var(--green,#16a34a)', color: 'var(--green,#16a34a)' }} onClick={() => publish(u)}>✓ Publish {u.drafts} draft{u.drafts > 1 ? 's' : ''}</button> : null}
            </div></td>
          </tr>
        )) : <tr><td colSpan={5} className="empty">No universities yet: add one first.</td></tr>}</tbody></table></div></div>
    </div>
  );
}

export function CataloguePage() {
  const [f, setF] = useState({ q: '', status: '', country: '', stale: false });
  const [rows, setRows] = useState<Any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const draw = useCallback(() => GET('/admin/catalogue' + qs({ ...f, stale: f.stale ? '1' : '' })).then((r) => setRows(r.rows)).catch(showError), [f]);
  useEffect(() => { const t = setTimeout(draw, 200); return () => clearTimeout(t); }, [draw]);
  const bulk = async (status: string) => {
    try { publishResult(await POST('/admin/catalogue/status', { ids: [...sel], status }), status === 'Published' ? 'Published' : status === 'Hidden' ? 'Hidden' : 'Set to Draft'); setSel(new Set()); draw(); setTick((n) => n + 1); } catch (e) { showError(e); }
  };
  const openCourse = async (id: string | null) => {
    try { const c = id ? await GET('/admin/catalogue/' + id) : null; openOverlay((close) => <CourseForm c={c} close={close} done={draw} />); } catch (e) { showError(e); }
  };
  const tog = (id: string, on: boolean) => setSel((o) => { const n = new Set(o); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <>
      <UniPanel tick={tick} refresh={draw} />
      <div className="card">
        <div className="hd"><h2>All courses</h2><span className="muted small">Only Published courses are visible to students. Click a course to change it individually.</span><span className="grow" />
          <button className="btn" onClick={() => openOverlay((close) => <LogoManager close={close} />)}>University logos</button>
          <button className="btn" onClick={() => openOverlay((close) => <ImportReports close={close} />)}>Import reports</button>
          <Link className="btn" href="/courses">Preview search</Link><button className="btn primary" onClick={() => openCourse(null)}>+ Add one course</button></div>
        <div className="filters">
          <input type="search" placeholder="Course or university" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option><Options list={['Draft', 'Published', 'Hidden', 'Archived']} /></select>
          <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">All countries</option><Options list={M.countries(true)} /></select>
          <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={f.stale} onChange={(e) => setF({ ...f, stale: e.target.checked })} /> Not checked in 6 months</label>
        </div>
        {sel.size ? <div className="row" style={{ gap: 8, padding: '10px 16px', background: 'var(--soft,#f1f0fe)', borderRadius: 10, margin: '0 16px 10px' }}><b>{sel.size} course(s) selected</b><span className="grow" />
          <button className="btn xs primary" onClick={() => bulk('Published')}>✓ Publish selected</button><button className="btn xs" onClick={() => bulk('Draft')}>Set Draft</button><button className="btn xs" onClick={() => bulk('Hidden')}>Hide from students</button><button className="btn xs" onClick={() => setSel(new Set())}>Clear</button></div> : null}
        <div className="table-wrap">{!rows ? <div className="empty">Loading...</div> : rows.length ? (
          <table className="t cards"><thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Select all shown courses" checked={rows.every((c) => sel.has(c.id))} onChange={(e) => rows.forEach((c) => tog(c.id, e.target.checked))} /></th>
            <th>Course ID</th><th>Course</th><th>University</th><th>Country</th><th>Level</th><th>Tuition</th><th>Intakes</th><th>Status</th><th>Last checked</th></tr></thead><tbody>
            {rows.map((c) => (
              <tr key={c.id} className="click" onClick={() => openCourse(c.id)}>
                <td data-label="Select" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={(e) => tog(c.id, e.target.checked)} /></td>
                <td className="mono">{c.code || ''}</td><td><b>{c.name}</b>{c.not_in_last_import ? <> <span className="badge orange">not in last import</span></> : null}</td><td>{c.university}</td><td>{c.country}</td><td>{c.level || ''}</td>
                <td>{money(c.tuition_fee, c.currency)}</td><td>{c.intakes}</td><td><span className={`badge ${c.status === 'Published' ? 'green' : c.status === 'Draft' ? 'orange' : 'grey'}`}>{c.status}</span></td>
                <td className={c.stale ? 'days-red' : ''}>{fmtDate(c.last_verified_on) || 'never'}</td>
              </tr>
            ))}</tbody></table>
        ) : <div className="empty">No courses</div>}</div>
      </div>
    </>
  );
}

// ---------- student portal settings, accounts, deletion requests ----------
const PORTAL_FIELDS: Field[] = [{ k: 'a', type: 'section', label: 'Portal' }, { k: 'portal_enabled', label: 'Portal on', type: 'checkbox' }, { k: 'portal_signup', label: 'Self sign-up on', type: 'checkbox' }, { k: 'portal_google', label: 'Google login (needs Google OAuth setup)', type: 'checkbox' },
  { k: 'auto_invite', label: 'Auto-invite on Convert to Student', type: 'checkbox' }, { k: 'portal_idle_min', label: 'Idle timeout (minutes, 15-240)', type: 'number', min: 15, max: 240 }, { k: 'new_device_alert', label: 'Email on new device login', type: 'checkbox' },
  { k: 'b', type: 'section', label: 'Apply Now and work' }, { k: 'req_open_limit', label: 'Max open requests per student', type: 'number' }, { k: 'req_intake_limit', label: 'Max requests per intake', type: 'number' }, { k: 'request_review_days', label: 'Review task due in (days)', type: 'number' },
  { k: 'show_team_to_student', label: 'Show Application / Visa team to student', type: 'checkbox' }, { k: 'team_can_reply', label: 'Team can reply in chat', type: 'checkbox' }, { k: 'share_offer_auto', label: 'Share offer letters automatically', type: 'checkbox' },
  { k: 'student_task_confirm', label: 'Student tasks need counsellor confirmation', type: 'checkbox' }, { k: 'zip_download', label: 'Students can download all documents (ZIP)', type: 'checkbox' }, { k: 'referral_enabled', label: 'Referral on', type: 'checkbox' }, { k: 'publish_imported', label: 'Publish imported courses directly', type: 'checkbox' },
  { k: 'c', type: 'section', label: 'Office hours (chat)' }, { k: 'office_hours_text', label: 'Office hours text', col: 6 }, { k: 'office_days', label: 'Days (0 Sun ... 6 Sat, comma)', col: 2 }, { k: 'office_start', label: 'Start (HH:MM)', col: 2 }, { k: 'office_end', label: 'End (HH:MM)', col: 2 },
  { k: 'first_response_hours', label: 'First response target (hours)', type: 'number' },
  { k: 'd', type: 'section', label: 'Rules' }, { k: 'cgpa_factor', label: 'CGPA /10 to % factor', type: 'number', step: 0.1 }, { k: 'payment_reminder_days', label: 'Payment reminder days (E29)' }, { k: 'aps_link', label: 'APS India website link', col: 4 },
  { k: 'e', type: 'section', label: 'Terms and privacy (new version = students must accept again)' }, { k: 'terms_version', label: 'Terms version', col: 1 }, { k: 'privacy_version', label: 'Privacy version', col: 1 },
  { k: 'terms_text', label: 'Terms of Use text', type: 'textarea', rows: 5, col: 6 }, { k: 'privacy_text', label: 'Privacy Policy text', type: 'textarea', rows: 5, col: 6 }];
export function PortalAdmin({ portalUrl }: { portalUrl: string }) {
  const [d, setD] = useState<{ acc: Any[]; del: Any[] } | null>(null);
  const [v, setV] = useState<Vals>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const [s, acc, del] = await Promise.all([GET('/admin/settings'), GET('/admin/student-accounts'), GET('/admin/deletion-requests')]);
      const vals: Vals = {}; for (const f of PORTAL_FIELDS) if (f.type !== 'section') vals[f.k] = f.type === 'checkbox' ? s[f.k] === '1' : s[f.k];
      setV(vals); setD({ acc, del });
    } catch (e) { showError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const save = async () => {
    setErr({});
    const out: Vals = {}; for (const [k, x] of Object.entries(v)) out[k] = typeof x === 'boolean' ? (x ? '1' : '0') : x;
    try { await PUT('/admin/settings', out); toast('Portal settings saved (logged)', 'ok'); } catch (e) { fail(setErr)(e); }
  };
  const decide = async (x: Any, ok: boolean) => {
    const r = await confirmBox(ok ? 'Approve: the portal account is closed and its login data removed. CRM records follow your retention policy.' : 'Reject the deletion request? The student sees the reason.',
      { reason: true, reasonLabel: ok ? 'Note' : 'Reason (e.g. active visa process)', danger: ok, ok: ok ? 'Approve' : 'Reject' });
    if (!r) return;
    try { await POST(`/admin/deletion-requests/${x.id}/${ok ? 'approve' : 'reject'}`, { reason: r }); load(); } catch (e) { showError(e); }
  };
  const act = async (id: string, a: string) => {
    let body = {};
    if (a === 'lock') { const r = await confirmBox('Lock this portal account?', { reason: true, reasonLabel: 'Reason (shown to the student)' }); if (!r) return; body = { reason: r }; }
    try { await POST(`/admin/student-accounts/${id}/${a}`, body); toast('Done', 'ok'); load(); } catch (e) { showError(e); }
  };
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}><div className="hd"><h2>Student portal settings</h2><span className="grow" /><a className="btn sm" href={portalUrl} target="_blank" rel="noopener noreferrer">Open portal</a></div>
        <div className="bd"><form noValidate onSubmit={(e) => e.preventDefault()}><FormGrid fields={PORTAL_FIELDS} vals={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errors={err} />
          <div className="form-actions"><button className="btn primary" type="button" onClick={save}>Save</button></div></form></div></div>
      <div className="card" style={{ marginBottom: 14 }}><div className="hd"><h2>Account deletion requests</h2></div><div className="bd flush">{d.del.length ? (
        <table className="t"><thead><tr><th>Student</th><th>Reason</th><th>Requested</th><th>Status</th><th /></tr></thead><tbody>{d.del.map((x) => (
          <tr key={x.id}><td><b>{x.name}</b> <span className="mono small">{x.code}</span>{x.active_visa ? <> <span className="badge orange">active visa process</span></> : null}</td><td>{x.reason || '-'}</td><td>{fmtDT(x.created_at)}</td>
            <td>{x.status}{x.admin_reason ? <div className="small">{x.admin_reason}</div> : null}</td>
            <td className="nowrap">{x.status === 'Requested' ? <><button className="btn xs danger" onClick={() => decide(x, true)}>Approve</button> <button className="btn xs" onClick={() => decide(x, false)}>Reject</button></> : null}</td></tr>
        ))}</tbody></table>) : <div className="empty">No requests</div>}</div></div>
      <div className="card"><div className="hd"><h2>Student portal accounts</h2></div><div className="bd flush"><table className="t cards"><thead><tr><th>Student</th><th>Email</th><th>Status</th><th>Completion</th><th>Last login</th><th>Consents</th><th /></tr></thead><tbody>
        {d.acc.map((a) => (
          <tr key={a.id}><td><b>{a.name}</b><div className="small mono">{a.code}</div></td><td>{a.email || '-'}</td><td>{a.status}</td><td>{a.completion ?? 0}%</td><td>{a.last_login_at ? ago(a.last_login_at) : 'never'}</td>
            <td><details><summary className="small">{a.consents.length}</summary><div className="small">{a.consents.map((c: Any, i: number) => <div key={i}>{c.consent_type} {c.document_version || ''}: {String(c.value)} ({fmtDT(c.created_at)})</div>)}</div></details></td>
            <td className="nowrap">{a.status === 'Locked' ? <button className="btn xs" onClick={() => act(a.id, 'unlock')}>Unlock</button> : a.status !== 'Deactivated' ? <button className="btn xs" onClick={() => act(a.id, 'lock')}>Lock</button> : null} <button className="btn xs" onClick={() => act(a.id, 'force-logout')}>Force logout</button></td></tr>
        ))}</tbody></table></div></div>
    </>
  );
}
