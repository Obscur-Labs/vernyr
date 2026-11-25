'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GET, POST } from './api';
import { ago } from './format';
import { Icon } from './Icon';

/** The client's top-bar search and notification bell (legacy/public/js/main.js). */

/* eslint-disable @typescript-eslint/no-explicit-any */
const local = (h?: string | null) => String(h || '/notifications').replace(/^#/, '');

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [d, setD] = useState<any>(null);
  const [idx, setIdx] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const run = (v: string) => {
    clearTimeout(timer.current);
    if (v.trim().length < 3) { setD(null); return; }
    timer.current = setTimeout(async () => { try { setD(await GET('/search?q=' + encodeURIComponent(v.trim()))); setIdx(-1); } catch { setD(null); } }, 250);
  };
  const items: [string, React.ReactNode, string][] = d ? [
    ...d.students.map((s: any) => [`/students/${s.id}`, <><b>{s.name}</b> <span className="muted small">{s.code} · {s.phone || ''} · {s.stage}</span></>, 'Students']),
    ...d.leads.map((l: any) => [`/leads/${l.id}`, <><b>{l.name}</b> <span className="muted small">{l.code} · {l.phone || ''} · {l.status}</span></>, 'Leads']),
    ...d.applications.map((a: any) => [`/students/${a.student_id}/applications`, <><b>{a.code}</b> <span className="muted small">{a.student} · {a.university} · {a.stage}</span></>, 'Applications']),
  ] : [];
  const close = () => { setD(null); setQ(''); };
  const go = (href: string) => { router.push(href); close(); };
  return (
    <div className="gsearch">
      <Icon name="search" />
      <input type="search" placeholder="Search name, phone, email, passport, ID..." autoComplete="off" value={q}
        onChange={(e) => { setQ(e.target.value); run(e.target.value); }} onFocus={() => run(q)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setIdx((i) => Math.min(items.length - 1, i + 1)); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
          else if (e.key === 'Enter') { go(idx >= 0 && items[idx] ? items[idx][0] : '/search?q=' + encodeURIComponent(q.trim())); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') setD(null);
        }} />
      {d ? (
        <div className="results">
          {items.map(([href, html, grp], i) => (
            <span key={href + i}>
              {i === 0 || items[i - 1][2] !== grp ? <h4>{grp}</h4> : null}
              <Link href={href} className={i === idx ? 'on' : ''} onClick={close}>{html}</Link>
            </span>
          ))}
          {items.length ? <Link href={`/search?q=${encodeURIComponent(q)}`} className="small" style={{ borderTop: '1px solid var(--line)' }} onClick={close}>See all results for &quot;{q}&quot;</Link> : <div className="empty">No matches</div>}
        </div>
      ) : null}
    </div>
  );
}

export function Bell() {
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const poll = async () => { try { const d = await GET('/notifications'); setUnread(d.unread); return d; } catch { return null; } };
  useEffect(() => { poll(); const t = setInterval(poll, 60_000); return () => clearInterval(t); }, []);
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true); setRows(null);
    const d = await poll();
    setRows(d?.rows ?? []);
  };
  return (
    <div className="usermenu" onMouseLeave={() => setOpen(false)}>
      <button className="icon-btn" aria-label="Notifications" onClick={toggle}><Icon name="bell" />{unread ? <span className="badge-count">{unread > 99 ? '99+' : unread}</span> : null}</button>
      {open ? (
        <div className="notif-panel">
          <div className="nh"><b className="grow">Notifications</b>
            <button className="btn xs" onClick={async () => { await POST('/notifications/read', { all: true }); poll(); setOpen(false); }}>Mark all read</button>
            <Link className="btn xs" href="/notifications" onClick={() => setOpen(false)}>View all</Link></div>
          <div className="list">{!rows ? <div className="empty">Loading...</div> : rows.length ? rows.map((n) => (
            <Link key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} href={local(n.link)} onClick={() => { POST('/notifications/read', { ids: [n.id] }).then(poll).catch(() => {}); setOpen(false); }}>
              {n.title}<div className="when">{ago(n.created_at)}</div>
            </Link>
          )) : <div className="empty">No notifications</div>}</div>
        </div>
      ) : null}
    </div>
  );
}
