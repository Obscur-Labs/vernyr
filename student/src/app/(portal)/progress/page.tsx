'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Progress moved under Profile; old links and notifications still land there. */
export default function ProgressRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/profile?tab=progress'); }, [router]);
  return null;
}
