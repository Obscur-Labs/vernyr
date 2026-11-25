import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, Inter, JetBrains_Mono } from 'next/font/google';
import { site } from '@/lib/site';
import { StructuredData } from '@/components/StructuredData';
import './globals.css';

const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-face',
  display: 'swap',
});

const title = 'Vernyr — Study Abroad Consultants for European Universities';
const description =
  'Study abroad with counselling, university selection, applications and visa filing handled end to end. 220 partner universities across 16 countries in Europe.';

export const metadata: Metadata = {
  metadataBase: new URL(`https://${site.domain}`),
  title: { default: title, template: '%s · Vernyr' },
  description,
  applicationName: site.name,
  authors: [{ name: site.name, url: `https://${site.domain}` }],
  creator: site.name,
  publisher: site.name,
  category: 'education',
  keywords: [
    'study abroad consultants',
    'study in Europe',
    'overseas education consultants',
    'student visa assistance',
    'university applications',
    'study abroad India',
    'MS in Europe',
    'MBA abroad',
  ],
  // One page, one canonical. Without this every ?utm_… link is a duplicate.
  alternates: { canonical: '/' },
  openGraph: {
    title,
    description,
    url: `https://${site.domain}`,
    siteName: site.name,
    locale: 'en_IN',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title, description },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [{ url: '/brand/mark.svg', type: 'image/svg+xml' }],
    apple: '/brand/mark.svg',
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: '#f4f5f8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${instrument.variable} ${inter.variable} ${mono.variable}`}>
      <head>
        <StructuredData />
      </head>
      <body>{children}</body>
    </html>
  );
}
