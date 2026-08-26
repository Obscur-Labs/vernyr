import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/context/ToastContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { InstallPrompt } from '@/components/InstallPrompt';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Vernyr',
  description: 'Study abroad operations for counsellors and students',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Vernyr' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#080d1b' },
    { media: '(prefers-color-scheme: light)', color: '#f0f2ff' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} h-full`}>
      <body suppressHydrationWarning className="h-full bg-base text-t1 antialiased">
        <ThemeProvider>
          <ToastProvider>
            {children}
            <InstallPrompt appName="Vernyr Admin" />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
