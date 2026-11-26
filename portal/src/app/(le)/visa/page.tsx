'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GET } from '@/le/api';

// The client has no Visa page: old links open the application that has the visa (legacy/public/portal/js/apps.js visa)
export default function Page() {
  const router = useRouter();
  useEffect(() => { GET('/visa').then((d) => d.cases?.find((x: { application_id?: string }) => x.application_id)).catch(() => null).then((v) => router.replace(v ? `/applications/${v.application_id}` : '/applications')); }, [router]);
  return <div className="empty-p">Loading...</div>;
}
