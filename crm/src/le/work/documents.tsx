'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEL, GET, POST, PUT, SEND, ApiError, download } from '../api';
import { M, useMeta } from '../meta';
import { fmtDate, fmtDT, istToday } from '../format';
import { Options, formModal, toFormData, type Field } from '../form';
import { Modal, confirmBox, openOverlay, showError, toast } from '../ui';
import { StatusBadge } from '../badges';
import { EmailPreview, NotifyButtons } from '../notify';
import type { Ctx } from '../student/tabs';

/** The client's documents (legacy/public/js/pages/work.js documents). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const NO_UPLOAD = ['Offer letter', 'Fee receipt'];

export async function viewDocument(docId: string, versionId?: string) {
  let vs: Any[];
  try { vs = await GET(`/documents/${docId}/versions`); } catch (e) { showError(e); return; }
  const v = versionId ? vs.find((x) => x.id === versionId) : vs.find((x) => x.current) || vs[0];
  if (!v) { toast('No file uploaded yet', 'err'); return; }
  const isPdf = v.mime_type === 'application/pdf', isImg = /^image\//.test(v.mime_type ?? '');
  openOverlay((close) => (
    <Modal title={v.stored_name} size="xl" close={close} foot={<>
      <span className="small muted grow">Original file: {v.original_name} · v{v.version_no} · {fmtDT(v.uploaded_at)} by {v.uploaded_by_name}</span>
      <a className="btn primary" href={v.download_url || v.view_url} target="_blank" rel="noopener noreferrer">Download</a>
    </>}>
      {isPdf ? <iframe className="doc-frame" src={v.view_url} title={v.stored_name} /> : isImg ? <img className="doc-img" src={v.view_url} alt="" /> : <div className="empty">Preview is not available for this file type.</div>}
    </Modal>
  ));
}
async function versionsPopup(doc: Any) {
  let vs: Any[];
  try { vs = await GET(`/documents/${doc.id}/versions`); } catch (e) { showError(e); return; }
  openOverlay((close) => (
    <Modal title={`Version history: ${doc.name}`} size="lg" close={close}>
      <ul className="list-plain version-list">{vs.map((v) => (
        <li key={v.id}><div><b>v{v.version_no}</b> {v.current ? <span className="badge green">current</span> : null} <span className="mono small">{v.stored_name}</span>
          <div className="small muted">{v.original_name} · {((v.size_bytes ?? 0) / 1024).toFixed(0)} KB · {fmtDT(v.uploaded_at)} by {v.uploaded_by_name}</div></div>
          <div className="row"><button className="btn xs" onClick={() => viewDocument(doc.id, v.id)}>View</button><a className="btn xs" href={v.download_url || v.view_url} target="_blank" rel="noopener noreferrer">Download</a></div></li>
      ))}</ul>
    </Modal>
  ));
}
const downloadDoc = async (id: string) => { try { const r = await GET(`/documents/${id}/download`); window.open(r.url, '_blank', 'noopener'); } catch (e) { showError(e); } };

/** Several files are merged into ONE PDF, in the order chosen here (drag to reorder). */
function MergeOrder({ files, set }: { files: File[]; set: (k: string, v: unknown) => void }) {
  const from = useRef<number | null>(null);
  if ((files ?? []).length < 2) return null;
  return <>
    <div className="info-box">These {files.length} files will be merged into one PDF in this order (drag to reorder):</div>
    <ul className="list-plain">{files.map((f, i) => (
      <li key={f.name + i} draggable style={{ cursor: 'grab' }} onDragStart={() => { from.current = i; }} onDragOver={(e) => e.preventDefault()}
        onDrop={() => { if (from.current === null) return; const n = [...files]; const [x] = n.splice(from.current, 1); n.splice(i, 0, x); set('files', n); from.current = null; }}>☰ {f.name} <span className="muted small">{(f.size / 1024).toFixed(0)} KB</span></li>
    ))}</ul>
  </>;
}
export async function uploadDoc(s: Any, preset: Any = {}) {
  const types = M.list('document_type').filter((t) => !NO_UPLOAD.includes(t.name));
  const apps: Any[] = await GET(`/students/${s.id}/applications`).catch(() => []);
  const maxMb = useMeta.getState().meta?.settings.max_file_mb ?? 10;
  const fields: Field[] = [
    { k: 'document_type_id', label: 'Document type', type: 'select', req: true, opts: types, col: 3 }, { k: 'title', label: 'Title', req: true, col: 3, show: (v) => M.name(v.document_type_id) === 'Others' },
    { k: 'application_id', label: 'Linked to', type: 'select', blank: 'General', opts: apps.map((a) => [a.id, `${a.application_code} - ${a.university}`] as [string, string]), col: 3 },
    { k: 'expiry_date', label: 'Expiry date (passport, test, insurance)', type: 'date', col: 3 },
    { k: 'files', label: `File(s): PDF, JPG or PNG only, max ${maxMb} MB each`, type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png', col: 6, help: 'Select several files (e.g. 6 semester marksheets) to merge them into ONE PDF. Phone camera works too.' },
    { k: 'order', type: 'html', html: (v, set) => <MergeOrder files={v.files} set={set} /> }, { k: 'remark_internal', label: 'Internal remark (never emailed)', col: 6 },
  ];
  return formModal<Any>({
    title: `Upload document: ${s.first_name}`, size: 'lg', fields, values: preset, saveLabel: 'Upload',
    save: async (v) => {
      const fl: File[] = v.files ?? [];
      if (!fl.length) throw new ApiError(400, { error: 'Choose a file', errors: { files: 'Choose a file' } });
      if (fl.length > 1 && fl.some((f) => !/\.(pdf|jpe?g|png)$/i.test(f.name))) throw new ApiError(400, { error: 'Only PDF, JPG and PNG files can be merged', errors: { files: 'Only PDF, JPG and PNG files can be merged' } });
      for (const f of fl) if (f.size > (fl.length > 1 ? 25 : maxMb) * 1024 * 1024) throw new ApiError(400, { error: `${f.name} is too large`, errors: { files: `${f.name} is too large` } });
      const fd = toFormData({ ...v, files: undefined, order: undefined, ...(fl.length > 1 ? { merge: '1' } : {}) });
      fl.forEach((f) => fd.append('files', f));
      const r = await SEND('post', `/students/${s.id}/documents/upload`, fd);
      toast(`Uploaded as ${r.version?.stored_name ?? 'a new version'}`, 'ok');
      return r;
    },
  });
}

function RejectPopup({ doc, close, done }: { doc: Any; close: () => void; done: () => void }) {
  const reasons = M.list('doc_rejection_reason').map((r) => r.name);
  const [v, setV] = useState<Any>({ reason: '', text: '', message: '' });
  const [pv, setPv] = useState<Any | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => { const t = setTimeout(() => { POST(`/documents/${doc.id}/reject-preview`, v).then(setPv).catch(() => {}); }, 300); return () => clearTimeout(t); }, [JSON.stringify(v)]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (notify: boolean) => {
    setErr({});
    try { await POST(`/documents/${doc.id}/reject`, { ...v, notify }); toast('Rejected', 'ok'); close(); done(); } catch (e) { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) => setV((x: Any) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={`Reject ${doc.name}`} size="xl" close={close} foot={<NotifyButtons onSave={send} label="Reject and notify student" />}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
        <form noValidate onSubmit={(e) => e.preventDefault()}><div className="form-grid">
          <div className={`f c6${err.reason ? ' err' : ''}`}><label>Rejection reason<span className="req">*</span></label><select value={v.reason} onChange={set('reason')}><option value="">Select...</option><Options list={reasons} /></select><div className="msg">{err.reason ?? ''}</div></div>
          <div className="f c6"><label>Details (sent to the student)</label><textarea rows={2} value={v.text} onChange={set('text')} /></div>
          <div className="f c6"><label>Message from counsellor (optional)</label><textarea rows={2} value={v.message} onChange={set('message')} /></div>
        </div></form>
        <div><h4 style={{ marginBottom: 6 }}>Email preview (E09)</h4><EmailPreview pv={pv} /></div>
      </div>
    </Modal>
  );
}
function RequestDocs({ s, d, close, done }: { s: Any; d: Any; close: () => void; done: () => void }) {
  const types = M.list('document_type').filter((t) => !NO_UPLOAD.includes(t.name) && !t.visa);
  const pending = new Set<string>(d.checklist.filter((i: Any) => !i.doc || ['Pending', 'Rejected'].includes(i.doc.status)).map((i: Any) => i.document_type_id));
  const [sel, setSel] = useState<Set<string>>(pending);
  const [other, setOther] = useState(''), [due, setDue] = useState(''), [msg, setMsg] = useState('');
  const send = async (notify: boolean) => {
    if (!sel.size) { toast('Select documents', 'err'); return; }
    const others = M.list('document_type').find((t) => t.name === 'Others');
    try {
      await POST(`/students/${s.id}/documents/request`, { items: [...sel].map((id) => ({ document_type_id: id, title: others && id === others.id ? other : null })), due_date: due || null, notify, message: msg });
      toast('Requested', 'ok'); close(); done();
    } catch (e) { showError(e); }
  };
  return (
    <Modal title="Request documents from student (E11)" size="lg" close={close} foot={<NotifyButtons onSave={send} label="Request and email student" />}>
      <p className="small muted" style={{ marginTop: 0 }}>Selected documents are added as Pending and the student gets one email with the list.</p>
      <div className="f c6"><div className="ms">{types.map((t) => <label key={t.id}><input type="checkbox" checked={sel.has(t.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} />{t.name}</label>)}</div></div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div className="f c3"><label>Title for &quot;Others&quot;</label><input type="text" value={other} onChange={(e) => setOther(e.target.value)} /></div>
        <div className="f c3"><label>Please send by</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="f c6"><label>Message from counsellor (optional)</label><textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
function Verify({ doc, close, done }: { doc: Any; close: () => void; done: () => void }) {
  const win = useMeta((x) => (x.meta?.settings as Any)?.batching_window_min ?? 2);
  const go = async (notify: boolean) => { try { await POST(`/documents/${doc.id}/verify`, { notify }); toast('Verified', 'ok'); close(); done(); } catch (e) { showError(e); } };
  return <Modal title={`Verify ${doc.name}`} size="sm" close={close} foot={<NotifyButtons onSave={go} label="Verify and notify" />}>
    <p>Mark <b>{doc.name}</b> as Verified? The student gets email E10 (verifications within {win} minutes are combined into one email).</p>
  </Modal>;
}

/** what La Europa received from the universities, uploaded once here; a submission proof or an offer letter moves that application forward */
function InstitutionDocs({ s, P, reload }: { s: Any; P: Any; reload: () => void }) {
  const [d, setD] = useState<Any | null>(null);
  const [cat, setCat] = useState('all');
  const load = useCallback(() => GET(`/students/${s.id}/institution-documents`).then(setD).catch(() => setD(null)), [s.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const rows = d.rows.filter((x: Any) => cat === 'all' || x.category === cat);
  const n = (k: string) => d.rows.filter((x: Any) => x.category === k).length;
  const upload = async () => {
    if (!d.applications.length) { toast('Add an application first: every document from a university belongs to one application.', 'err'); return; }
    const r = await formModal<Any>({
      title: 'Upload a document from the university / institution', values: { category: cat !== 'all' ? cat : d.categories[0]?.key, application_id: d.applications[0]?.id, share: true },
      fields: [
        { k: 'category', label: 'Category', type: 'select', req: true, noBlank: true, opts: d.categories.map((c: Any) => [c.key, c.name] as [string, string]), col: 3 },
        { k: 'application_id', label: 'University / application', type: 'select', req: true, noBlank: true, opts: d.applications.map((a: Any) => [a.id, a.label] as [string, string]), col: 3 },
        { k: 'title', label: 'Title (optional)', maxlength: 150, col: 6 }, { k: 'file', label: 'File (PDF / JPG / PNG)', type: 'file', req: true, accept: '.pdf,.jpg,.jpeg,.png', col: 6 },
        { k: 'share', label: "Share with the student (shows in the student's Documents)", type: 'checkbox', col: 6 },
        { k: 'hint', type: 'html', html: (v) => { const c = d.categories.find((x: Any) => x.key === v.category); return <p className="small muted" style={{ marginBottom: 0 }}>{c?.moves_to ? `The application moves to "${c.moves_to}" automatically (only forward) and the student is told.` : 'The application stage does not change.'}</p>; } },
      ],
      saveLabel: 'Upload', save: (v) => SEND('post', `/students/${s.id}/institution-documents`, toFormData({ ...v, share: v.share ? '1' : '0', hint: undefined })),
    });
    if (r) { toast(r.stage_moved_to ? `Uploaded. Application moved to ${r.stage_moved_to}` : 'Uploaded', 'ok'); load(); reload(); }
  };
  return (
    <div className="card">
      <div className="hd"><h2>Documents uploaded by counsellor</h2><span className="small muted">From universities and institutions, shared with the student</span><span className="grow" />{P.documents_edit ? <button className="btn sm primary" onClick={upload}>Upload from university</button> : null}</div>
      <div className="bd" style={{ paddingBottom: 0 }}><div className="chips" style={{ padding: 0 }}>
        <span className={`chip ${cat === 'all' ? '' : 'off'}`} onClick={() => setCat('all')}>All ({d.rows.length})</span>
        {d.categories.map((c: Any) => <span key={c.key} className={`chip ${cat === c.key ? '' : 'off'}`} onClick={() => setCat(c.key)}>{c.name} ({n(c.key)})</span>)}
      </div></div>
      <div className="bd flush" style={{ marginTop: 12 }}><div className="table-wrap"><table className="t cards"><thead><tr><th>Document</th><th>University / application</th><th>Uploaded</th><th>Student</th><th /></tr></thead><tbody>
        {rows.length ? rows.map((x: Any) => (
          <tr key={x.id}>
            <td data-label="Document"><b>{x.name}</b>{x.title ? <div className="small muted">{x.title}</div> : null}{x.versions > 1 ? <div className="small muted">v{x.version_no}</div> : null}</td>
            <td data-label="University">{x.university || '-'}<div className="small mono muted">{x.application_code || ''}</div></td>
            <td data-label="Uploaded" className="small">{fmtDT(x.uploaded_at)}<br /><span className="muted">{x.uploaded_by}</span></td>
            <td data-label="Student">{x.shared_with_student ? <span className="badge green">Shared</span> : <span className="badge grey">Not shared</span>}</td>
            <td className="nowrap"><button className="btn xs" onClick={() => viewDocument(x.id)}>View</button> <button className="btn xs" onClick={() => downloadDoc(x.id)}>Download</button></td>
          </tr>
        )) : <tr><td colSpan={5} className="empty">Nothing in this category yet.</td></tr>}
      </tbody></table></div></div>
    </div>
  );
}

export function DocumentsTab({ s, P, reload: reloadFrame, openUpload }: Ctx & { openUpload?: boolean }) {
  const [d, setD] = useState<Any | null>(null);
  const opened = useRef(false);
  const load = useCallback(async () => { try { setD(await GET(`/students/${s.id}/documents`)); } catch (e) { showError(e); } }, [s.id]);
  useEffect(() => { load(); }, [load]);
  const reload = () => { load(); reloadFrame(); };
  useEffect(() => { if (openUpload && !opened.current) { opened.current = true; uploadDoc(s).then((r) => { if (r) reload(); }); } }, [openUpload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="empty">Loading...</div>;
  const pct = d.progress.total ? Math.round(d.progress.verified / d.progress.total * 100) : 0;
  const share = async (doc: Any, on: boolean) => { try { await POST(`/documents/${doc.id}/share`, { shared: on }); toast(on ? 'Shared with the student portal' : 'Hidden from the student portal', 'ok'); load(); } catch (e) { showError(e); } };
  const meta = async (doc: Any) => {
    const r = await formModal({ title: `Edit ${doc.name}`, size: 'sm', values: doc, save: (v) => PUT(`/documents/${doc.id}`, v),
      fields: [...(doc.type_name === 'Others' ? [{ k: 'title', label: 'Title', req: true, col: 6 } as Field] : []), { k: 'expiry_date', label: 'Expiry date', type: 'date', col: 6 }, { k: 'remark_internal', label: 'Internal remark', type: 'textarea', col: 6 }] });
    if (r) load();
  };
  const del = async (doc: Any) => { const r = await confirmBox('Delete this document and all its versions? (Admin, soft delete)', { danger: true, ok: 'Delete', reason: true }); if (r) { try { await DEL(`/documents/${doc.id}`, { reason: r }); reload(); } catch (e) { showError(e); } } };
  const row = (name: string, rule: string, doc: Any | null, typeId: string) => (
    <tr key={(doc?.id ?? '') + typeId + name} className="doc-row">
      <td data-label="Document"><b>{name}</b>{rule && rule !== 'Yes' ? <> <span className="badge grey">{rule}</span></> : rule === 'Yes' ? <> <span className="badge blue">Required</span></> : null}
        {doc?.stored_name ? <div className="small mono muted">{doc.stored_name}</div> : null}
        {doc?.remark_internal ? <div className="small muted">{doc.remark_internal} <span className="internal-label">Internal</span></div> : null}
        {doc?.by_student ? <span className="badge purple">Uploaded by student</span> : null}{doc?.student_note ? <div className="small">Student note: {doc.student_note}</div> : null}
        {doc?.current_version_id && P.documents_edit ? <label className="small row" style={{ gap: 4, marginTop: 3 }}><input type="checkbox" defaultChecked={!!doc.shared_with_student} onChange={(e) => share(doc, e.target.checked)} /> Share with student</label> : null}</td>
      <td data-label="Status"><StatusBadge s={doc ? doc.status : 'Pending'} />
        {doc?.status === 'Rejected' ? <div className="small" style={{ color: 'var(--red)' }}>{doc.rejection_reason}{doc.rejection_text ? ': ' + doc.rejection_text : ''}</div> : null}
        {doc?.requested_due && doc.status === 'Pending' ? <div className="small muted">Requested by {fmtDate(doc.requested_due)}</div> : null}</td>
      <td data-label="Version">{doc?.version_no ? <>v{doc.version_no}{doc.versions > 1 ? <> <a href="#" className="small" onClick={(e) => { e.preventDefault(); versionsPopup(doc); }}>history</a></> : null}</> : '-'}</td>
      <td data-label="Uploaded" className="small">{doc?.uploaded_at ? <>{fmtDT(doc.uploaded_at)}<br /><span className="muted">{doc.uploaded_by_name}</span></> : null}
        {doc?.verified_by_name && doc.status !== 'Uploaded' ? <div className="muted">{doc.status} by {doc.verified_by_name}</div> : null}</td>
      <td data-label="Linked" className="small">{doc?.linked ?? ''}{doc?.expiry_date ? <div className={doc.expiry_date < istToday() ? 'days-red' : 'muted'}>Expires {fmtDate(doc.expiry_date)}</div> : null}</td>
      <td className="nowrap">
        {doc?.current_version_id ? <><button className="btn xs" onClick={() => viewDocument(doc.id)}>View</button> <button className="btn xs" onClick={() => downloadDoc(doc.id)}>Download</button> </> : null}
        {P.documents_edit ? <button className="btn xs" onClick={async () => { if (await uploadDoc(s, { document_type_id: typeId })) reload(); }}>{doc?.current_version_id ? 'New version' : 'Upload'}</button> : null}
        {P.documents_edit && doc?.status === 'Uploaded' ? <> <button className="btn xs primary" onClick={() => openOverlay((close) => <Verify doc={doc} close={close} done={reload} />)}>Verify</button></> : null}
        {P.documents_edit && doc && ['Uploaded', 'Verified'].includes(doc.status) ? <> <button className="btn xs danger" onClick={() => openOverlay((close) => <RejectPopup doc={doc} close={close} done={reload} />)}>Reject</button></> : null}
        {P.documents_edit && doc ? <> <button className="btn xs ghost" onClick={() => meta(doc)}>Edit</button></> : null}
        {P.documents_delete && doc ? <> <button className="btn xs ghost" onClick={() => del(doc)}>Delete</button></> : null}
      </td>
    </tr>
  );
  return (
    <>
      <div className="card">
        <div className="hd"><h2>Documents</h2>
          <div style={{ minWidth: 220 }}><div className="small"><b>{d.progress.verified} of {d.progress.total}</b> required verified</div><div className="progress"><i style={{ width: `${pct}%` }} /></div></div><span className="grow" />
          {P.documents_edit ? <button className="btn sm" onClick={() => openOverlay((close) => <RequestDocs s={s} d={d} close={close} done={reload} />)}>Request documents</button> : null}
          <button className="btn sm" onClick={() => download(`/students/${s.id}/documents/zip`, `${s.student_code}-documents.zip`).catch(showError)}>Download all verified (ZIP)</button>
          {P.documents_edit ? <button className="btn sm primary" onClick={async () => { if (await uploadDoc(s)) reload(); }}>Upload</button> : null}
        </div>
        {d.folder ? <div className="bd" style={{ paddingBottom: 0 }}><div className="ok-box">Student folder: Student › {String(d.folder).replace(/[\\/]/g, ' › ')}</div></div> : null}
        <div className="bd flush"><div className="table-wrap"><table className="t cards"><thead><tr><th>Checklist (based on countries and level)</th><th>Status</th><th>Version</th><th>Uploaded</th><th>Linked / expiry</th><th /></tr></thead><tbody>
          {d.checklist.length ? d.checklist.map((i: Any) => row(i.name, i.required, i.doc, i.document_type_id)) : <tr><td colSpan={6} className="empty">No checklist. Set a preferred country or add an application.</td></tr>}
          {d.others.length ? <><tr><td colSpan={6} style={{ background: 'var(--panel-2)' }}><h4>Other documents</h4></td></tr>{d.others.map((x: Any) => row(x.name, '', x, x.document_type_id))}</> : null}
        </tbody></table></div></div>
      </div>
      <div style={{ marginTop: 16 }}><InstitutionDocs s={s} P={P} reload={reload} /></div>
    </>
  );
}
