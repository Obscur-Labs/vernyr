'use client';

import { useEffect, useState } from 'react';
import { DEL, GET, PUT, SEND, ApiError, download } from './api';
import { showError, toast } from './ui';
import { Page, useLoad, type Any } from './u';

/** The client's "Letters & bank details" (legacy/public/university/js/letters.js): letterhead, signatory, signature, stamp, logo, bank account, fees and contact person, filled once. */

const DOCS: [string, string][] = [['offer_conditional', 'Conditional offer'], ['offer_unconditional', 'Unconditional offer'], ['loa', 'Final LOA (visa)'], ['invoice', 'Tuition fee invoice'], ['receipt', 'Payment receipt']];
const hexOk = (x: unknown) => /^#?[0-9a-f]{6}$/i.test(String(x || ''));

function Img({ k, label, has, uniLogo, ed, reload }: { k: string; label: string; has: boolean; uniLogo: boolean; ed: boolean; reload: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (has) GET(`/letters/settings/image/${k}`).then((r) => setSrc(r.url)).catch(() => setSrc(null)); else setSrc(null); }, [has, k]);
  const upload = async (f?: File) => { if (!f) return; const fd = new FormData(); fd.append('file', f); try { await SEND('post', `/letters/settings/image/${k}`, fd); toast('Uploaded', 'ok'); reload(); } catch (e) { showError(e); } };
  return (
    <div className="card"><div className="bd"><b>{label}</b>
      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--soft)', border: '1px dashed var(--line-2)', borderRadius: 12, margin: '8px 0' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={label} style={{ maxHeight: 80, maxWidth: '100%' }} /> : <span className="small muted">{k === 'logo' && uniLogo ? 'Using your profile logo' : 'Not uploaded'}</span>}
      </div>
      {ed ? <div className="row" style={{ gap: 6 }}><label className="btn xs">Upload PNG / JPG<input type="file" accept=".png,.jpg,.jpeg" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
        {has ? <button className="btn xs" onClick={async () => { try { await DEL(`/letters/settings/image/${k}`); reload(); } catch (e) { showError(e); } }}>Remove</button> : null}</div> : null}
    </div></div>
  );
}

