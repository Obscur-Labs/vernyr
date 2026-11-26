'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CourseSearch } from '@/le/courses';

// The client's Course Search (legacy/public/portal/js/courses.js search)
function Search() { return <CourseSearch q={Object.fromEntries(useSearchParams().entries())} />; }
export default function Page() { return <Suspense><Search /></Suspense>; }
