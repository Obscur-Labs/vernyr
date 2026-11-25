'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GET, POST } from '@/le/api';
import { fmtDT } from '@/le/format';
import { showError } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The client's Notifications (legacy/public/js/pages/tasks.js notificationsPage)
export default function Notifications() {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(async () => { try { setRows((await GET('/notifications?all=1')).rows); } catch (e) { showError(e); } }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="page-head"><h1>Notifications</h1><span className="grow" /><button className="btn" onClick={async () => { await POST('/notifications/read', { all: true }); load(); }}>Mark all as read</button></div>
      <div className="card"><div className="bd flush">
        {!rows ? <div className="empty">Loading...</div> : rows.length ? rows.map((n) => (
          <Link key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} href={String(n.link || '/notifications').replace(/^#/, '')} onClick={() => { POST('/notifications/read', { ids: [n.id] }).catch(() => {}); }}>
            {n.title}<div className="when">{fmtDT(n.created_at)}</div>
          </Link>
        )) : <div className="empty">No notifications (kept for 90 days)</div>}
      </div></div>
    </>
  );
}
