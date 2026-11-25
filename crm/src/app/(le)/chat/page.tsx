'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GET } from '@/le/api';
import { M, useMeta } from '@/le/meta';
import { ago } from '@/le/format';
import { showError } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The client's Chat inbox (legacy/public/js/pages/portalcrm.js chatInbox)
export default function ChatInbox() {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const hours = useMeta((s) => (s.meta?.settings as any)?.first_response_hours);
  useEffect(() => { GET('/chat/inbox').then((d) => setRows(d.rows)).catch(showError); }, []);
  return (
    <>
      <div className="page-head"><div><h1>Chat inbox</h1><div className="sub">Conversations with {M.admin() ? 'all' : 'your'} students on the portal{hours ? ` · first response target ${hours}` : ''}</div></div></div>
      <div className="card"><div className="bd flush">{!rows ? <div className="empty">Loading...</div> : rows.length ? (
        <table className="t cards"><thead><tr><th>Student</th><th>Last message</th><th>When</th><th>Waiting</th><th>Unread</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="click" onClick={() => router.push(String(r.href).replace(/^#/, ''))}>
              <td data-label="Student"><b>{r.name}</b><div className="small mono muted">{r.code}</div></td>
              <td data-label="Last">{r.last_from === 'student' ? null : <span className="muted">You: </span>}{r.last}</td>
              <td data-label="When">{r.last_at ? ago(r.last_at) : ''}</td>
              <td data-label="Waiting">{r.waiting_hours !== null && r.waiting_hours !== undefined ? <span className={r.overdue ? 'days-red' : 'days-orange'}>Waiting {r.waiting_hours} h</span> : null}</td>
              <td data-label="Unread">{r.unread ? <span className="badge red">{r.unread}</span> : null}</td>
            </tr>
          ))}</tbody></table>
      ) : <div className="empty">No conversations yet</div>}</div></div>
    </>
  );
}
