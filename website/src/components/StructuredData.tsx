import { site } from '@/lib/site';

const origin = `https://${site.domain}`;

/**
 * JSON-LD for the one page. Two graphs Google actually uses for a site like
 * this: the organisation behind it, and the site itself.
 *
 * Deliberately absent: Review and AggregateRating. Marking up testimonials
 * that are not verifiable, first-party reviews is a policy violation and earns
 * a manual action rather than stars. Add them only once the quotes are real
 * and attributable.
 */
const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': ['EducationalOrganization', 'Organization'],
      '@id': `${origin}/#organization`,
      name: site.name,
      url: origin,
      description:
        'Study-abroad consultancy handling counselling, university selection, applications, visa filing and departure for students applying to European universities.',
      email: site.email,
      telephone: site.phone,
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Surat',
        addressRegion: 'Gujarat',
        addressCountry: 'IN',
      },
      areaServed: { '@type': 'Country', name: 'India' },
      knowsAbout: [
        'Study abroad consulting',
        'University admissions',
        'Student visa applications',
        'Higher education in Europe',
      ],
      logo: { '@type': 'ImageObject', url: `${origin}/brand/mark.svg` },
    },
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      url: origin,
      name: site.name,
      publisher: { '@id': `${origin}/#organization` },
      inLanguage: 'en-IN',
    },
    {
      '@type': 'Service',
      '@id': `${origin}/#service`,
      serviceType: 'Study abroad consultancy',
      provider: { '@id': `${origin}/#organization` },
      areaServed: { '@type': 'Country', name: 'India' },
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Study abroad services',
        itemListElement: [
          'Counselling',
          'University selection',
          'Applications',
          'Offers and fees',
          'Visa filing',
          'Departure support',
        ].map((name) => ({
          '@type': 'Offer',
          itemOffered: { '@type': 'Service', name },
        })),
      },
    },
  ],
};

export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // The payload is a literal in this file, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
