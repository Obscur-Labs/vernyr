'use client';

import { useId } from 'react';

/**
 * The Vernyr mark: two round-capped strokes meeting in a v, with the dot set
 * off to the upper right. Traced from the brand artwork onto a centred grid so
 * the same geometry can be drawn in full colour or as a monochrome silhouette.
 */
const V = {
  /** Down-stroke: straight, then rolling into the rounded bottom of the v. */
  left: 'M-42.9 -35.5L-9.6 31.1A11.3 11.3 0 0 0 .9 37.5',
  /** Up-stroke: out of the same bottom arc, then straight. */
  right: 'M.9 37.5A11.3 11.3 0 0 0 10.8 30.7L27.9 -2.5',
  dot: { cx: 42.4, cy: -37.6, r: 13.6 },
  weight: 26,
};

/**
 * The two strokes butt at (.9, 37.5) where the arc bottoms out. Their round
 * caps face opposite ways there and together form the stroke's own circular
 * section, so the seam is invisible and each half can carry its own gradient.
 */
const VIEWBOX = '-56 -51.5 112 102';

const BRAND = {
  violet: '#8759F6',
  indigo: '#3853DE',
  blue: '#3A80F5',
  teal: '#40D0BE',
};

/** Wordmark artwork is an alpha mask, so it takes the surrounding text colour. */
const WORDMARK_SRC = '/brand/wordmark.png';
const WORDMARK_ASPECT = 827 / 230;

/** Full-colour mark — headers, sign-in, anywhere the brand should be itself. */
export function VernyrMark({ className = '' }: { className?: string }) {
  const uid = useId();
  const leftId = `vl-${uid}`;
  const rightId = `vr-${uid}`;

  return (
    <svg viewBox={VIEWBOX} role="img" aria-label="Vernyr" className={className} fill="none">
      <defs>
        <linearGradient
          id={leftId}
          gradientUnits="userSpaceOnUse"
          x1="-42.9"
          y1="-35.5"
          x2="-9.6"
          y2="31.1"
        >
          <stop stopColor={BRAND.violet} />
          <stop offset="1" stopColor={BRAND.indigo} />
        </linearGradient>
        <linearGradient
          id={rightId}
          gradientUnits="userSpaceOnUse"
          x1="10.8"
          y1="30.7"
          x2="27.9"
          y2="-2.5"
        >
          <stop stopColor={BRAND.indigo} />
          <stop offset="1" stopColor={BRAND.blue} />
        </linearGradient>
      </defs>

      <g strokeWidth={V.weight} strokeLinecap="round">
        <path d={V.left} stroke={`url(#${leftId})`} />
        <path d={V.right} stroke={`url(#${rightId})`} />
      </g>
      <circle {...V.dot} fill={BRAND.teal} />
    </svg>
  );
}

/** The same mark in one flat colour — for watermarks, favicons and print. */
export function VernyrGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox={VIEWBOX} aria-hidden className={className} fill="none">
      <g stroke="currentColor" strokeWidth={V.weight} strokeLinecap="round">
        <path d={V.left} />
        <path d={V.right} />
      </g>
      <circle {...V.dot} fill="currentColor" />
    </svg>
  );
}

/**
 * Guilloché — the interlocking rosette curves engraved on passports, visas and
 * banknotes. Generated from hypotrochoids at module load, so server and client
 * emit identical path data.
 *
 * Petal count is R/gcd(R,r) and the curve closes after r/gcd(R,r) turns, so the
 * pairs below are chosen for high petal counts: that density is what reads as
 * security printing rather than a wireframe flower.
 */
type Ring = { R: number; r: number; d: number; phase?: number };

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function rosette({ R, r, d, phase = 0 }: Ring, perTurn = 40): string {
  const turns = r / gcd(R, r);
  const k = (R - r) / r;
  const steps = Math.round(turns * perTurn);
  const pts: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = phase + (i / steps) * turns * Math.PI * 2;
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * A rosette spans an annulus from |(R-r) - d| to (R-r) + d. Keeping the inner
 * radius well clear of the origin is what makes real guilloché read as a ring
 * of engraving around an open medallion, rather than a knot at the centre.
 */
const RINGS = [
  { d: rosette({ R: 120, r: 28, d: 38 }), w: 0.45, o: 0.85 }, // 30 petals · 54–130
  { d: rosette({ R: 118, r: 26, d: 32, phase: 0.3 }), w: 0.35, o: 0.55 }, // 59 petals · 60–124
  { d: rosette({ R: 100, r: 24, d: 30 }), w: 0.4, o: 0.7 }, // 25 petals · 46–106
  { d: rosette({ R: 92, r: 22, d: 26, phase: 0.6 }), w: 0.35, o: 0.5 }, // 46 petals · 44–96
];

/** 36 ticks on the bezel, longer every ninth — the rim of a struck seal. */
const TICKS = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * Math.PI * 2;
  const long = i % 9 === 0;
  const inner = long ? 128 : 133;
  return {
    x1: +(Math.cos(a) * inner).toFixed(1),
    y1: +(Math.sin(a) * inner).toFixed(1),
    x2: +(Math.cos(a) * 138).toFixed(1),
    y2: +(Math.sin(a) * 138).toFixed(1),
    w: long ? 1.5 : 0.7,
  };
});

/** Large seal for watermarks: a ring of engraving around a struck medallion. */
export function VernyrSeal({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="-150 -150 300 300" aria-hidden className={className} fill="none">
      <g stroke="currentColor" strokeLinejoin="round">
        {RINGS.map((ring, i) => (
          <path key={i} d={ring.d} strokeWidth={ring.w} opacity={ring.o} />
        ))}

        <circle r="128" strokeWidth="0.7" opacity="0.7" />
        <circle r="138" strokeWidth="0.7" opacity="0.5" />
        <circle r="143" strokeWidth="2" opacity="0.25" />

        {TICKS.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={t.w} opacity="0.6" />
        ))}

        <circle r="44" strokeWidth="0.9" opacity="0.75" />
        <circle r="38" strokeWidth="0.5" opacity="0.5" />
      </g>

      {/* The mark struck in the middle of the medallion, sized to sit inside r=38. */}
      <g transform="scale(0.4)" fill="none" stroke="currentColor" strokeWidth={V.weight} strokeLinecap="round">
        <path d={V.left} />
        <path d={V.right} />
        <circle {...V.dot} fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

/**
 * The wordmark is the brand lettering, painted through an alpha mask so it
 * inherits `currentColor` and works on either theme. Sized in `em`, so
 * `className="text-[19px]"` sets its height the way it would set type.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Vernyr"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: `${WORDMARK_ASPECT}em`,
        height: '1em',
        verticalAlign: '-0.28em',
        WebkitMaskImage: `url(${WORDMARK_SRC})`,
        maskImage: `url(${WORDMARK_SRC})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}

/** Mark + wordmark, locked up at a fixed ratio. */
export function VernyrLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <VernyrMark className="h-[1.35em] w-[1.5em]" />
      <Wordmark />
    </span>
  );
}
