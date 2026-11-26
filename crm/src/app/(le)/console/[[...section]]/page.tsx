'use client';

import { Suspense, use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { qs } from '@/le/format';
import { Approvals, Assignment, Branches, CatalogueQuality, Ctx, Duplicates, Home, LinkCard, Loading, Roles, Staff, Transfer, Universities, canFor, type Any, type Q } from '@/le/console';
import { Announcements, Channels, Checklists, Company, ConsoleAudit, ConsoleReports, ConsoleSettings, ConsoleTemplates, EmailLog, Fees, Health, Reconciliation, Storage } from '@/le/console2';

type Can = (m: string, a?: string) => boolean;
const MENU: [string, [string, string, (c: Can, me: Any) => boolean][]][] = [
  ['Home', [['home', 'Admin home', (c, me) => me.super_admin || c('reports')]]],
  ['People', [['roles', 'Roles and role builder', (c) => c('roles')], ['staff', 'Staff users', (c) => c('users')], ['branches', 'Branches and teams', (c) => c('users')], ['assignment', 'Assignment rules', (c) => c('assignment')],
    ['transfer', 'Bulk transfer', (c) => c('assignment', 'edit')], ['duplicates', 'Duplicates and merge', (c) => c('duplicates')]]],
  ['Partners', [['universities', 'Universities', (c) => c('universities')]]],
  ['Courses', [['catalogue', 'Course catalogue', (c) => c('catalogue')], ['approvals', 'Approvals centre', () => true]]],
  ['Money', [['reconciliation', 'Reconciliation', (c) => c('reconciliation')], ['fees', 'Service fees and payments', (c) => c('fees')]]],
  ['Communication', [['templates', 'Email templates', (c) => c('templates')], ['email-log', 'Email log and delivery', (c) => c('templates')], ['channels', 'SMS and WhatsApp', (c) => c('channels')], ['announcements', 'Announcements', (c) => c('announcements')]]],
  ['Documents and data', [['checklists', 'Checklist templates', (c) => c('checklists')], ['storage', 'Storage', (c) => c('checklists')], ['masters', 'Masters', (c) => c('checklists')]]],
  ['Insights', [['reports', 'Reports', (c) => c('reports') || c('reconciliation')], ['audit', 'Audit log', (c) => c('audit')]]],
  ['Privacy and security', [['privacy', 'Privacy centre', (c) => c('privacy')], ['health', 'Backups and system health', (c) => c('security') || c('settings')]]],
  ['Settings', [['settings', 'System settings', (c) => c('settings')], ['company', 'Company profile', (c) => c('company')]]],
];
const SECTIONS: Record<string, () => React.ReactNode> = {
  home: () => <Home />, roles: () => <Roles />, staff: () => <Staff />, branches: () => <Branches />, assignment: () => <Assignment />, transfer: () => <Transfer />, duplicates: () => <Duplicates />,
  universities: () => <Universities />, catalogue: () => <CatalogueQuality />, approvals: () => <Approvals />, reconciliation: () => <Reconciliation />, fees: () => <Fees />,
  templates: () => <ConsoleTemplates />, 'email-log': () => <EmailLog />, channels: () => <Channels />, announcements: () => <Announcements />, checklists: () => <Checklists />, storage: () => <Storage />,
  masters: () => <LinkCard title="Masters" text="Countries, intakes, stages, document types, lead sources and other masters. Values are never hard-deleted." href="/admin/masters" />,
  reports: () => <ConsoleReports />, audit: () => <ConsoleAudit />,
  privacy: () => <LinkCard title="Privacy centre" text="Deletion and data export requests, consent register, breach register and legal texts (versions)." href="/admin/privacy" />,
  health: () => <Health />, settings: () => <ConsoleSettings />, company: () => <Company />,
};

// The client's Admin console (legacy/public/js/pages/console.js, console2.js)
function Console({ section: want }: { section: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const q: Q = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const [me, setMe] = useState<Any | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { GET('/console/me').then(setMe).catch(setErr); }, []);
  const can = useMemo(() => canFor(me), [me]);
  const go = useMemo(() => (section: string, query: Q = {}) => router.push(`/console/${section}${qs(query)}`), [router]);
  if (!me) return <Loading err={err} />;
  const items = MENU.map(([g, list]) => [g, list.filter((x) => x[2](can, me))] as const).filter(([, l]) => l.length);
  const section = items.some(([, l]) => l.some((x) => x[0] === want)) ? want : items[0]?.[1][0]?.[0] || 'home';
  return (
    <Ctx.Provider value={{ me, can, q, go }}>
      <div className="page-head"><h1>Admin console</h1><span className="grow" />{me.super_admin ? <span className="badge purple">Super Admin</span> : null}</div>
      <div className="console">
        <nav className="cmenu">{items.map(([g, l]) => <div key={g}><div className="cg">{g}</div>{l.map(([k, label]) => <Link key={k} href={`/console/${k}`} className={k === section ? 'on' : ''}>{label}</Link>)}</div>)}</nav>
        <div className="cbody" key={section}>{(SECTIONS[section] ?? SECTIONS.home)()}</div>
      </div>
    </Ctx.Provider>
  );
}
export default function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = use(params);
  return <Suspense><Console section={section[0] || 'home'} /></Suspense>;
}
