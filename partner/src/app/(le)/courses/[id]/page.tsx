'use client';

import { use } from 'react';
import { CourseForm } from '@/le/catalog';

export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <CourseForm id={id === 'new' ? null : id} />; }
