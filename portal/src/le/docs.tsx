'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEL, GET, POST, SEND, download } from './api';
import { fmtDate, fmtDT } from './format';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { LockedCard, t, usePMe, type Any } from './p';

/** The client's documents (legacy/public/portal/js/docs.js): file picker, uploads, version history, the Documents page. */

export function openChatWith(type: string, id: string, label: string) {
  try { sessionStorage.setItem('lep:ctx', JSON.stringify({ type, id, label })); } catch { /* storage blocked */ }
  window.location.href = '/chat';
}
let typesCache: Any[] | null = null;
async function resolveType(name: string) {
  if (!typesCache) typesCache = (await GET('/documents')).upload_types || [];
  return typesCache!.find((tp) => tp.name === name)?.id as string | undefined;
}
const imgSize = (file: File) => new Promise<number | null>((res) => {
  if (!/^image\//.test(file.type)) { res(null); return; }
  const u = URL.createObjectURL(file); const i = new Image();
  i.onload = () => { res(Math.max(i.width, i.height)); URL.revokeObjectURL(u); }; i.onerror = () => res(null); i.src = u;
});

type Picked = { files: File[]; note: string; title: string };
type PickOpts = { title: string; intro?: React.ReactNode; note?: boolean; askTitle?: boolean; titleValue?: string; accept?: string; initial?: File[]; maxMb?: number; send: (p: Picked) => Promise<unknown> };
function FilePicker({ o, close, done }: { o: PickOpts; close: () => void; done: () => void }) {
  const maxMb = o.maxMb ?? 10, note0 = o.note !== false;
  const [files, setFiles] = useState<File[]>(o.initial ?? []);
  const [small, setSmall] = useState<string[]>([]);
  const [note, setNote] = useState(''), [title, setTitle] = useState(o.titleValue ?? '');
  const [drag, setDrag] = useState(false), [from, setFrom] = useState<number | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { let on = true; Promise.all(files.map(async (f) => ((await imgSize(f)) ?? 9999) < 1000 ? f.name : null)).then((x) => { if (on) setSmall(x.filter(Boolean) as string[]); }); return () => { on = false; }; }, [files]);
  const add = (list: FileList | File[] | null) => {
    const next = [...files];
    for (const f of [...(list ?? [])]) { if (/\.heic$/i.test(f.name)) { toast(t('iPhone HEIC photos cannot be read yet. Please use JPG or PDF.'), 'err'); continue; } next.push(f); }
    if (next.length > 20) toast(t('Maximum 20 files'), 'err');
    setFiles(next.slice(0, 20));
  };
  const go = async () => {
    if (!files.length) { toast(t('Choose a file'), 'err'); return; }
    if (files.length === 1 && files[0].size > maxMb * 1048576) { toast(t('File is larger than {n} MB', { n: maxMb }), 'err'); return; }
    if (o.askTitle && !title.trim()) { toast(t('Title'), 'err'); return; }
    setBusy(true);
    try { await o.send({ files, note, title }); done(); close(); } catch (e) { showError(e); setBusy(false); }
  };
  return (
    <Modal title={o.title} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? t('Uploading...') : t('Upload')}</button></>}>
      {o.intro}
      {o.askTitle ? <div className="f"><label>{t('Title')}<span className="req">*</span></label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div> : null}
      <div className={`dropzone${drag ? ' drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
        {t('Drop files here, or')} <label className="btn sm" style={{ margin: 6 }}>{t('Choose files')}<input type="file" multiple accept={o.accept ?? '.pdf,.jpg,.jpeg,.png'} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>
        <label className="btn sm">{t('Take photo')}<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>
        <div className="small">{t('PDF, JPG or PNG only · max {n} MB each · compressed automatically, quality stays the same', { n: maxMb })}</div></div>
      {files.length ? <div style={{ marginTop: 10 }}>
        {files.length > 1 ? <div className="info-box small" style={{ marginBottom: 6 }}>{t('We will merge these into one PDF in this order (drag to reorder).')}</div> : null}
        <ul className="list-plain">{files.map((f, i) => (
          <li key={i + f.name} draggable style={{ cursor: 'grab' }} onDragStart={() => setFrom(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (from === null) return; const n = [...files]; const [x] = n.splice(from, 1); n.splice(i, 0, x); setFiles(n); }}>
            <span>☰</span><span className="grow">{f.name} <span className="small muted">{(f.size / 1048576).toFixed(1)} MB</span>{f.size > maxMb * 1048576 ? <span className="small days-red"> {t('too large')}</span> : null}</span>
            <button className="btn xs" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button></li>
        ))}</ul>
        {small.length ? <div className="warn-box small">{t('This photo may be too small to read.')} ({small.join(', ')})</div> : null}
      </div> : null}
      {note0 ? <div className="f" style={{ marginTop: 10 }}><label>{t('Note for counsellor (optional)')}</label><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div> : null}
    </Modal>
  );
}
const pick = (o: PickOpts) => new Promise<boolean>((resolve) => {
  let ok = false;
  openOverlay((close) => <FilePicker o={o} close={close} done={() => { ok = true; }} />, { onClose: () => resolve(ok) });
});
const sendTo = (url: string, extra: Record<string, unknown> = {}) => async (p: Picked) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) fd.append(k, String(v));
  if (p.note) fd.append('note', p.note);
  p.files.forEach((f) => fd.append('files', f));
  const r = await SEND('post', url, fd);
  toast(t(r?.message || 'Uploaded. La Europa will check it soon.'), 'ok');
};

/** upload for one checklist item: { type_id | typeName, name, title?, help?, askTitle? } */
export async function uploadDialog(item: Any, initial: File[] = []) {
  if (usePMe.getState().me?.account_type !== 'student') { toast(t('Available after your registration with La Europa'), 'err'); return false; }
  const typeId = item.type_id || (item.typeName ? await resolveType(item.typeName) : undefined);
  const others = !item.type_id && !typeId;
  const othersId = await resolveType('Others');
  return pick({ title: `${t('Upload')}: ${item.name}`, initial, intro: item.help ? <p className="small muted">{t(item.help)}</p> : null, askTitle: others || !!item.askTitle, titleValue: item.title || '',
    send: (p) => {
      let title = others || item.askTitle ? p.title : item.title;
      if (!title && (typeId || othersId) === othersId) title = item.name;
      return sendTo('/documents/upload', { document_type_id: typeId || othersId, title })(p);
    } });
}
export const uploadFilesDialog = ({ title, url, extra = {} }: { title: string; url: string; extra?: Record<string, unknown> }) => pick({ title, send: sendTo(url, extra) });

function Versions({ doc, close }: { doc: Any; close: () => void }) {
  const [vs, setVs] = useState<Any[] | null>(null);
  useEffect(() => { GET(`/documents/${doc.id}/versions`).then(setVs).catch(showError); }, [doc.id]);
  return (
    <Modal title={`${t('Version history')}: ${doc.name}`} close={close}>
      {!vs ? <div className="empty">{t('Loading...')}</div> : <ul className="list-plain">{vs.map((v) => (
        <li key={v.id ?? v.version_no}><div className="grow"><b>v{v.version_no}</b> {v.current ? <span className="badge green">{t('current')}</span> : null} <span className={`badge ${v.status === 'Rejected' ? 'red' : v.status === 'Verified' ? 'green' : ''}`}>{t(v.status)}</span>
          <div className="small muted">{fmtDT(v.uploaded_at)} · {t('uploaded by')} {t(v.uploaded_by)}{v.reason ? ` · ${v.reason}` : ''}</div></div>
          {v.view_url ? <><a className="btn xs" href={v.view_url} target="_blank" rel="noopener noreferrer">{t('View')}</a><a className="btn xs" href={v.download_url}>{t('Download')}</a></> : null}</li>
      ))}</ul>}
    </Modal>
  );
}

export function taskDone(id: string) {
  return new Promise<boolean>((resolve) => {
    let ok = false;
    function Dlg({ close }: { close: () => void }) {
      const [c, setC] = useState(''), [files, setFiles] = useState<FileList | null>(null), [busy, setBusy] = useState(false);
      const go = async () => {
        if (files && files.length > 5) { toast(t('Maximum 5 files'), 'err'); return; }
        const fd = new FormData(); fd.append('comment', c); for (const f of [...(files ?? [])]) fd.append('files', f);
        setBusy(true);
        try { await SEND('post', `/tasks/${id}/done`, fd); ok = true; toast(t('Thank you! Your counsellor has been told.'), 'ok'); close(); } catch (e) { setBusy(false); showError(e); }
      };
      return (
        <Modal title={t('Mark as done')} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={go}>{t('Mark as done')}</button></>}>
          <div className="f"><label>{t('Comment (optional)')}</label><textarea className="input" rows={3} maxLength={500} style={{ height: 'auto', padding: 8 }} value={c} onChange={(e) => setC(e.target.value)} /></div>
          <div className="f" style={{ marginTop: 10 }}><label>{t('Files (optional, up to 5)')}</label><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(e.target.files)} /></div>
        </Modal>
      );
    }
    openOverlay((close) => <Dlg close={close} />, { onClose: () => resolve(ok) });
  });
}

const ss = (k: string, d: string) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } };
const ssSet = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } };
export function DocumentsPage({ initialTab }: { initialTab?: string }) {
  const [d, setD] = useState<Any | null>(null);
  const [tab, setTab] = useState(() => (initialTab && initialTab !== 'institution' ? initialTab : ss('lep:dtab', 'all')));
  const [icat, setIcat] = useState(() => ss('lep:icat', 'all'));
  const load = useCallback(() => GET('/documents').then((x) => { typesCache = x.upload_types; setD(x); }).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (d && initialTab === 'institution') setTimeout(() => document.getElementById('inst')?.scrollIntoView({ block: 'start' }), 50); }, [d, initialTab]);
  if (!d) return <div className="empty-p">{t('Loading...')}</div>;
  if (d.locked) return <><div className="p-head"><h1>{t('Documents')}</h1></div><LockedCard /></>;
  const items = d.checklist.filter((i: Any) => i.required !== 'No');
  const filt = (i: Any) => (tab === 'action' ? ['Pending', 'Rejected'].includes(i.status) : tab === 'uploaded' ? i.status === 'Uploaded' : tab === 'verified' ? i.status === 'Verified' : true);
  const actionN = items.filter((i: Any) => ['Pending', 'Rejected'].includes(i.status)).length;
  const newShared = d.shared.filter((x: Any) => x.is_new).length;
  const pct = d.progress.total ? Math.round(d.progress.verified / d.progress.total * 100) : 0;
  const inst: Any[] = d.institution || [];
  const instItems = inst.filter((c) => icat === 'all' || c.key === icat).flatMap((c) => c.items);
  const seen = (id: string) => () => { POST(`/documents/${id}/seen`).catch(() => {}); };
  const up = async (i: Any, files: File[] = []) => { if (await uploadDialog({ type_id: i.type_id, name: i.name, help: i.help }, files)) load(); };
  const remove = async (id: string) => { if (await confirmBox(t('Remove your latest upload? The document goes back to its previous status.'), { danger: true, ok: t('Remove'), cancel: t('Cancel') })) { try { await DEL(`/documents/${id}/latest`); load(); } catch (e) { showError(e); } } };
  const addOther = () => openOverlay((close) => <AddOther types={d.upload_types} close={close} done={load} />);
  const Row = ({ i }: { i: Any }) => {
    const doc = i.doc; const [over, setOver] = useState(false);
    return (
      <div className={`doc-item${over ? ' drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); up(i, [...e.dataTransfer.files]); }}>
        <div className="grow"><b>{i.name}</b>{i.required === 'Yes' ? null : <> <span className="badge grey">{t('Optional')}</span></>}
          {i.help ? <div className="help">{t(i.help)}</div> : null}<div className={`small st-${i.status}`} style={{ marginTop: 3 }}>{t(i.status_label)}{i.reason ? <>: <b>{i.reason}</b></> : null}</div>
          {doc ? <div className="small muted">v{doc.version_no} · {fmtDate(doc.uploaded_at)} · {t('by')} {t(doc.uploaded_by)}</div> : null}</div>
        <div className="acts">
          {doc?.view_url ? <><a className="btn xs" href={doc.view_url} target="_blank" rel="noopener noreferrer">{t('View')}</a><a className="btn xs" href={doc.download_url}>{t('Download')}</a><button className="btn xs" onClick={() => openOverlay((close) => <Versions doc={{ id: doc.id, name: i.name }} close={close} />)}>{t('History')}</button></> : null}
          {i.status !== 'Verified' ? <button className="btn xs primary" onClick={() => up(i)}>{i.status === 'Rejected' ? t('Re-upload') : i.status === 'Uploaded' ? t('Replace') : t('Upload')}</button> : null}
          {doc?.can_remove ? <button className="btn xs danger" onClick={() => remove(doc.id)}>{t('Remove')}</button> : null}
        </div>
      </div>
    );
  };
  const tabs: [string, string][] = [['all', t('All')], ['action', `${t('Action needed')} (${actionN})`], ['uploaded', t('Uploaded')], ['verified', t('Verified')], ['shared', `${t('Shared with me')}${newShared ? ` (${newShared} ${t('new')})` : ''}`]];
  return (
    <>
      <div className="p-head"><h1>{t('Documents')}</h1><span className="grow" />{d.zip ? <button className="btn sm" onClick={() => download('/documents-zip', 'My-documents.zip').catch(showError)}>{t('Download all (ZIP)')}</button> : null}<button className="btn sm primary" onClick={addOther}>+ {t('Add other document')}</button></div>
      <div className="p-card" style={{ marginBottom: 12 }}><div className="bd"><div className="row between"><b>{t('{a} of {b} verified', { a: d.progress.verified, b: d.progress.total })}</b><span className="small muted">{pct}%</span></div><div className="progress" style={{ marginTop: 6 }}><i style={{ width: pct + '%' }} /></div></div></div>
      <div className="chips-x">{tabs.map(([k, l]) => <span key={k} className={`chip ${tab === k ? '' : 'off'}`} onClick={() => { ssSet('lep:dtab', k); setTab(k); }}>{l}</span>)}</div>
      <div className="p-card"><div className="bd flush">{tab === 'shared'
        ? (d.shared.length ? d.shared.map((x: Any) => (
          <div key={x.id} className="doc-item"><div className="grow"><b>{x.name}</b> {x.is_new ? <span className="badge red">{t('New')}</span> : null}<div className="small muted">{t('From La Europa')} · {fmtDate(x.uploaded_at)}</div></div>
            <div className="acts"><a className="btn xs" href={x.view_url} target="_blank" rel="noopener noreferrer" onClick={seen(x.id)}>{t('View')}</a><a className="btn xs" href={x.download_url} onClick={seen(x.id)}>{t('Download')}</a>
              {/draft/i.test(x.name) ? <button className="btn xs" onClick={() => openChatWith('document', x.id, x.name)}>{t('Send feedback')}</button> : null}</div></div>
        )) : <div className="empty-p">{t('Documents shared by La Europa will appear here.')}</div>)
        : <>{items.filter(filt).length ? items.filter(filt).map((i: Any) => <Row key={i.type_id} i={i} />) : <div className="empty-p">{t('Nothing here')}</div>}
          {tab === 'all' && d.others.length ? <><div style={{ padding: '10px 15px', background: 'var(--panel-2)' }}><h4>{t('Other documents')}</h4></div>
            {d.others.map((x: Any) => <Row key={x.id} i={{ type_id: x.type_id, name: x.name, required: 'No', status: x.status, status_label: x.status_label, reason: x.reason, doc: x }} />)}</> : null}</>}</div></div>
      <div className="p-card" id="inst" style={{ margin: '16px 0 12px' }}><div className="hd"><h2>{t('Documents uploaded by your counsellor')}</h2><span className="small muted">{t('Received from your universities and institutions')}</span></div>
        <div className="bd" style={{ paddingBottom: 6 }}><div className="chips-x" style={{ margin: 0 }}>{[{ key: 'all', name: 'All', items: inst.flatMap((c) => c.items) }, ...inst].map((c) => (
          <span key={c.key} className={`chip ${icat === c.key ? '' : 'off'}`} onClick={() => { ssSet('lep:icat', c.key); setIcat(c.key); }}>{t(c.name)} ({c.items.length})</span>))}</div></div>
        <div className="bd flush">{instItems.length ? instItems.map((x: Any) => (
          <div key={x.id} className="doc-item"><div className="grow"><b>{t(x.name)}</b> {x.is_new ? <span className="badge red">{t('New')}</span> : null}<div className="small muted">{x.university || ''}{x.application_code ? <> · <span className="mono">{x.application_code}</span></> : null} · {fmtDate(x.uploaded_at)}</div></div>
            <div className="acts"><a className="btn xs" href={x.view_url} target="_blank" rel="noopener noreferrer" onClick={seen(x.id)}>{t('View')}</a><a className="btn xs" href={x.download_url} onClick={seen(x.id)}>{t('Download')}</a></div></div>
        )) : <div className="empty-p">{t('Offer letters, invoices, agreements and other documents from your universities will appear here.')}</div>}</div></div>
      <p className="small muted">{t('Files are renamed automatically, for example')} <span className="mono">LE-S-2026-00012_Passport_v2.pdf</span>. {t('Verified documents cannot be removed or replaced.')}</p>
    </>
  );
}
function AddOther({ types, close, done }: { types: Any[]; close: () => void; done: () => void }) {
  const [id, setId] = useState<string>(types.find((x) => x.name === 'Others')?.id ?? types[0]?.id ?? '');
  const next = async () => {
    const nm = types.find((x) => x.id === id)?.name ?? '';
    close();
    if (await uploadDialog({ type_id: id, name: t(nm), askTitle: nm === 'Others' })) done();
  };
  return (
    <Modal title={t('Add other document')} size="sm" close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={next}>{t('Next')}</button></>}>
      <div className="f"><label>{t('Document type')}</label><select className="input" value={id} onChange={(e) => setId(e.target.value)}>{types.map((x) => <option key={x.id} value={x.id}>{t(x.name)}</option>)}</select></div>
    </Modal>
  );
}
