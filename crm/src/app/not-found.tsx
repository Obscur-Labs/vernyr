'use client';

import { useRouter } from 'next/navigation';
import { VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { Button, ButtonLink } from '@/components/ui';

/**
 * Rendered for any unmatched route, and for `/dev` in a production build where
 * the layout calls `notFound()` — so it must stand on its own without the CRM
 * shell, auth state, or a backend.
 */
export default function NotFound() {
  const router = useRouter();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-base px-6 py-16 text-center">
      <div className="flex items-center gap-2.5 text-t1">
        <VernyrMark className="h-9 w-9" />
        <Wordmark className="text-[19px]" />
      </div>

      <p className="mt-12 font-mono text-sm tracking-[0.2em] text-accent">404</p>

      <h1 className="mt-3 max-w-lg text-balance text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-t1">
        This page isn&rsquo;t here.
      </h1>

      <p className="mt-4 max-w-md text-pretty text-[15px] leading-relaxed text-t2">
        The link may be out of date, or the record it pointed to has been removed.
        Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> anywhere in the app to jump to a page.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" onClick={() => router.back()}>Go back</Button>
        <ButtonLink href="/dashboard">Back to dashboard</ButtonLink>
      </div>
    </main>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-line bg-card px-1.5 py-0.5 font-sans text-[11px] font-medium text-t2">
      {children}
    </kbd>
  );
}
