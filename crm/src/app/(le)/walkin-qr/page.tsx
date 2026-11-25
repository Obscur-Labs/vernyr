'use client';

import { useEffect, useState } from 'react';
import { GET, blob } from '@/le/api';
import { showError, toast } from '@/le/ui';

// The client's Walk-in QR (legacy/public/js/pages/walkin.js): ONE office QR; the whole card downloads as an A4 standee PDF or a PNG for WhatsApp
const file = async (format: 'pdf' | 'png') => new File([await blob(`/walkin-qr/card.${format}`)], `La-Europa-walk-in-QR-A4-standee.${format}`, { type: format === 'pdf' ? 'application/pdf' : 'image/png' });
const save = (f: File) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

export default function WalkinQr() {
  const [png, setPng] = useState('');
  useEffect(() => { GET('/walkin-qr').then((d) => setPng(d.png)).catch(showError); }, []);
  const share = async () => {
    try {
      const f = await file('png');
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: 'La Europa Education', text: 'Scan to create your student account with La Europa Education' });
      else { save(f); toast('Sharing is not available in this browser: the image was downloaded instead.', 'ok'); }
    } catch (e) { if ((e as Error).name !== 'AbortError') showError(e); }
  };
  return (
    <>
      <div className="page-head no-print">
        <div><h1>Walk-in QR</h1><div className="sub">For students who visit the office or contact La Europa for the first time: they scan, create their login, and a counsellor is assigned.</div></div><span className="grow" />
        <button className="btn primary" onClick={() => file('pdf').then(save).catch(showError)}>⬇ A4 standee (PDF)</button>
        <button className="btn" onClick={() => file('png').then(save).catch(showError)}>⬇ Image (PNG)</button>
        <button className="btn" onClick={share}>Share</button><button className="btn ghost" onClick={() => window.print()}>Print</button>
      </div>
      <div className="card qr-card"><div className="bd" style={{ textAlign: 'center', padding: '32px 20px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/vernyr-logo.svg" alt="Vernyr" style={{ height: 64, marginBottom: 8 }} />
        <h1 style={{ margin: '4px 0 4px' }}>Welcome to La Europa Education</h1>
        <p className="muted" style={{ margin: '0 0 18px' }}>Scan to create your student account and start your study abroad file</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {png ? <img src={png} alt="QR code to the La Europa student sign-up" style={{ width: 'min(320px,80vw)', height: 'auto', border: '1px solid var(--line)', borderRadius: 20, padding: 10, background: '#fff' }} /> : <div className="empty">Loading...</div>}
        <p className="small muted no-print" style={{ marginTop: 14 }}>The PDF is A4 (210 × 297 mm), the size of a standard table standee. The image is 1654 × 2339 px for WhatsApp or a print shop.</p>
      </div></div>
    </>
  );
}
