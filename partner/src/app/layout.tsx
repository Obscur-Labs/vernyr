import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'La Europa Partner Portal',
  description: 'University partner portal by La Europa Education',
  robots: { index: false, follow: false },
  icons: { icon: '/brand/vernyr-icon.svg' },
};
export const viewport: Viewport = { themeColor: '#FFFFFF', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
