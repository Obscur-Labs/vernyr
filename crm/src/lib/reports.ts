import type { Facet } from '@/types';

/**
 * The reports API's answer shapes, and the colours the CRM gives a status
 * wherever it is charted.
 *
 * A status keeps one hue across the dashboard, the reports section and the
 * boards, so "closed won" is the same green in every view. The values are CSS
 * custom properties, which is what makes them survive a light/dark flip.
 */

/* ── Response shapes ─────────────────────────────────────────────────────── */

export interface OverviewReport {
  totals: {
    leads: number;
    students: number;
    applications: number;
    visas: number;
    converted: number;
    conversionRate: number;
    revenuePaid: number;
    revenuePending: number;
    revenueOverdue: number;
  };
  months: string[];
  series: { leads: number[]; students: number[]; applications: number[]; revenue: number[] };
  leadsByStatus: Facet[];
  studentsByStage: Facet[];
  applicationsByStatus: Facet[];
}

export interface FinanceReport {
  months: string[];
  byStatus: (Facet & { records: number })[];
  byType: Facet[];
  byCurrency: Facet[];
  series: { revenue: number[]; billed: number[] };
  ageing: (Facet & { records: number })[];
  topOutstanding: {
    _id: string;
    student: string;
    description: string;
    amount: number;
    currency: string;
    status: string;
    dueDate?: string;
  }[];
}

export interface StudentsReport {
  months: string[];
  byStage: Facet[];
  series: { newStudents: number[] };
  byCounsellor: Facet[];
  byNationality: Facet[];
  byPreferredCountry: Facet[];
  byIntake: Facet[];
  ieltsBands: Facet[];
}

export interface ApplicationsReport {
  months: string[];
  byStatus: Facet[];
  byCountry: Facet[];
  byUniversity: Facet[];
  byLevel: Facet[];
  byIntake: Facet[];
  series: { submitted: number[]; offers: number[] };
  offerRate: number;
}

export interface VisasReport {
  months: string[];
  byStage: Facet[];
  byCountry: Facet[];
  series: { filed: number[]; approved: number[]; rejected: number[] };
  approvalRate: number;
}

export interface LeadsReport {
  months: string[];
  byStatus: Facet[];
  bySource: Facet[];
  byCountry: Facet[];
  byOwner: Facet[];
  series: { created: number[]; converted: number[] };
  conversionRate: number;
}

export interface CatalogueReport {
  totals: { courses: number; universities: number; countries: number };
  byLevel: Facet[];
  byCountry: Facet[];
  byUniversity: Facet[];
  byIntake: Facet[];
  tuitionBands: Facet[];
}

/* ── Status colours ──────────────────────────────────────────────────────── */

export const LEAD_STATUS_COLORS: Record<string, string> = {
  new: 'var(--chart-1)',
  contacted: 'var(--chart-3)',
  counselling: 'var(--chart-7)',
  interested: 'var(--chart-4)',
  application_started: 'var(--chart-8)',
  closed_won: 'var(--chart-2)',
  closed_lost: 'var(--chart-10)',
};

export const APP_STATUS_COLORS: Record<string, string> = {
  drafting: 'var(--chart-1)',
  submitted: 'var(--chart-3)',
  offer_received: 'var(--chart-2)',
  conditional_offer: 'var(--chart-4)',
  accepted: 'var(--chart-9)',
  rejected: 'var(--chart-10)',
  withdrawn: 'var(--chart-5)',
  deferred: 'var(--chart-8)',
};

export const VISA_STAGE_COLORS: Record<string, string> = {
  not_started: 'var(--chart-1)',
  documents_complete: 'var(--chart-3)',
  visa_filed: 'var(--chart-6)',
  biometrics: 'var(--chart-7)',
  interview: 'var(--chart-4)',
  decision: 'var(--chart-8)',
  approved: 'var(--chart-2)',
  rejected: 'var(--chart-10)',
  reapplied: 'var(--chart-5)',
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  paid: 'var(--chart-2)',
  pending: 'var(--chart-4)',
  overdue: 'var(--chart-10)',
  refunded: 'var(--chart-7)',
  waived: 'var(--chart-3)',
};

export const LEVEL_COLORS: Record<string, string> = {
  foundation: 'var(--chart-6)',
  diploma: 'var(--chart-3)',
  bachelors: 'var(--chart-1)',
  masters: 'var(--chart-2)',
  mba: 'var(--chart-4)',
  phd: 'var(--chart-7)',
  other: 'var(--chart-12)',
};

/** The journey's own order, and the ramp that reads as progress along it. */
export const STAGE_ORDER = [
  'inquiry', 'counselling', 'university_selection', 'application_submitted',
  'offer_letter', 'fee_payment', 'cas_i20', 'visa_filing', 'visa_approved', 'departure',
] as const;

export const STAGE_LABELS: Record<string, string> = {
  inquiry: 'Inquiry',
  counselling: 'Counselling',
  university_selection: 'Uni selection',
  application_submitted: 'Applied',
  offer_letter: 'Offer',
  fee_payment: 'Fee paid',
  cas_i20: 'CAS / I-20',
  visa_filing: 'Visa filed',
  visa_approved: 'Visa approved',
  departure: 'Departed',
};

export const LEAD_STATUS_ORDER = [
  'new', 'contacted', 'counselling', 'interested',
  'application_started', 'closed_won', 'closed_lost',
] as const;

/**
 * Turns an unordered `{ value, count }` list into the pipeline's own order,
 * colours included — the API groups, but a funnel has to keep its sequence.
 */
export function orderedBuckets(
  rows: Facet[] | undefined,
  order: readonly string[],
  colors?: Record<string, string>,
  labels?: Record<string, string>,
): { value: string; count: number; color?: string }[] {
  const found = new Map((rows ?? []).map((r) => [r.value, r.count]));
  const known = order.map((key) => ({
    value: labels?.[key] ?? key,
    count: found.get(key) ?? 0,
    color: colors?.[key],
  }));
  // Anything the server knows about that the order does not — a status added
  // to the enum without being added here — still gets drawn rather than lost.
  const extra = (rows ?? [])
    .filter((r) => !order.includes(r.value))
    .map((r) => ({ value: r.value, count: r.count, color: colors?.[r.value] }));
  return [...known, ...extra];
}

/** Adds a colour to each row of an already-ordered list. */
export const colorize = (rows: Facet[] | undefined, colors: Record<string, string>) =>
  (rows ?? []).map((r) => ({ ...r, color: colors[r.value] }));

export const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(n);
