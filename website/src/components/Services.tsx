const services = [
  {
    n: '01',
    title: 'Counselling',
    body: 'A long first conversation about scores, budget, and what you actually want out of the degree — before any list of universities exists.',
  },
  {
    n: '02',
    title: 'University selection',
    body: 'A shortlist built from a catalogue we maintain ourselves: tuition, intakes, entry requirements and deadlines, checked rather than guessed.',
  },
  {
    n: '03',
    title: 'Applications',
    body: 'Documents assembled, statements read properly, and every submission tracked to its offer — conditional, unconditional or otherwise.',
  },
  {
    n: '04',
    title: 'Offers & fees',
    body: 'Offer letters reviewed line by line, deposits scheduled, receipts filed where you can find them again.',
  },
  {
    n: '05',
    title: 'Visa filing',
    body: 'Financial proof, appointments, biometrics and the interview — prepared in the order the consulate expects them.',
  },
  {
    n: '06',
    title: 'Departure',
    body: 'Accommodation, insurance, forex and the pre-departure briefing, so the last month is calm rather than frantic.',
  },
];

export function Services() {
  return (
    <section id="services" className="skin-soft border-t border-hairline/60">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <p className="eyebrow">Services</p>
        <h2 className="display mt-8 max-w-2xl text-[clamp(2rem,4.6vw,3.4rem)]">
          Ten stages, <em>one thread.</em>
        </h2>
        <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-soft">
          The journey runs from inquiry to departure. Here is what we do at each turn —
          and what you will see happening in your portal while we do it.
        </p>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <article key={s.n} className="panel p-7">
              <p className="eyebrow">{s.n}</p>
              <h3 className="display mt-4 text-[1.6rem]">{s.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
