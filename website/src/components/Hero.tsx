import { VernyrMark } from './Brand';
import { site } from '@/lib/site';

const stats = [
  { n: `${site.stats.universities}`, label: 'partner universities' },
  { n: `${site.stats.countries}`, label: 'countries in Europe' },
  { n: `${site.stats.courses.toLocaleString('en-IN')}`, label: 'courses catalogued' },
];

export function Hero() {
  return (
    <section id="top" className="skin drift relative min-h-[100svh] pt-20">
      <div className="relative z-10 mx-auto flex min-h-[calc(100svh-5rem)] max-w-6xl flex-col justify-center px-6 py-20">
        <span className="badge mb-7 w-fit">
          <span className="pulse" aria-hidden />
          Now enrolling · 2026 intakes
        </span>

        <h1 className="display max-w-4xl text-[clamp(2.75rem,8.5vw,6.5rem)]">
          Your degree abroad,
          <br />
          <em>start to finish.</em>
        </h1>

        <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-ink-soft">
          Counselling, university selection, applications, visas and departure — one
          team and one place, from the first conversation to the day you land.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#contact"
            className="rounded-full bg-ink px-6 py-3.5 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
          >
            Talk to a counsellor
          </a>
          <a
            href={site.portalUrl}
            className="rounded-full bg-white/60 px-6 py-3.5 text-[14px] font-medium text-ink backdrop-blur transition-colors hover:bg-white/85"
          >
            Open the student portal →
          </a>
        </div>

        <dl className="mt-20 flex flex-wrap gap-x-14 gap-y-8">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="display text-[2.6rem] leading-none">{s.n}</dt>
              <dd className="eyebrow mt-2">{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* The mark, very large and very quiet, bleeding off the right edge. */}
      <VernyrMark
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-[-6%] hidden w-[38rem] opacity-[0.07] lg:block"
      />
    </section>
  );
}
