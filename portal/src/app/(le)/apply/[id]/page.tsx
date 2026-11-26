'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { Apply } from '@/le/courses';

// The client's Apply Now (legacy/public/portal/js/courses.js apply)
function Inner({ id }: { id: string }) { return <Apply courseId={id} src={useSearchParams().get('src') ?? undefined} />; }
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense><Inner id={id} /></Suspense>; }
