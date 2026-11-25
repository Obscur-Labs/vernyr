import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

export const alt = 'Vernyr — study abroad, handled end to end';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The share card, drawn at build time. Same paper ground and cool/warm split
 * as the page, so a link preview looks like the site it opens.
 * System fonts only — fetching a webfont here would make the build depend on
 * a network call for an image that never changes.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 76,
          backgroundColor: '#f4f5f8',
          backgroundImage: [
            'radial-gradient(ellipse 34% 75% at 52% 30%, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 72%)',
            'radial-gradient(ellipse 40% 56% at 3% 8%, rgba(194,202,245,.95) 0%, rgba(194,202,245,0) 68%)',
            'radial-gradient(ellipse 50% 50% at 12% 63%, rgba(207,242,225,.85) 0%, rgba(207,242,225,0) 68%)',
            'radial-gradient(ellipse 44% 63% at 95% 10%, rgba(242,223,166,.9) 0%, rgba(242,223,166,0) 68%)',
            'radial-gradient(ellipse 44% 60% at 94% 55%, rgba(241,245,199,.85) 0%, rgba(241,245,199,0) 68%)',
          ].join(','),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="52" height="52" viewBox="-56 -51.5 112 102" fill="none">
            <defs>
              <linearGradient id="l" gradientUnits="userSpaceOnUse" x1="-42.9" y1="-35.5" x2="-9.6" y2="31.1">
                <stop stopColor="#8759F6" />
                <stop offset="1" stopColor="#3853DE" />
              </linearGradient>
              <linearGradient id="r" gradientUnits="userSpaceOnUse" x1="10.8" y1="30.7" x2="27.9" y2="-2.5">
                <stop stopColor="#3853DE" />
                <stop offset="1" stopColor="#3A80F5" />
              </linearGradient>
            </defs>
            <g strokeWidth="26" strokeLinecap="round">
              <path d="M-42.9 -35.5L-9.6 31.1A11.3 11.3 0 0 0 .9 37.5" stroke="url(#l)" />
              <path d="M.9 37.5A11.3 11.3 0 0 0 10.8 30.7L27.9 -2.5" stroke="url(#r)" />
            </g>
            <circle cx="42.4" cy="-37.6" r="13.6" fill="#40D0BE" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', color: '#0e0f15' }}>
            Vernyr
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 82,
              lineHeight: 1.02,
              letterSpacing: '-0.035em',
              color: '#0e0f15',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Your degree abroad,</span>
            <span style={{ fontStyle: 'italic' }}>start to finish.</span>
          </div>
          <div style={{ marginTop: 26, fontSize: 27, color: '#454956', maxWidth: 820 }}>
            Counselling, applications, visas and everything between.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 44, fontSize: 21, color: '#454956' }}>
          <span>{site.stats.universities} partner universities</span>
          <span>{site.stats.countries} countries</span>
          <span>{site.stats.courses.toLocaleString('en-IN')} courses</span>
        </div>
      </div>
    ),
    size,
  );
}
