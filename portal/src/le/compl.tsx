import Link from 'next/link';
import { local, t, type Any } from './p';

/** the profile completion bar (legacy/public/portal/js/home.js complBar) */
export function ComplBar({ c }: { c: Any }) {
  const col = c.percent < 50 ? 'var(--red)' : c.percent < 80 ? 'var(--orange)' : 'var(--green)';
  return <>
    <div className="compl"><span className="pc" style={{ color: col }}>{c.percent}%</span><div className="bar"><i style={{ width: `${c.percent}%`, background: col }} /></div></div>
    {c.next ? <div className="small" style={{ marginTop: 6 }}>{t('Next:')} <Link href={local(c.next.link)}>{t(c.next.label)}</Link></div> : null}
  </>;
}
