import { notFound } from 'next/navigation';

/**
 * The dev console is an unauthenticated tool. `NODE_ENV` is inlined at build
 * time, so a production build of the CRM serves a 404 here and the console is
 * unreachable regardless of what the backend is doing.
 *
 * The route is also dark-only — ThemeContext pins the theme for any path under
 * /dev, so the CRM's light mode never reaches it.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <>{children}</>;
}
