'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const voices = [
  {
    quote:
      'I had three rejections before I came here. The difference was someone actually reading my statement instead of forwarding it.',
    name: 'Ankit P.',
    detail: 'MSc Data Science · Netherlands',
  },
  {
    quote:
      'Being able to open the portal at midnight and see exactly which document was still pending saved me a hundred phone calls.',
    name: 'Jeel M.',
    detail: 'MBA · Spain',
  },
  {
    quote:
      'My visa file was ready three weeks before the appointment. I have friends who were still collecting papers the night before theirs.',
    name: 'Het N.',
    detail: 'MS Mechanical · Germany',
  },
  {
    quote:
      'They talked me out of a university I was set on, and explained why. That is the part I did not expect.',
    name: 'Dharmik V.',
    detail: 'BSc Business · Portugal',
  },
  {
    quote:
      'English was my worry, not my scores. They found the programmes that taught in English and stopped me wasting months on the rest.',
    name: 'Riya S.',
    detail: 'MA International Relations · Czechia',
  },
  {
    quote:
      'The fee breakdown was the same on the day I paid as it was the day I was quoted. Nothing appeared later.',
    name: 'Karan T.',
    detail: 'MSc Finance · Ireland',
  },
];

export function Voices() {
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const [reach, setReach] = useState({ start: true, end: false });

  /** The rail is the source of truth — buttons, dots and keys all just scroll it. */
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = card ? card.offsetWidth + 16 : 1;
    setActive(Math.round(el.scrollLeft / step));
    setReach({
      start: el.scrollLeft < 8,
      end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 8,
    });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const scrollTo = (index: number) => {
    const el = track.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = card ? card.offsetWidth + 16 : 0;
    el.scrollTo({ left: index * step, behavior: 'smooth' });
  };

  const nudge = (dir: -1 | 1) => scrollTo(Math.max(0, active + dir));

  return (
    <section id="voices" className="skin-soft border-t border-hairline/60">
      <div className="mx-auto max-w-6xl px-6 pt-28">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="eyebrow">Students</p>
            <h2 className="display mt-8 max-w-2xl text-[clamp(2rem,4.6vw,3.4rem)]">
              What it felt like <em>from their side.</em>
            </h2>
          </div>

          <div className="flex gap-2">
            {([-1, 1] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => nudge(dir)}
                disabled={dir === -1 ? reach.start : reach.end}
                aria-label={dir === -1 ? 'Previous review' : 'Next review'}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/60 text-ink backdrop-blur transition-all hover:bg-white/90 disabled:pointer-events-none disabled:opacity-30"
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {dir === -1 ? <><path d="M13 8H3" /><path d="M7 4L3 8l4 4" /></> : <><path d="M3 8h10" /><path d="M9 4l4 4-4 4" /></>}
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Full-bleed rail: the cards run past the right edge so it reads as a
          slider even before anyone touches it. */}
      <ul
        ref={track}
        tabIndex={0}
        aria-label="Student reviews"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
        }}
        className="no-bar mt-14 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-6 pb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 lg:px-[max(1.5rem,calc((100vw-72rem)/2))]"
      >
        {voices.map((v) => (
          <li
            key={v.name}
            className="panel flex w-[min(88vw,26rem)] shrink-0 snap-start flex-col justify-between p-8"
          >
            <blockquote className="display text-[1.45rem] leading-[1.28]">
              “{v.quote}”
            </blockquote>
            <figcaption className="mt-8 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[12px] font-medium text-paper">
                {v.name.slice(0, 1)}
              </span>
              <span>
                <span className="block text-[14px] font-medium text-ink">{v.name}</span>
                <span className="block text-[13px] text-ink-faint">{v.detail}</span>
              </span>
            </figcaption>
          </li>
        ))}
      </ul>

      <div className="mx-auto flex max-w-6xl justify-center gap-2 px-6 pb-28 pt-6">
        {voices.map((v, i) => (
          <button
            key={v.name}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Review ${i + 1}`}
            aria-current={i === active}
            className={`h-1.5 rounded-full transition-all ${
              i === active ? 'w-7 bg-ink' : 'w-1.5 bg-ink/20 hover:bg-ink/40'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
