import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/** The auth screens borrow the marketing site's editorial type. */
const instrument = Instrument_Serif({
  variable: '--font-instrument',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});
const monoFace = JetBrains_Mono({
  variable: '--font-mono-face',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { InstallPrompt } from '@/components/InstallPrompt';

export const metadata: Metadata = {
  title: 'Vernyr — My Journey',
  description: 'Track your study abroad journey from inquiry to departure.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Vernyr' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Matches --color-surface in each theme, so the browser chrome blends into
  // the page instead of framing it in a bright band.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfe' },
    { media: '(prefers-color-scheme: dark)', color: '#191d25' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrument.variable} ${monoFace.variable} h-full`}
    >
      <body suppressHydrationWarning className="h-full antialiased bg-base text-t1">
        <ThemeProvider>
          <ToastProvider>
            {children}
            <InstallPrompt appName="Vernyr" />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
