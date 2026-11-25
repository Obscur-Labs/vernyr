'use client';

import { use } from 'react';
import Link from 'next/link';
import { M, useMeta } from '@/le/meta';
import { studentUrl } from '@/lib/config';
import { CataloguePage, PortalAdmin } from '@/le/catalogue';
import { Privacy } from '@/le/privacy';
import { Audit, Masters, Reports, Settings, TemplateEdit, Templates, Users } from '@/le/admin';

const SECTIONS: [string, string][] = [['users', 'Users'], ['masters', 'Masters'], ['catalogue', 'Course catalogue'], ['portal', 'Student portal'], ['privacy', 'Legal & privacy'], ['templates', 'Email templates'], ['settings', 'Settings'], ['audit', 'Audit log']];

// The client's Admin Settings (legacy/public/js/pages/admin.js)
export default function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = use(params);
  const me = useMeta((s) => s.me);
  const [section = 'users', sub] = path;
  if (!me) return <div className="empty">Loading...</div>;
  if (!M.admin() && !(section === 'reports' && me.role === 'manager')) return <div className="card"><div className="bd empty">You do not have access to this record</div></div>;
  const body = section === 'privacy' ? <Privacy sub={sub} portalUrl={studentUrl} /> : section === 'catalogue' ? <CataloguePage /> : section === 'portal' ? <PortalAdmin portalUrl={studentUrl} /> : section === 'masters' ? <Masters sub={sub} /> : section === 'templates' ? (sub ? <TemplateEdit code={sub} /> : <Templates />)
    : section === 'settings' ? <Settings /> : section === 'audit' ? <Audit /> : section === 'reports' ? <Reports /> : <Users />;
  return (
    <>
      <div className="page-head"><h1>{section === 'reports' ? 'Reports' : 'Admin Settings'}</h1></div>
      {section === 'reports' ? null : <div className="tabs" style={{ marginBottom: 14 }}>{SECTIONS.map(([k, l]) => <Link key={k} href={`/admin/${k}`} className={k === section ? 'on' : ''}>{l}</Link>)}</div>}
      {body}
    </>
  );
}
