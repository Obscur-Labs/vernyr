const beliefs = [
  {
    k: 'One team, whole journey',
    v: 'The counsellor who shortlists your universities is the one who reads your visa file. Nothing is handed to a stranger halfway.',
  },
  {
    k: 'You can see everything',
    v: 'Your portal shows every application, document and payment as it moves. No calling to ask where things stand.',
  },
  {
    k: 'Europe, properly known',
    v: 'We work a focused map rather than a long one — tuition, intakes and entry requirements we have actually checked.',
  },
];

export function About() {
  return (
    <section id="about" className="skin-soft border-t border-hairline/60">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <p className="eyebrow">About</p>

        <div className="mt-8 grid gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
          <h2 className="display text-[clamp(2rem,4.6vw,3.4rem)]">
            An application is a hundred small deadlines.
            <br />
            <em>We hold all of them.</em>
          </h2>

          <div className="space-y-5 text-[16px] leading-relaxed text-ink-soft">
            <p>
              Most students lose a year not because they were not good enough, but
              because a transcript was late, an intake closed, or nobody told them the
              financial proof needed six weeks of bank history.
            </p>
            <p>
              Vernyr exists to make that impossible. Every student has a counsellor, a
              stage they can see, and a record that updates the moment something moves.
            </p>
          </div>
        </div>

        <div className="rule my-16" />

        <dl className="grid gap-10 md:grid-cols-3">
          {beliefs.map((b) => (
            <div key={b.k}>
              <dt className="display text-[1.5rem]">{b.k}</dt>
              <dd className="mt-3 text-[15px] leading-relaxed text-ink-soft">{b.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
