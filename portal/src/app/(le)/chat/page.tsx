'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DEL, GET, PATCH, POST, SEND } from '@/le/api';
import { fmtDate, fmtTime, initials } from '@/le/format';
import { Icon } from '@/le/Icon';
import { formModal } from '@/le/form';
import { confirmBox, showError, toast } from '@/le/ui';
import { local, t, usePMe, type Any } from '@/le/p';

const day = (d: string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayLabel = (iso: string) => { const d = day(iso); return d === day(new Date().toISOString()) ? t('Today') : d === day(new Date(Date.now() - 864e5).toISOString()) ? t('Yesterday') : fmtDate(iso); };
const fileUrl = (u: string) => GET(u.replace(/^\/api\/portal/, '')).then((r) => r.url as string);
const openFile = (u: string) => { const w = window.open('', '_blank'); fileUrl(u).then((x) => { if (w) w.location.href = x; }).catch((e) => { w?.close(); showError(e); }); };

function Linkify({ s }: { s: string }) {
  const leave = async (e: React.MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); const href = e.currentTarget.href; if (await confirmBox(t('You are leaving La Europa portal. Continue?'), { ok: t('Continue') })) window.open(href, '_blank', 'noopener,noreferrer'); };
  return <>{s.split(/(https?:\/\/[^\s<]+)/g).map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" onClick={leave}>{p}</a> : p))}</>;
}
function Thumb({ a }: { a: Any }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { fileUrl(a.url).then(setSrc).catch(() => {}); }, [a.url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <a href="#" onClick={(e) => { e.preventDefault(); if (src) window.open(src, '_blank', 'noopener'); }}>{src ? <img className="thumb" src={src} alt={a.name} loading="lazy" /> : a.name}</a>;
}

// The client's Chat (legacy/public/portal/js/chat.js)
export default function Page() {
  const me = usePMe((s) => s.me);
  const [d, setD] = useState<Any | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Any | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [txt, setTxt] = useState(''), [find, setFind] = useState(''), [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null), ta = useRef<HTMLTextAreaElement>(null), firstLoad = useRef(true);
  useEffect(() => { try { setCtx(JSON.parse(sessionStorage.getItem('lep:ctx') || 'null')); sessionStorage.removeItem('lep:ctx'); } catch { /* storage blocked */ } }, []);
  const load = useCallback(async () => {
    const x = await GET('/chat/messages', { passive: true });
    setD((o: Any | null) => (o && JSON.stringify(o.rows) === JSON.stringify(x.rows) && o.online === x.online ? o : x));
    POST('/chat/read').catch(() => {});
  }, []);
  useEffect(() => { load().catch(showError); const tm = setInterval(() => load().catch(() => {}), 15000); return () => clearInterval(tm); }, [load]);
  useEffect(() => { if (d?.counsellor?.has_photo) GET('/counsellor-photo').then((r) => setPhoto(r.url)).catch(() => {}); }, [d?.counsellor?.has_photo]);
  useEffect(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }, [d, find]);
  const addF = (list: FileList | null) => {
    let next = [...files];
    for (const f of [...(list ?? [])]) { if (f.size > 10 * 1048576) { toast(`${f.name}: ${t('max 10 MB')}`, 'err'); continue; } next.push(f); }
    if (next.length > 5) { next = next.slice(0, 5); toast(t('Maximum 5 attachments'), 'err'); }
    setFiles(next);
  };
  const send = async () => {
    const text = txt.trim();
    if (!text && !files.length) return;
    const fd = new FormData(); fd.append('body', text); if (ctx) { fd.append('context_type', ctx.type); fd.append('context_id', ctx.id); }
    files.forEach((f) => fd.append('files', f));
    setBusy(true);
    try { await SEND('post', '/chat/messages', fd); setTxt(''); setFiles([]); setCtx(null); if (ta.current) ta.current.style.height = ''; await load(); } catch (e) { showError(e); } finally { setBusy(false); }
  };
  const edit = async (m: Any) => { if (await formModal({ title: t('Edit message'), fields: [{ k: 'body', label: t('Message'), type: 'textarea', rows: 4 }], values: { body: m.body || '' }, save: (v) => PATCH('/chat/messages/' + m.id, { body: v.body }) })) load(); };
  const del = async (m: Any) => { if (await confirmBox(t('Delete this message?'), { danger: true, ok: t('Delete'), cancel: t('Cancel') })) { try { await DEL('/chat/messages/' + m.id); load(); } catch (e) { showError(e); } } };
  const ro = !!(me?.preview || me?.read_only);
  const cc = d?.counsellor;
  const nodes: React.ReactNode[] = [];
  if (d) {
    let lastDay = '', newShown = false;
    const f = find.toLowerCase().trim();
    for (const m of d.rows as Any[]) {
      if (f && !String(m.body || '').toLowerCase().includes(f)) continue;
      const dl = dayLabel(m.sent_at); if (dl !== lastDay) { nodes.push(<div key={'d' + m.id} className="sep">{dl}</div>); lastDay = dl; }
      if (!newShown && !m.mine && m.sender_type !== 'system' && !m.read_at && firstLoad.current) { nodes.push(<div key="new" className="newsep">{t('New messages')}</div>); newShown = true; }
      if (m.sender_type === 'system') { nodes.push(<div key={m.id} className="msg sys">{t(m.body || '')}</div>); continue; }
      nodes.push(
        <div key={m.id} className={`msg ${m.mine ? 'me' : ''}`}>
          {!m.mine ? <div className="who">{m.sender_name}{m.sender_role && m.sender_role !== 'Counsellor' ? ` · ${m.sender_role}` : ''}</div> : null}
          {m.context ? <Link className="card-ctx" href={local(m.context.link)}><b>{m.context.title}</b><br /><span className="muted">{m.context.sub || ''}</span></Link> : null}
          {m.deleted ? <i className="muted">{t('message deleted')}</i> : <div className="txt"><Linkify s={m.body || ''} /></div>}
          {m.attachments.map((a: Any) => (/^image\//.test(a.mime) ? <Thumb key={a.id} a={a} /> : <div key={a.id}><a href="#" onClick={(e) => { e.preventDefault(); openFile(a.url); }}>📄 {a.name}</a></div>))}
          <div className="meta">{m.edited ? t('edited') + ' · ' : ''}{fmtTime(m.sent_at)} {m.mine ? <span className={`ticks ${m.read_at ? 'read' : ''}`} title={m.read_at ? t('Read') + ' ' + fmtTime(m.read_at) : m.delivered_at ? t('Delivered') : t('Sent')}>{m.delivered_at || m.read_at ? '✓✓' : '✓'}</span> : null}
            {m.can_edit && !me?.preview ? <> <button className="btn xs ghost" style={{ height: 18, padding: '0 4px' }} onClick={() => edit(m)}>✎</button><button className="btn xs ghost" style={{ height: 18, padding: '0 4px' }} onClick={() => del(m)}>🗑</button></> : null}</div>
        </div>
      );
    }
    firstLoad.current = false;
  }
  return (
    <div className="p-card chat-wrap">
      <div className="chat-hd">{!d ? null : cc ? <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="avatar">{photo ? <img src={photo} alt="" /> : initials(cc.name)}</span><div className="grow"><b>{cc.name}</b><div className="small"><span className={`online ${d.online ? '' : 'off'}`}><i />{d.online ? t('Online') : t('Replies during office hours')}</span></div></div>
      </> : <div className="grow"><b>La Europa Education</b><div className="small muted">{t('A counsellor will reply soon')}</div></div>}</div>
      {d && !d.online ? <div className="p-banner warn" style={{ borderRadius: 0, margin: 0 }}>{t('Our team is offline now. We reply during office hours:')} {d.office_hours_text}. {t('For urgent visa appointment issues, call your counsellor.')}</div> : null}
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}><input className="input" placeholder={t('Search in this conversation')} style={{ height: 32 }} value={find} onChange={(e) => setFind(e.target.value)} /></div>
      <div className="chat-body" ref={body}>{!d ? <div className="empty-p">{t('Loading...')}</div> : nodes.length ? nodes : <div className="empty-p">{t('Say hello to your counsellor!')}</div>}</div>
      {ctx ? <div className="chat-ctx">📎 <span className="grow">{t('About')}: <b>{ctx.label}</b></span><button className="btn xs ghost" onClick={() => setCtx(null)}>✕</button></div> : null}
      <div className="small" style={{ padding: '0 10px' }}>{files.map((f, i) => <span key={i} className="chip off" style={{ margin: '4px 4px 0 0' }}>{f.name} <button onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button></span>)}</div>
      <div className="chat-in">
        <label className="icon-btn" title={t('Attach')}><Icon name="attach" /><input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { addF(e.target.files); e.target.value = ''; }} /></label>
        <label className="icon-btn" title={t('Take photo')}><Icon name="camera" /><input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addF(e.target.files); e.target.value = ''; }} /></label>
        <textarea ref={ta} rows={1} placeholder={t('Type a message')} maxLength={2000} disabled={ro} value={txt}
          onChange={(e) => { setTxt(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 900) { e.preventDefault(); send(); } }} />
        <button className="btn primary" style={{ borderRadius: '50%', width: 42, height: 42, padding: 0 }} disabled={busy || ro} onClick={send} aria-label={t('Send')}><Icon name="send" /></button>
      </div>
    </div>
  );
}
