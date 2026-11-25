import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vernyr',
    short_name: 'Vernyr',
    description: 'Track your study abroad journey',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f5f9',
    theme_color: '#fbfcfe',
    categories: ['education'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
