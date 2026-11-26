'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DocumentsPage } from '@/le/docs';

// The client's Documents (legacy/public/portal/js/docs.js page)
function Docs() { return <DocumentsPage initialTab={useSearchParams().get('tab') ?? undefined} />; }
export default function Page() { return <Suspense><Docs /></Suspense>; }