export function Letters() {
  const st = useLoad(() => GET('/letters/settings'), []);
  const [s, setS] = useState<Any | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (st.data) setS({ ...(st.data as Any).settings, other_fees: ((st.data as Any).settings.other_fees || []).map((x: Any) => ({ ...x })) }); }, [st.data]);
  return <Page state={st}>{() => { if (!s) return null; const d = st.data as Any; const ed = !!d.can_edit;
    const set = (k: string, v: unknown) => setS((x) => ({ ...x!, [k]: v }));
    const F = ({ k, label, type = 'text', help, width, upper }: { k: string; label: string; type?: string; help?: string; width?: number; upper?: boolean }) => (
      <div className={`f${errors[k] ? ' err' : ''}`}><label>{label}</label>
        {type === 'textarea' ? <textarea className="input" rows={3} style={{ height: 'auto', padding: 8 }} disabled={!ed} value={s[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
          : <input className="input" type={type} disabled={!ed} value={s[k] ?? ''} style={{ width, textTransform: upper ? 'uppercase' : undefined }} onChange={(e) => set(k, e.target.value)} />}
        {help ? <div className="help">{help}</div> : null}<div className="msg">{errors[k] ?? ''}</div></div>);
    const save = async () => {
      setErrors({});
      const b: Any = { ...s, currency: s.currency ? String(s.currency).toUpperCase() : s.currency };
      for (const k of ['has_logo', 'has_signature', 'has_stamp', 'university_id', 'createdAt', 'updatedAt']) delete b[k];
      try { await PUT('/letters/settings', b); toast('Saved. All new letters use these details.', 'ok'); st.reload(); }
      catch (e) { if (e instanceof ApiError && e.data.errors) setErrors(e.data.errors); showError(e); }
    };
    const fees: Any[] = s.other_fees || [];
    const setFee = (i: number, k: string, v: string) => set('other_fees', fees.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
    return (<>
      <div className="page-head"><div><h1>Letters &amp; bank details</h1><div className="sub">Fill this once. Every offer letter, final LOA, tuition fee invoice and payment receipt uses your letterhead, signature, stamp, bank account and fees. Only your university appears on these documents.</div></div></div>
      <div className="card" style={{ marginBottom: 14 }}><div className="hd"><h2>Letter format</h2><span className="grow" /><span className="small muted">Choose your default; you can pick another format for any single letter.</span></div><div className="bd">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>{d.formats.map((f: Any) => (
          <label key={f.id} className="card" style={{ padding: 10, cursor: 'pointer', ...(Number(s.default_format) === f.id ? { outline: '2px solid var(--indigo)' } : {}) }}>
            <div className="row" style={{ gap: 6 }}><input type="radio" name="default_format" checked={Number(s.default_format) === f.id} disabled={!ed} onChange={() => set('default_format', f.id)} /><b>{f.id}. {f.name}</b></div>
            <div className="small muted" style={{ margin: '4px 0 8px' }}>{f.note}</div>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{DOCS.map(([k, l]) => <button key={k} type="button" className="btn xs" onClick={(e) => { e.preventDefault(); download(`/letters/preview/${k}?format=${f.id}`, `sample-${k}.pdf`, undefined, true).catch(showError); }}>{l}</button>)}</div>
          </label>))}</div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>Previews use a sample student and your saved details. Save first to see changes.</p>
      </div></div>
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="grid two" style={{ gap: 14 }}>
          <div className="card"><div className="hd"><h2>Letterhead</h2></div><div className="bd">
            <F k="legal_name" label="Official name on letters" /><F k="address" label="Address (as on your letterhead)" type="textarea" />
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><F k="phone" label="Phone" /><F k="email" label="Email" type="email" /><F k="website" label="Website" /></div>
            <F k="registration" label="Registration / accreditation line (optional)" /><F k="footer_text" label="Footer text (optional, replaces name and address in the footer)" />
            <div className={`f${errors.accent ? ' err' : ''}`}><label>Your colour (headings, lines, header band, table headers)</label>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input type="color" disabled={!ed} value={hexOk(s.accent) ? (String(s.accent).startsWith('#') ? s.accent : '#' + s.accent) : '#0f4c81'} onChange={(e) => set('accent', e.target.value.toUpperCase())}
                  style={{ width: 48, height: 36, padding: 0, border: '1px solid var(--line)', borderRadius: 10 }} />
                <input className="input" placeholder="#0F4C81" maxLength={7} style={{ width: 120, textTransform: 'uppercase' }} disabled={!ed} value={s.accent || ''} onChange={(e) => set('accent', e.target.value)} />
                {ed ? <button type="button" className="btn xs" onClick={() => set('accent', '')}>Use format colours</button> : null}</div>
              <div className="help">Pick a colour or type your colour code (for example your logo colour). Empty = each format uses its own colour.</div><div className="msg">{errors.accent ?? ''}</div></div>
          </div></div>
          <div className="card"><div className="hd"><h2>Signatory and contact person</h2></div><div className="bd">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><F k="signatory_name" label="Signatory name" /><F k="signatory_designation" label="Signatory designation" /></div>
            <p className="small muted">Contact person shown on the final LOA (for the embassy):</p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><F k="contact_name" label="Name" /><F k="contact_designation" label="Designation" /><F k="contact_email" label="Email" type="email" /><F k="contact_phone" label="Phone" /></div>
          </div></div>
          <div className="card"><div className="hd"><h2>Bank account (for students)</h2></div><div className="bd">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><F k="bank_name" label="Bank name" /><F k="bank_account_name" label="Account name" /></div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><F k="bank_account_no" label="Account number" /><F k="bank_iban" label="IBAN" /><F k="bank_swift" label="SWIFT / BIC" /></div>
            <F k="bank_address" label="Bank address" /><F k="bank_note" label="Payment reference instruction" help='Use {student_id} to insert the student ID, e.g. "Quote {student_id} and your full name".' />
          </div></div>
          <div className="card"><div className="hd"><h2>Fees (filled into every letter)</h2></div><div className="bd">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><F k="currency" label="Currency" width={90} upper /><F k="tuition_default" label="Tuition fee (first year)" type="number" />
              <F k="deposit_default" label="Deposit to confirm the seat" type="number" /><F k="offer_validity_days" label="Offer valid for (days)" type="number" /></div>
            <div className="f"><label>Other fees per year (shown in the fee table)</label>
              {fees.length ? fees.map((x, i) => (
                <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <input className="input grow" placeholder="e.g. Student services fee" disabled={!ed} value={x.label ?? ''} onChange={(e) => setFee(i, 'label', e.target.value)} />
                  <input className="input" type="number" min={0} step={0.01} style={{ width: 140 }} disabled={!ed} value={x.amount ?? ''} onChange={(e) => setFee(i, 'amount', e.target.value)} />
                  {ed ? <button type="button" className="btn xs ghost" onClick={() => set('other_fees', fees.filter((_, j) => j !== i))}>✕</button> : null}
                </div>)) : <div className="small muted">None</div>}
              {ed ? <button type="button" className="btn xs" onClick={() => set('other_fees', [...fees, { label: '', amount: '' }])}>+ Add fee</button> : null}</div>
            <p className="small muted">Amounts only. Do not write words like non-EU, international or foreign.</p>
          </div></div>
          <div className="card"><div className="hd"><h2>Text</h2></div><div className="bd">
            <F k="offer_terms" label="Terms and conditions (format 5)" type="textarea" />
            <F k="loa_note" label="Closing sentence on the final LOA" type="textarea" help='Default: "This letter is issued at the request of the student for visa and immigration purposes."' />
          </div></div>
        </div>
      </form>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginTop: 14 }}>
        <Img k="logo" label="Logo (top of every letter)" has={!!s.has_logo} uniLogo={!!d.uni_logo} ed={ed} reload={st.reload} />
        <Img k="signature" label="Signature of the signatory" has={!!s.has_signature} uniLogo={false} ed={ed} reload={st.reload} />
        <Img k="stamp" label="University stamp / seal" has={!!s.has_stamp} uniLogo={false} ed={ed} reload={st.reload} />
      </div>
      {ed ? <div className="form-actions" style={{ marginTop: 14 }}><button className="btn primary" onClick={save}>Save letters &amp; bank details</button></div> : <p className="small muted">Only the University Admin can change these details.</p>}
    </>); }}</Page>;
}
