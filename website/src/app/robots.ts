import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      // The apps behind the subdomains are private; keep crawlers off them
      // even if a link leaks. Their own hosts serve their own robots.txt.
      { userAgent: '*', disallow: ['/api/'] },
    ],
    sitemap: `https://${site.domain}/sitemap.xml`,
    host: `https://${site.domain}`,
  };
}
