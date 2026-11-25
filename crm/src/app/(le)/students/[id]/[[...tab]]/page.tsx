'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { GET, PUT } from '@/le/api';
import { StudentFrame, normTab } from '@/le/student/Frame';
import { EmailsTab, NotesTab, TasksTab, TimelineTab, type Ctx } from '@/le/student/tabs';
import { ChangeRequests, ChatPanel, StudentRequests } from '@/le/portalcrm';
import { InfoForm } from '@/le/InfoForm';
import { ShortlistTab } from '@/le/work/shortlist';
import { ApplicationsTab } from '@/le/work/applications';
import { DocumentsTab } from '@/le/work/documents';
import { FeesTab } from '@/le/work/fees';

function Tab({ tab, ctx }: { tab: string; ctx: Ctx }) {
  const q = useSearchParams();
  const id = ctx.s.id;
  switch (tab) {
    case 'shortlist': return <ShortlistTab {...ctx} />;
    case 'applications': return <ApplicationsTab {...ctx} openNew={q.get('new') === '1'} />;
    case 'documents': return <DocumentsTab {...ctx} openUpload={q.get('upload') === '1'} />;
    case 'fees': return <FeesTab {...ctx} />;
    case 'tasks': return <TasksTab {...ctx} />;
    case 'chat': return <ChatPanel base={`/students/${id}/chat`} />;
    case 'requests': return <><StudentRequests s={ctx.s} /><div style={{ marginTop: 16 }}><ChangeRequests s={ctx.s} reload={ctx.reload} /></div></>;
    case 'notes': return <NotesTab {...ctx} />;
    case 'emails': return <EmailsTab {...ctx} />;
    case 'timeline': return <TimelineTab {...ctx} type={q.get('type') ?? ''} />;
    default: return <InfoForm mode="staff" intro="The same form the student fills in the student portal: one set of information." load={() => GET(`/students/${id}/info-form`)} save={(k, b) => PUT(`/students/${id}/info-form/${k}`, b)} />;
  }
}

// The client's student profile (legacy/public/js/pages/students.js profile)
export default function StudentPage({ params }: { params: Promise<{ id: string; tab?: string[] }> }) {
  const { id, tab } = use(params);
  const t = normTab(tab?.[0]);
  return <Suspense><StudentFrame id={id} tab={t}>{(ctx) => <Tab key={t} tab={t} ctx={ctx} />}</StudentFrame></Suspense>;
}
