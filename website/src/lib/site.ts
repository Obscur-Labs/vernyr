/**
 * Every outward link the site makes, in one place. The apps live on their own
 * subdomains; the legal documents live in Drive until they have real pages.
 */
export const site = {
  name: 'Vernyr',
  domain: 'vernyr.com',
  tagline: 'Study abroad, handled end to end.',

  /** The two products this page sends people into. */
  portalUrl: 'https://portal.vernyr.com',
  crmUrl: 'https://crm.vernyr.com',

  email: 'hello@vernyr.com',
  phone: '+91 00000 00000',
  address: 'Surat, Gujarat, India',

  /** Paste the Drive share links here. */
  termsUrl: 'https://drive.google.com/',
  privacyUrl: 'https://drive.google.com/',

  /** What the catalogue actually holds, so the numbers on the page are true. */
  stats: {
    universities: 220,
    countries: 16,
    courses: 1914,
  },
} as const;

export const nav = [
  { label: 'About', href: '#about' },
  { label: 'Services', href: '#services' },
  { label: 'Partners', href: '#partners' },
  { label: 'Students', href: '#voices' },
  { label: 'Contact', href: '#contact' },
];
