'use client';

import { useId } from 'react';

/**
 * A compact, hand-drawn V: one continuous weighted stroke gives the mark a
 * calm editorial silhouette, while the offset teal dot adds the signature
 * point of energy used throughout the site palette.
 */
const V = {
  path: 'M-43 -35L-10.5 29.8A12 12 0 0 0 0 36.2A12 12 0 0 0 10.5 29.8L28 -4',
  dot: { cx: 42.5, cy: -37, r: 13.5 },
  weight: 25,
};

const VIEWBOX = '-56 -51.5 112 102';

const BRAND = {
  violet: '#8759F6',
  indigo: '#3853DE',
  blue: '#3A80F5',
  teal: '#40D0BE',
};

export function VernyrMark({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const uid = useId();
  const gradientId = `vm-${uid}`;

  return (
    <svg viewBox={VIEWBOX} role="img" aria-label="Vernyr" className={className} style={style} fill="none">
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="-43" y1="-35" x2="28" y2="-4">
          <stop stopColor={BRAND.violet} />
          <stop offset="0.52" stopColor={BRAND.indigo} />
          <stop offset="1" stopColor={BRAND.blue} />
        </linearGradient>
      </defs>
      <path d={V.path} stroke={`url(#${gradientId})`} strokeWidth={V.weight} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={V.dot.cx} cy={V.dot.cy} r={V.dot.r} fill={BRAND.teal} />
    </svg>
  );
}

/**
 * The wordmark artwork is an alpha mask, not a picture — white RGB with the
 * letterforms in the alpha channel. Painting it with `mask-image` over
 * `currentColor` lets it take the surrounding text colour, and sizing in `em`
 * means the font size sets its height the way it would set type.
 */
const WORDMARK_ASPECT = 827 / 230;

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Vernyr"
      className={className}
      style={{
        display: 'inline-block',
        height: '1em',
        width: `${WORDMARK_ASPECT}em`,
        backgroundColor: 'currentColor',
        maskImage: 'url(/brand/wordmark.png)',
        WebkitMaskImage: 'url(/brand/wordmark.png)',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}

/** Mark and wordmark locked to one baseline. */
export function Logo({ className = '', size = 22 }: { className?: string; size?: number }) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className}`}
      aria-label="Vernyr"
      role="img"
    >
      <VernyrMark className="shrink-0" style={{ width: size, height: size }} />
      <span
        aria-hidden="true"
        className="font-display text-[1.22em] leading-none tracking-[-0.045em] text-ink"
      >
        Vernyr
      </span>
    </span>
  );
}
