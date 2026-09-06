'use client';

import { useId } from 'react';

/**
 * The Vernyr mark, same traced geometry as the apps: two round-capped strokes
 * meeting in a v with the dot set off to the upper right. The strokes butt at
 * (.9, 37.5) where the arc bottoms out — their round caps face opposite ways
 * and together form the stroke's circular section, so the seam is invisible
 * and each half carries its own gradient.
 */
const V = {
  left: 'M-42.9 -35.5L-9.6 31.1A11.3 11.3 0 0 0 .9 37.5',
  right: 'M.9 37.5A11.3 11.3 0 0 0 10.8 30.7L27.9 -2.5',
  dot: { cx: 42.4, cy: -37.6, r: 13.6 },
  weight: 26,
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
  const leftId = `vl-${uid}`;
  const rightId = `vr-${uid}`;

  return (
    <svg viewBox={VIEWBOX} role="img" aria-label="Vernyr" className={className} style={style} fill="none">
      <defs>
        <linearGradient id={leftId} gradientUnits="userSpaceOnUse" x1="-42.9" y1="-35.5" x2="-9.6" y2="31.1">
          <stop stopColor={BRAND.violet} />
          <stop offset="1" stopColor={BRAND.indigo} />
        </linearGradient>
        <linearGradient id={rightId} gradientUnits="userSpaceOnUse" x1="10.8" y1="30.7" x2="27.9" y2="-2.5">
          <stop stopColor={BRAND.indigo} />
          <stop offset="1" stopColor={BRAND.blue} />
        </linearGradient>
      </defs>
      <g strokeWidth={V.weight} strokeLinecap="round">
        <path d={V.left} stroke={`url(#${leftId})`} />
        <path d={V.right} stroke={`url(#${rightId})`} />
      </g>
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
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <VernyrMark className="shrink-0" style={{ width: size, height: size }} />
      <Wordmark className="text-ink" />
    </span>
  );
}
