'use client';

import { use } from 'react';
import { Detail } from '@/le/apps';

export default function Page({ params }: { params: Promise<{ id: string }> }) { return <Detail id={use(params).id} />; }
