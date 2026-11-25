import { site } from '@/lib/site';

const routes = [
  {
    eyebrow: 'Students',
    title: 'Already applying with us',
    body: 'Track applications, upload documents and message your counsellor.',
    cta: 'Open the portal',
    href: site.portalUrl,
    primary: true,
  },
  {
    eyebrow: 'Staff',
    title: 'Counsellors and admins',
    body: 'The internal dashboard — caseloads, catalogue, finance and reports.',
    cta: 'Sign in to the CRM',
    href: site.crmUrl,
    primary: false,
  },
];

export function Contact() {
  return (
    <section id="contact" className="skin-soft border-t border-hairline/60">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <p className="eyebrow">Contact</p>

        <div className="mt-8 grid gap-16 lg:grid-cols-[1.05fr_1fr] lg:gap-24">
          <div>
            <h2 className="display text-[clamp(2rem,4.6vw,3.4rem)]">
              Start with a conversation.
              <br />
              <em>No form letters.</em>
            </h2>
            <p className="mt-6 max-w-lg text-[16px] leading-relaxed text-ink-soft">
              Tell us where you are — scores in hand, or only an idea. The first call is
              a counsellor working out whether this is the right year for you, not a
              sales pitch.
            </p>

            <dl className="mt-12 space-y-6">
              <div>
                <dt className="eyebrow">Email</dt>
                <dd className="mt-1.5">
                  <a href={`mailto:${site.email}`} className="text-[17px] text-ink underline decoration-hairline underline-offset-4 transition-colors hover:decoration-ink">
                    {site.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Phone</dt>
                <dd className="mt-1.5">
                  <a href={`tel:${site.phone.replace(/\s/g, '')}`} className="text-[17px] text-ink">
                    {site.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Office</dt>
                <dd className="mt-1.5 text-[17px] text-ink">{site.address}</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-4">
            {routes.map((r) => (
              <a
                key={r.title}
                href={r.href}
                className={`panel block p-8 ${r.primary ? '' : ''}`}
              >
                <p className="eyebrow">{r.eyebrow}</p>
                <h3 className="display mt-4 text-[1.7rem]">{r.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{r.body}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-[14px] font-medium text-ink">
                  {r.cta}
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 8h10" /><path d="M9 4l4 4-4 4" />
                  </svg>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
