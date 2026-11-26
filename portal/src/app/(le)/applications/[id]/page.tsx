'use client';

import { use } from 'react';
import { ApplicationDetail } from '@/le/apps';

// The client's application detail (legacy/public/portal/js/apps.js detail)
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <ApplicationDetail id={use(params).id} />; }
