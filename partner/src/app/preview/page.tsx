'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { POST } from '@/le/api';
import { signIn } from '@/le/u';
import { AuthShell, Notice, msg } from '@/le/auth';

/** La Europa "View as university": the one-time token from the CRM becomes a 2-hour read-only session. */
function Preview() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) { setError('This preview link has expired.'); return; }
    POST('/auth/preview', { token }).then((r) => { signIn(r.token); router.replace('/dashboard'); }).catch((e) => setError(msg(e)));
  }, [token, router]);
  return <AuthShell><h2>View as university</h2><Notice error={error} />{error ? null : <div className="empty">Opening...</div>}</AuthShell>;
}
export default function Page() { return <Suspense><Preview /></Suspense>; }
