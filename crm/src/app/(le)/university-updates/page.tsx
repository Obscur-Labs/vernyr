'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { UpdatesPage } from '@/le/university';

function Inner() { return <UpdatesPage q={Object.fromEntries(useSearchParams().entries())} />; }
export default function Page() { return <Suspense fallback={<div className="empty">Loading...</div>}><Inner /></Suspense>; }
