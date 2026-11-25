'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (!token) router.replace('/login');
  }, [router]);

  return <AppShell>{children}</AppShell>;
}
