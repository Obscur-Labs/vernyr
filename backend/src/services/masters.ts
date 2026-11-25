import { Country, Intake, MasterItem } from '../models/Master';

/** The client's default masters (legacy/server/seed.js + util.js). Seeded once; Admin edits them afterwards. */

const COUNTRIES: [string, string, string, boolean][] = [
  ['France', 'FR', 'EUR', false], ['Italy', 'IT', 'EUR', false], ['Spain', 'ES', 'EUR', false], ['Netherlands', 'NL', 'EUR', false],
  ['Finland', 'FI', 'EUR', false], ['Sweden', 'SE', 'SEK', false], ['Ireland', 'IE', 'EUR', false], ['Germany', 'DE', 'EUR', true], ['China', 'CN', 'CNY', false],
];
const CHANNELS: Record<string, string[]> = {
  France: ['Campus France', 'Direct university portal'], Italy: ['Universitaly', 'Direct university portal'], Germany: ['Uni-Assist', 'Direct university portal'],
  Finland: ['Studyinfo (Finland)'], Sweden: ['Universityadmissions.se (Sweden)'], Netherlands: ['Studielink (Netherlands)', 'Direct university portal'],
  China: ['CUCAS / China portal'], Spain: ['Direct university portal'], Ireland: ['Direct university portal'],
};
const LISTS: Record<string, string[]> = {
  lead_source: ['Instagram', 'Facebook', 'Website', 'Referral', 'Walk-in', 'Sub-agent', 'Other'],
  not_interested_reason: ['Budget', 'Chose other agent', 'Plans changed', 'Not eligible', 'No response', 'Other'],
  doc_rejection_reason: ['Unclear / blurred', 'Incomplete pages', 'Wrong document', 'Expired', 'Name mismatch', 'Other'],
  payment_mode: ['Bank transfer (NEFT/RTGS/IMPS)', 'International wire / Forex remittance', 'UPI', 'Card', 'Cheque', 'Cash', 'Education loan disbursement', 'Other'],
  currency: ['INR', 'EUR', 'CNY', 'USD'],
  board: ['CBSE', 'ICSE / ISC', 'State Board', 'IB', 'IGCSE', 'NIOS', 'Other'],
  test_type: ['IELTS Academic', 'IELTS General', 'TOEFL iBT', 'PTE Academic', 'Duolingo', 'Not taken yet', 'MOI (waiver)'],
  app_channel: ['Direct university portal', 'Uni-Assist', 'Campus France', 'Universitaly', 'Studyinfo (Finland)', 'Universityadmissions.se (Sweden)', 'Studielink (Netherlands)', 'CUCAS / China portal', 'Other'],
  visa_type: ['Long-stay student visa (D)', 'Residence permit', 'Other'],
  language: ['French', 'German', 'Italian', 'Spanish', 'Dutch', 'Other'],
  indian_state: ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
    'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'],
};
const DOC_TYPES: [string, string, string, Record<string, boolean>?][] = [
  ['10th marksheet & certificate', 'Yes', 'One PDF.'], ['12th marksheet & certificate', 'Yes', 'One PDF (or Diploma marksheets & certificate).'],
  ['All semester marksheets (merged into one PDF)', 'If Bachelor', 'All semesters merged into ONE PDF in order.'], ['Degree certificate / Provisional certificate', 'If Bachelor', ''],
  ["Master's marksheets and degree", 'If Master', ''], ['Passport', 'Yes', 'First and last page; full copy for visa.', { expiry: true }], ['CV', 'Yes', 'Europass format preferred for Europe.'],
  ['Work experience', 'If work exp', 'Experience letters, offer letter, salary slips merged.'], ['English test score (IELTS / TOEFL / PTE / Duolingo)', 'If taken', '', { expiry: true }],
  ['Statement of Purpose / Motivation letter', 'Yes', ''], ['Letters of Recommendation', 'Optional', 'Country / course specific'], ['APS certificate', 'Germany', 'Germany only'],
  ['Offer letter', 'System', 'Auto-filed from Application.'], ['Fee receipt', 'System', 'Auto-filed from Fees.'],
  ['Visa: Bank statement', 'Visa', '', { visa: true }], ['Visa: Blocked account confirmation', 'Visa', '', { visa: true }], ['Visa: Health / travel insurance', 'Visa', '', { visa: true, expiry: true }],
  ['Visa: Accommodation proof', 'Visa', '', { visa: true }], ['Visa: Cover letter', 'Visa', '', { visa: true }], ['Visa: Decision (visa copy / refusal letter)', 'Visa', '', { visa: true }],
  ['Others', 'No', 'Free type with title.'],
];
export const APP_STAGES: [string, string, string, string][] = [
  ['documents_pending', 'Documents pending', 'E05', '#94a3b8'], ['ready_to_apply', 'Ready to apply', 'E05', '#60a5fa'],
  ['applied', 'Applied', 'E05', '#3b82f6'], ['under_review', 'Under review', 'E05', '#6366f1'], ['interview', 'Interview', 'E06', '#8b5cf6'],
  ['conditional_offer', 'Conditional offer', 'E07', '#f59e0b'], ['unconditional_offer', 'Unconditional offer', 'E07', '#10b981'],
  ['rejected', 'Rejected', 'E08', '#ef4444'], ['offer_accepted', 'Offer accepted', 'E05', '#14b8a6'],
  ['tuition_paid', 'Tuition fee / deposit paid', 'E05', '#0ea5e9'], ['enrolment_confirmed', 'Enrolment confirmed', 'E05', '#16a34a'],
  ['withdrawn', 'Withdrawn', 'E05', '#64748b'], ['offer_declined', 'Offer declined by student', 'E05', '#94a3b8'],
];
export const VISA_STAGES: [string, string, string, string][] = [
  ['docs_preparation', 'Visa document preparation', 'E14', '#94a3b8'], ['appointment_booked', 'Appointment booked', 'E15', '#6366f1'],
  ['approved', 'Visa approved', 'E16', '#16a34a'], ['rejected', 'Visa declined', 'E17', '#ef4444'],
];

