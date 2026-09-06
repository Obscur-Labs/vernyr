import { site } from '@/lib/site';

/** Countries the catalogue actually covers, largest first. */
const countries = [
  { name: 'Spain', n: 43 }, { name: 'Greece', n: 26 }, { name: 'Portugal', n: 25 },
  { name: 'Switzerland', n: 20 }, { name: 'Belgium', n: 17 }, { name: 'Czech Republic', n: 15 },
  { name: 'Austria', n: 15 }, { name: 'Romania', n: 14 }, { name: 'Denmark', n: 11 },
  { name: 'Hungary', n: 8 }, { name: 'Estonia', n: 8 }, { name: 'Croatia', n: 7 },
  { name: 'Slovakia', n: 6 }, { name: 'China', n: 3 }, { name: 'Ireland', n: 1 },
  { name: 'Luxembourg', n: 1 },
];

/** A sample of the institutions on the list. */
const universities = [
  'KU Leuven', 'University of Vienna', 'Université Libre de Bruxelles',
  'University of Barcelona', 'Masaryk University', 'Aarhus University',
  'University of Coimbra', 'University of Geneva', 'Tallinn University',
  'University of Antwerp', 'Complutense University of Madrid', 'University of Zagreb',
  'Brno University of Technology', 'University of Bern', 'University of Aveiro',
  'Vienna University of Technology', 'University of Bucharest', 'Aalborg University',
  'University of Salamanca', 'University of the Aegean', 'University of Basel',
  'Estonian Business School', 'University of Piraeus', 'Autonomous University of Barcelona',
];

export function Partners() {
  return (
    <section id="partners" className="skin-soft border-t border-hairline/60">
      <div className="mx-auto max-w-6xl px-6 pt-28">
        <p className="eyebrow">Partners</p>
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <h2 className="display max-w-2xl text-[clamp(2rem,4.6vw,3.4rem)]">
            {site.stats.universities} universities.
            <br />
            <em>Sixteen countries.</em>
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-ink-soft">
            Every institution below sits in a catalogue we maintain by hand —{' '}
            {site.stats.courses.toLocaleString('en-IN')} courses with their tuition,
            intakes and entry requirements kept current.
          </p>
        </div>

        <ul className="mt-14 flex flex-wrap gap-2">
          {countries.map((c) => (
            <li
              key={c.name}
              className="rounded-full bg-white/55 px-4 py-2 text-[13px] text-ink-soft backdrop-blur"
            >
              {c.name}
              <span className="ml-2 text-ink-faint">{c.n}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Two copies, translated by half — the loop is seamless. */}
      <div className="mt-16 overflow-hidden pb-28" aria-label="Partner universities">
        <div className="marquee gap-3">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 gap-3 pr-3" aria-hidden={copy === 1}>
              {universities.map((u) => (
                <span
                  key={u}
                  className="whitespace-nowrap rounded-2xl bg-white/55 px-6 py-4 text-[15px] text-ink-soft backdrop-blur"
                >
                  {u}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
