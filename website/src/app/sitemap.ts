import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

/**
 * One page, so one entry. The in-page anchors are not separate URLs and must
 * not be listed — a sitemap full of `#about` fragments is a quality signal
 * against you, not for you.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `https://${site.domain}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
