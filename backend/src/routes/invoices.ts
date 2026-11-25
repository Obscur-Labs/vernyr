import { Router, type Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { ServiceInvoice, type IServiceInvoice } from '../models/Invoice';
import { Application, Payment } from '../models/Work';
import { PaymentSubmission, type IPaymentSubmission } from '../models/Portal';
import { Counter } from '../models/Timeline';
import University from '../models/University';
import type { IStudent } from '../models/Student';
import { audit, getSetting } from '../models/Audit';
import { can } from '../config/clientPerms';
import { bad, fieldErr, notFound, handle, need, oid, clean, num, istDate, timeline, fullName, decrypt } from '../services/crm';
import { loadStudent } from '../services/students';
import { notifyStudent } from '../services/portal';
import { invoicePdf, receiptPdf, fmtDate, type InvoiceHelpers, type InvoiceRow } from '../services/invoicePdf';
import { env } from '../config/env';

/** Student service-fee GST invoices and receipts (legacy/server/svcinvoice.js): 18% GST, CGST + SGST in Gujarat, IGST elsewhere; one number series per financial year. */

export const KINDS = {
  service: { label: 'La Europa service fee (Service A / B / C)', gst: true, prefix: 'LE-SF', counter: 'SINV', doc: 'Tax Invoice', payment_for: 'La Europa service fee', note: undefined as string | undefined },
  uni_app_fee: { label: 'University application fee (no GST)', gst: false, prefix: 'LE-AF', counter: 'AFEE', doc: 'Payment Request', payment_for: 'Application fee',
    note: 'No GST is charged: this is the university application fee, collected on behalf of the university and paid to it at actual cost (pure agent, Rule 33 of the CGST Rules 2017). It is not a La Europa service fee.' },
};
export const SERVICES: Record<string, string> = { A: 'Service A: Country and University Selection Assistance', B: 'Service B: University / Institution Application Assistance',
  C: 'Service C: Student Visa / Residence-Permit Application Preparation Assistance' };
const kindOf = (inv: { kind?: string }) => KINDS[(inv.kind ?? 'service') as keyof typeof KINDS] ?? KINDS.service;
export const GST_RATE = 18;
const HOME_STATE = '24'; // Gujarat
export const STATES: [string, string][] = [['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'],
  ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'],
  ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['96', 'Outside India (other country)']];
const stateName = (code: string) => STATES.find((s) => s[0] === code)?.[1] ?? null;
export const stateCodeOf = (name?: string | null) => {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  return STATES.find((x) => x[1].toLowerCase() === n || (n === 'orissa' && x[0] === '21') || (n === 'jammu & kashmir' && x[0] === '01'))?.[0] ?? null;
};
const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const companyGstin = async () => String((await getSetting('company_gstin')) ?? '').toUpperCase();
const homeState = async () => (await companyGstin()).slice(0, 2) || HOME_STATE;

/** GST split; includes = the entered amount already includes GST. */
export async function calc(amount: number, includes: boolean, posCode: string, gst = true) {
  const a = r2(amount);
  const paise = (await getSetting('rounding')) === 'paise';
  if (!gst) { const total = paise ? a : Math.round(a); return { taxable: a, cgst: 0, sgst: 0, igst: 0, tax: 0, round_off: r2(total - a), total, supply_type: 'none' as const, gst_rate: 0 }; }
  const rate = GST_RATE / 100;
  const taxable = includes ? r2(a / (1 + rate)) : a;
  const tax = includes ? r2(a - taxable) : r2(a * rate);
  const intra = posCode === (await homeState());
  const cgst = intra ? r2(tax / 2) : 0, sgst = intra ? r2(tax - cgst) : 0, igst = intra ? 0 : tax;
  const exact = r2(taxable + tax);
  const total = paise ? exact : Math.round(exact);
  return { taxable, cgst, sgst, igst, tax, round_off: r2(total - exact), total, supply_type: intra ? 'intra' as const : 'inter' as const, gst_rate: GST_RATE };
}

/** Amount in words, Indian system (lakh / crore). */
export function words(n: number) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x: number) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const w = (x: number): string => {
    if (!x) return 'Zero';
    const parts = [];
    const cr = Math.floor(x / 1e7); x %= 1e7; const lk = Math.floor(x / 1e5); x %= 1e5; const th = Math.floor(x / 1000); x %= 1000;
    if (cr) parts.push(w(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (x) parts.push(three(x));
    return parts.join(' ');
  };
  const rs = Math.floor(n), ps = Math.round((n - rs) * 100);
  return `Rupees ${w(rs)}${ps ? ` and ${two(ps)} Paise` : ''} Only`;
}
const fyOf = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s + 1).slice(2)}`; };
/** GST invoice number: at most 16 characters, one series per financial year, e.g. LE-SF/26-27/0001. */
async function nextNo(prefix: string, counterKey: string, fy: string) {
  const c = await Counter.findByIdAndUpdate(counterKey, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `${prefix}/${fy}/${String(c!.value).padStart(4, '0')}`;
}
async function bank(): Promise<Record<string, string> | null> {
  const enc = await getSetting('company_bank_enc');
  if (!enc) return null;
  try { return JSON.parse(decrypt(String(enc)) ?? 'null'); } catch { return null; }
}
async function upiLink(inv: InvoiceRow) {
  const b = await bank();
  if (!b?.upi_id) return null;
  const q = new URLSearchParams({ pa: b.upi_id, pn: b.account_name || 'Euroverse Service LLP', am: inv.total.toFixed(2), cu: 'INR', tn: inv.invoice_no, tr: inv.invoice_no });
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20');
}
export const H: InvoiceHelpers = {
  words, bank, upiLink, kindOf, companyGstin, appUrl: () => env.portalUrl,
  proofDate: async (inv) => (await PaymentSubmission.findOne({ invoice_id: inv._id, status: 'Recorded' }).sort({ createdAt: -1 }).select('createdAt').lean())?.createdAt ?? null,
};
const gstLabel = (inv: Pick<IServiceInvoice, 'supply_type'>) => (inv.supply_type === 'intra' ? 'CGST 9% + SGST 9%' : inv.supply_type === 'inter' ? 'IGST 18%' : 'No GST');
export const invoiceOut = (inv: IServiceInvoice) => ({ ...inv.toObject(), id: String(inv._id), _id: undefined, __v: undefined, created_at: inv.createdAt, kind: inv.kind || 'service',
  kind_label: kindOf(inv).label, doc_label: kindOf(inv).doc, place: `${inv.place_of_supply} (${inv.pos_code})`, gst_label: gstLabel(inv) });

// ---------- create ----------
export async function createInvoice(req: AuthRequest, s: IStudent, b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  const kindKey = (b.kind in KINDS ? b.kind : 'service') as keyof typeof KINDS;
  const K = KINDS[kindKey];
  const amount = num(b.amount);
  if (!amount || amount <= 0) errors.amount = 'Amount must be more than 0'; else if (amount > 10_000_000) errors.amount = 'Amount looks too large';
  if (kindKey === 'service' && b.service_code && !SERVICES[b.service_code]) errors.service_code = 'Choose Service A, B or C';
  const app = kindKey === 'uni_app_fee' && oid(b.application_id) ? await Application.findOne({ _id: oid(b.application_id), student_id: s._id, is_deleted: false }).lean() : null;
  if (kindKey === 'uni_app_fee' && !app) errors.application_id = 'Choose the application (university)';
  const uni = app?.university_id ? (await University.findById(app.university_id).select('name').lean())?.name : null;
  const desc = clean(b.description, 200) || (app ? `University application fee: ${uni || 'University'} (${app.application_code})` : SERVICES[b.service_code] || 'Study abroad assistance service fee');
  const pos = String(b.pos_code || stateCodeOf(s.state) || (K.gst ? '' : '24'));
  if (!stateName(pos)) errors.pos_code = "Choose the student's state (place of supply): the student's state is missing in the profile";
  const gstin = b.bill_gstin ? String(b.bill_gstin).toUpperCase().trim() : null;
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) errors.bill_gstin = 'Enter a valid GSTIN or leave it empty';
  if (b.due_date && b.due_date < istDate()) errors.due_date = 'Due date cannot be in the past';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  if (K.gst && !(await companyGstin())) throw bad('The company GSTIN is not set. An Admin must add it in Admin console > Company profile.');
  const includes = K.gst && [true, 'true', '1', 1].includes(b.includes_gst);
  const posCode = gstin ? gstin.slice(0, 2) : pos;
  const c = await calc(amount!, includes, posCode, K.gst);
  const date = istDate(), fy = fyOf(date);
  // one number series per kind: tax invoices LE-SF/..., no-GST payment requests LE-AF/...
  const invoice_no = await nextNo((kindKey === 'service' && String((await getSetting('student_invoice_prefix')) ?? '')) || K.prefix, `${K.counter}-${fy}`, fy);
  const due = b.due_date || new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const inv = await ServiceInvoice.create({ invoice_no, fy, kind: kindKey, service_code: kindKey === 'service' ? b.service_code || undefined : undefined, application_id: app?._id,
    student_id: s._id, student_code: s.student_code, description: desc, sac: K.gst ? String((await getSetting('student_invoice_sac')) || '998599') : undefined,
    entered_amount: amount, amount_includes_gst: includes, ...c, place_of_supply: stateName(posCode) ?? undefined, pos_code: posCode,
    bill_name: clean(b.bill_name, 120) || fullName(s), bill_address: clean(b.bill_address, 300) || [s.address1, s.address2, s.city, s.state, s.pin].filter(Boolean).join(', ') || undefined,
    bill_gstin: gstin ?? undefined, invoice_date: date, due_date: due, status: 'Unpaid', created_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'payment', description: `${K.doc} ${invoice_no} raised: INR ${c.total.toLocaleString('en-IN')} (${K.gst ? `incl. GST ${GST_RATE}%` : 'no GST'}) for ${desc}`, user_id: req.user!.id });
  await audit(req, 'Create', 'ServiceInvoice', inv._id, `${invoice_no} ${c.total}`);
  await notifyStudent(s._id, `New ${K.gst ? 'invoice' : 'payment request'} ${invoice_no}: INR ${c.total.toLocaleString('en-IN')} due by ${fmtDate(due)}`, '/payments');
  return inv;
}

// ---------- after the counsellor accepts / rejects a payment proof ----------
export async function onProofRecorded(sub: IPaymentSubmission, paymentId: unknown, userId: string) {
  if (!sub.invoice_id) return null;
  const inv = await ServiceInvoice.findById(sub.invoice_id);
  if (!inv) return null;
  const date = (await Payment.findById(paymentId).select('payment_date').lean())?.payment_date || istDate();
  const fy = fyOf(date);
  const receipt_no = await nextNo(String((await getSetting('receipt_prefix')) || 'LE-RCPT'), `RCPT-20${fy.slice(0, 2)}-${fy.slice(3)}`, fy);
  await Payment.updateOne({ _id: paymentId }, { receipt_no, invoice_id: inv._id });
  inv.set({ status: 'Paid', payment_id: paymentId, receipt_no, paid_at: new Date(), updated_by: userId }); await inv.save();
  await timeline({ student_id: inv.student_id, type: 'payment', description: `Invoice ${inv.invoice_no} paid. Receipt ${receipt_no} issued.`, user_id: userId });
  await notifyStudent(inv.student_id, `Payment received for ${inv.invoice_no}. Your receipt ${receipt_no} is ready.`, '/payments');
  return receipt_no;
}
export const onProofRejected = (sub: IPaymentSubmission) =>
  sub.invoice_id ? ServiceInvoice.updateOne({ _id: sub.invoice_id, status: 'Proof submitted' }, { status: 'Unpaid' }) : null;

export const sendPdf = (res: Response, buf: Buffer, name: string) => {
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${name.replace(/\//g, '-')}.pdf"`); res.send(buf);
};
export const paymentOf = async (inv: IServiceInvoice) => {
  const p = await Payment.findById(inv.payment_id).lean();
  if (!p) throw bad('No receipt yet');
  return { amount: p.amount, payment_date: p.payment_date, mode: p.mode, reference_no: p.reference_no, createdAt: (p as { createdAt?: Date }).createdAt };
};