let ensured: Promise<void> | null = null;
/** Idempotent: inserts only what is missing, never overwrites an Admin's edits. */
export function ensureMasters() {
  ensured ??= (async () => {
    for (const [i, [name, code, currency, aps]] of COUNTRIES.entries()) {
      await Country.updateOne({ name }, { $setOnInsert: { name, code, currency, aps_required: aps, channels: CHANNELS[name] ?? [], sort: i } }, { upsert: true });
    }
    const y = new Date().getFullYear();
    for (let yy = y; yy <= y + 3; yy++) {
      for (const [m, label] of [[1, 'Jan'], [2, 'Feb'], [9, 'Sep']] as const) {
        await Intake.updateOne({ name: `${label} ${yy}` }, { $setOnInsert: { name: `${label} ${yy}`, month: m, year: yy } }, { upsert: true });
      }
    }
    const lists: [string, string, number, Record<string, unknown>?, string?][] = [];
    for (const [type, names] of Object.entries(LISTS)) names.forEach((n, i) => lists.push([type, n, i]));
    DOC_TYPES.forEach(([n, rule, notes, flags], i) => lists.push(['document_type', n, i, { rule, notes, ...flags }]));
    APP_STAGES.forEach(([code, n, trigger, color], i) => lists.push(['app_stage', n, i + 1, { trigger, color }, code]));
    VISA_STAGES.forEach(([code, n, trigger, color], i) => lists.push(['visa_stage', n, i + 1, { trigger, color }, code]));
    for (const [type, name, sort, data, code] of lists) {
      await MasterItem.updateOne({ type, name }, { $setOnInsert: { type, name, sort, data, code } }, { upsert: true });
    }
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

/** The client's stage list shape: { code, name, sort, trigger, color }. */
export async function stageList(type: 'app_stage' | 'visa_stage') {
  const rows = await MasterItem.find({ type }).sort({ sort: 1 }).lean();
  return rows.map((r) => ({ code: r.code, name: r.name, sort: r.sort, ...(r.data ?? {}) }));
}
