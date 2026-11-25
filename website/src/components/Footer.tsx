import { Logo } from './Brand';
import { nav, site } from '@/lib/site';

export function Footer() {
  return (
    <footer className="skin-soft border-t border-hairline/60">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div>
            <span className="text-[19px]">
              <Logo size={24} />
            </span>
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-ink-soft">
              {site.tagline}
            </p>
          </div>

          <div className="flex flex-wrap gap-14">
            <nav className="flex flex-col gap-2.5">
              <p className="eyebrow mb-1">Explore</p>
              {nav.map((n) => (
                <a key={n.href} href={n.href} className="text-[14px] text-ink-soft transition-colors hover:text-ink">
                  {n.label}
                </a>
              ))}
            </nav>

            <nav className="flex flex-col gap-2.5">
              <p className="eyebrow mb-1">Sign in</p>
              <a href={site.portalUrl} className="text-[14px] text-ink-soft transition-colors hover:text-ink">
                Student portal
              </a>
              <a href={site.crmUrl} className="text-[14px] text-ink-soft transition-colors hover:text-ink">
                Staff CRM
              </a>
            </nav>

            <nav className="flex flex-col gap-2.5">
              <p className="eyebrow mb-1">Legal</p>
              <a
                href={site.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] text-ink-soft transition-colors hover:text-ink"
              >
                Terms &amp; conditions
              </a>
              <a
                href={site.privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] text-ink-soft transition-colors hover:text-ink"
              >
                Privacy policy
              </a>
            </nav>
          </div>
        </div>

        <div className="rule my-12" />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[13px] text-ink-faint">
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </p>
          <p className="eyebrow">{site.domain}</p>
        </div>
      </div>
    </footer>
  );
}
