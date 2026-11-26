'use client';

import { useCallback, useEffect, useState } from 'react';
import { GET, POST, blob } from './api';
import { fmtDate } from './format';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { t, usePMe, type Any } from './p';

/** Shared portal pieces: legal documents (auth.js showLegal), sharing a card (offers.js share), university sharing consents (apps.js shareConsents). */

export async function showLegal(type: string) {
  try {
    const d = await GET('/legal/' + type);
    openOverlay((close) => <Modal title={`${d.title} (v${d.version})`} size="lg" close={close}>
      {d.html ? <><div className="legal-md" dangerouslySetInnerHTML={{ __html: d.html }} /><p className="small"><a href="/legal" target="_blank" rel="noopener noreferrer">{t('Open the website version and PDF')}</a></p></> : <div className="legal-text">{d.text}</div>}
    </Modal>);
  } catch (e) { showError(e); }
}
export function saveFile(f: File) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
export async function shareCard(promo?: string) {
  const b = await blob(`/referrals/card.png${promo ? '?promo=' + encodeURIComponent(promo) : ''}`).catch(() => { throw new Error(t('Could not make the card')); });
  return new File([b], `La-Europa-referral${promo ? '-' + promo : ''}.png`, { type: 'image/png' });
}
/** share the whole card (image) and link; falls back to WhatsApp text */
export async function share(link: string, text: string, promo?: string) {
  try {
    const f = await shareCard(promo);
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], text: `${text}\n${link}` }); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`, '_blank', 'noopener');
  } catch (e) { if ((e as Error).name !== 'AbortError') showError(e); }
}

function ConsentCard({ r, d, minor, done }: { r: Any; d: Any; minor: boolean; done: () => void }) {
  const [ok, setOk] = useState(false), [g, setG] = useState(false);
  const give = async () => {
    if (!ok) { toast(t('Please tick that you agree'), 'err'); return; }
    try { await POST(`/share-consents/${r.application_id}/give`, { confirm: true, guardian_confirm: minor ? g : undefined }); toast(t('Thank you. Your counsellor can now send your application.'), 'ok'); done(); } catch (e) { showError(e); }
  };
  const decline = async () => { if (!(await confirmBox(t('Your application cannot be sent to this university without your agreement. Your counsellor will contact you.'), { ok: t('I do not agree'), cancel: t('Back') }))) return; await POST(`/share-consents/${r.application_id}/decline`).catch(showError); done(); };
  const withdraw = async () => { if (!(await confirmBox(t('Withdraw your consent? The university will lose access to your documents. Data it already received is under its own responsibility.'), { ok: t('Withdraw'), cancel: t('Back') }))) return; await POST(`/share-consents/${r.application_id}/withdraw`).catch(showError); done(); };
  return (
    <div className="p-card consent-card" style={{ marginBottom: 12 }}><div className="bd">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><b>{t('Share my application with')} {r.university}</b><span className="small muted">{r.country} · {r.course} · {r.intake}</span><span className="grow" />
        <span className={`badge ${r.status === 'Given' ? 'green' : r.status === 'Requested' ? 'orange' : 'grey'}`}>{t(r.status)}</span></div>
      {r.status === 'Requested' ? <>
        <p className="small" style={{ margin: '8px 0' }}>{t('La Europa would like to send your application to this university, which is outside India. The university will receive only:')}</p>
        <ul className="small">{d.fields.map((f: string) => <li key={f}>{t(f)}</li>)}</ul>
        <p className="small muted">{r.contact_shared ? t('This university also receives your phone and email (agreed by La Europa).') : t('Your phone number, email, address, family and finances are NOT shared.')}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); openOverlay((close) => <Modal title={d.text.title} size="lg" close={close}><div className="legal-text">{d.text.text}</div></Modal>); }}>{t('Read the full consent text')}</a></p>
        <label className="consent"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span>{t('I agree that La Europa shares my application with')} {r.university} ({r.country}).</span></label>
        {minor ? <label className="consent"><input type="checkbox" checked={g} onChange={(e) => setG(e.target.checked)} /> <span>{t('My parent / guardian also agrees.')}</span></label> : null}
        <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn primary sm" onClick={give}>{t('I agree')}</button><button className="btn sm" onClick={decline}>{t('I do not agree')}</button></div>
      </> : r.status === 'Given' ? <div className="small" style={{ marginTop: 6 }}>{t('You agreed on')} {fmtDate(r.at)}.{r.documents.length ? ' ' + t('Documents shared:') + ' ' + r.documents.join(', ') : ''} <button className="btn xs" onClick={withdraw}>{t('Withdraw consent')}</button></div> : null}
    </div></div>
  );
}
/** consents to share an application with a university outside India: give, decline or withdraw (only the waiting ones unless `all`) */
export function ShareConsents({ all = false, onChange }: { all?: boolean; onChange?: () => void }) {
  const minor = !!usePMe((s) => s.me?.is_minor);
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/share-consents').then(setD).catch(() => setD(null)), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const rows = d.rows.filter((r: Any) => (all ? r.status !== 'Not requested' : r.status === 'Requested'));
  return <>{rows.map((r: Any) => <ConsentCard key={r.application_id} r={r} d={d} minor={minor} done={() => { load(); onChange?.(); }} />)}</>;
}
