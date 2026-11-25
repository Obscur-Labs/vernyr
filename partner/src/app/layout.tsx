import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vernyr Partner',
  description: 'University partner portal by La Europa',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