// ---------- staff ----------
const router = Router();
router.use(authenticate);
router.get('/students/:id/service-invoices', handle(async (req, res) => {
  need(req, 'fees', 'view');
  const s = await loadStudent(req, req.params.id);
  const [rows, apps, unis] = await Promise.all([ServiceInvoice.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 }),
    Application.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: 1 }).select('application_code university_id').lean(), University.find().select('name').lean()]);
  res.json({ rows: rows.map(invoiceOut), can_add: can(req.user!.role, 'fees', 'add'), states: STATES, student_state: s.state ?? null, student_pos: stateCodeOf(s.state),
    home_state: await homeState(), gst_rate: GST_RATE, gstin_set: !!(await companyGstin()), bank_set: !!(await bank()),
    kinds: Object.entries(KINDS).map(([key, v]) => ({ key, label: v.label, gst: v.gst })), services: Object.entries(SERVICES),
    applications: apps.map((a) => ({ id: String(a._id), label: `${unis.find((u) => String(u._id) === String(a.university_id))?.name || 'University'} (${a.application_code})` })) });
}));
router.post('/students/:id/service-invoices', handle(async (req, res) => {
  need(req, 'fees', 'add');
  const s = await loadStudent(req, req.params.id);
  res.json(invoiceOut(await createInvoice(req, s, req.body ?? {})));
}));
// the live GST split while typing
router.post('/service-invoices/preview', handle(async (req, res) => {
  const amt = num(req.body?.amount);
  if (!amt || amt <= 0) throw fieldErr('amount', 'Amount must be more than 0');
  const K = KINDS[(req.body?.kind in KINDS ? req.body.kind : 'service') as keyof typeof KINDS];
  res.json(await calc(amt, K.gst && !!req.body?.includes_gst, String(req.body?.pos_code ?? ''), K.gst));
}));
async function loadInv(req: AuthRequest, perm: string) {
  need(req, 'fees', perm);
  const inv = await ServiceInvoice.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!inv) throw notFound('Invoice');
  await loadStudent(req, String(inv.student_id));
  return inv;
}
router.post('/service-invoices/:id/cancel', handle(async (req, res) => {
  const inv = await loadInv(req, 'edit');
  if (inv.status === 'Paid') throw bad('A paid invoice cannot be cancelled. Record a refund / credit note instead.');
  const reason = clean(req.body?.reason, 300);
  if (!reason) throw fieldErr('reason', 'Reason is required');
  inv.set({ status: 'Cancelled', cancel_reason: reason, updated_by: req.user!.id }); await inv.save();
  await timeline({ student_id: inv.student_id, type: 'payment', description: `Invoice ${inv.invoice_no} cancelled: ${reason}`, user_id: req.user!.id });
  await audit(req, 'Cancel', 'ServiceInvoice', inv._id, inv.invoice_no);
  res.json({ ok: true });
}));
router.get('/service-invoices/:id/invoice.pdf', handle(async (req, res) => { const inv = await loadInv(req, 'view'); sendPdf(res, await invoicePdf(inv as unknown as InvoiceRow, H), inv.invoice_no); }));
router.get('/service-invoices/:id/receipt.pdf', handle(async (req, res) => {
  const inv = await loadInv(req, 'view');
  if (!inv.payment_id) throw bad('No receipt yet');
  sendPdf(res, await receiptPdf(inv as unknown as InvoiceRow, await paymentOf(inv), H), inv.receipt_no ?? inv.invoice_no);
}));

export default router;
