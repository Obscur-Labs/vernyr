'use client';

import { use } from 'react';
import { CourseDetail } from '@/le/courses';

// The client's course detail (legacy/public/portal/js/courses.js detail)
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <CourseDetail id={use(params).id} />; }
