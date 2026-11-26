'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { M, useMeta } from '@/le/meta';
import { studentUrl } from '@/lib/config';
import { CataloguePage, PortalAdmin } from '@/le/catalogue';
import { Privacy } from '@/le/privacy';
import { UniAdmin } from '@/le/university';
import { Audit, Masters, Reports, Settings, TemplateEdit, Templates, Users } from '@/le/admin';

const SECTIONS: [string, string][] = [['users', 'Users'], ['masters', 'Masters'], ['catalogue', 'Course catalogue'], ['portal', 'Student portal'], ['privacy', 'Legal & privacy'], ['university', 'University portal'], ['templates', 'Email templates'], ['settings', 'Settings'], ['audit', 'Audit log']];

// short links used in notifications: /admin/uni-approvals, /admin/uni-announcements, /admin/commission, /admin/agreements
const ALIAS: Record<string, string> = { 'uni-approvals': 'approvals', 'uni-announcements': 'announcements', commission: 'commission', agreements: 'agreements' };

// The client's Admin Settings (legacy/public/js/pages/admin.js)
function AdminPage({ path }: { path: string[] }) {
  const q = Object.fromEntries(useSearchParams().entries());
  const me = useMeta((s) => s.me);
  const [s0 = 'users', s1] = path;
  const section = ALIAS[s0] ? 'university' : s0;
  const sub = ALIAS[s0] ?? s1;
  if (!me) return <div className="empty">Loading...</div>;
  if (!M.admin() && !(section === 'reports' && me.role === 'manager')) return <div className="card"><div className="bd empty">You do not have access to this record</div></div>;
  const body = section === 'university' ? <UniAdmin sub={sub} q={q} /> : section === 'privacy' ? <Privacy sub={sub} portalUrl={studentUrl} /> : section === 'catalogue' ? <CataloguePage /> : section === 'portal' ? <PortalAdmin portalUrl={studentUrl} /> : section === 'masters' ? <Masters sub={sub} /> : section === 'templates' ? (sub ? <TemplateEdit code={sub} /> : <Templates />)
    : section === 'settings' ? <Settings /> : section === 'audit' ? <Audit /> : section === 'reports' ? <Reports /> : <Users />;
  return (
    <>
      <div className="page-head"><h1>{section === 'reports' ? 'Reports' : 'Admin Settings'}</h1></div>
      {section === 'reports' ? null : <div className="tabs" style={{ marginBottom: 14 }}>{SECTIONS.map(([k, l]) => <Link key={k} href={`/admin/${k}`} className={k === section ? 'on' : ''}>{l}</Link>)}</div>}
      {body}
    </>
  );
}
export default function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = use(params);
  return <Suspense fallback={<div className="empty">Loading...</div>}><AdminPage path={path} /></Suspense>;
}
