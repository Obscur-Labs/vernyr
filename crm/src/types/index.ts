export type UserRole = 'admin' | 'counsellor' | 'student' | 'university';

export type StudentStage = 'inquiry' | 'counselling' | 'university_selection' | 'application_submitted' | 'offer_letter' | 'fee_payment' | 'cas_i20' | 'visa_filing' | 'visa_approved' | 'departure';

export type LeadStatus = 'new' | 'contacted' | 'counselling' | 'interested' | 'application_started' | 'closed_won' | 'closed_lost';

export type DocType = 'passport' | 'marksheet_10' | 'marksheet_12' | 'ielts' | 'toefl' | 'gre' | 'gmat' | 'sop' | 'lor' | 'bank_statement' | 'photo' | 'offer_letter' | 'visa_copy' | 'other';
export type DocStatus = 'uploaded' | 'under_review' | 'approved' | 'rejected';
export type AppStatus = 'drafting' | 'submitted' | 'offer_received' | 'conditional_offer' | 'accepted' | 'rejected' | 'withdrawn' | 'deferred';
export type VisaStage = 'not_started' | 'documents_complete' | 'visa_filed' | 'biometrics' | 'interview' | 'decision' | 'approved' | 'rejected' | 'reapplied';
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'waived';
export type PaymentType = 'application_fee' | 'university_fee' | 'visa_fee' | 'service_fee' | 'courier_fee' | 'other';

export interface User {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  universityName?: string;
  isActive: boolean;
  createdAt: string;
  /* ── Access ────────────────────────────────────────────────────────────
     `presetKey` may be absent on accounts that predate the access system;
     the server resolves those through `role` and reports it back here with
     `presetInherited` set, so the UI can say the seat was never chosen. */
  presetKey?: string;
  presetName?: string;
  presetInherited?: boolean;
  hasOverrides?: boolean;
  permissions?: PermissionMap;
}

/* ── Access control ────────────────────────────────────────────────────── */

export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/** `{ students: { read: true, update: true } }` — an absent verb means "no". */
export type PermissionMap = Record<string, Partial<Record<Action, boolean>>>;

export interface ModuleDef {
  key: string;
  label: string;
  group: 'Pipeline' | 'Casework' | 'Money' | 'Communication' | 'Administration';
  description: string;
  actions: Action[];
  actionLabels?: Partial<Record<Action, string>>;
}

export interface Preset {
  key: string;
  name: string;
  description: string;
  fullAccess: boolean;
  permissions: PermissionMap;
  isSystem: boolean;
  scope: 'staff' | 'portal';
  memberCount?: number;
}

export interface PortalAccount {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  role: 'student' | 'university';
  studentId?: { _id: string; personal?: { name?: string }; stage?: StudentStage } | string | null;
  universityName?: string;
  isActive: boolean;
  lastSeenAt?: string;
  createdAt: string;
  presetKey?: string;
  presetName?: string;
  presetInherited?: boolean;
  hasOverrides?: boolean;
  permissions?: PermissionMap;
}

/** What the signed-in caller may do — returned by login and /access/me. */
export interface AccessSnapshot {
  presetKey: string;
  presetName: string;
  fullAccess: boolean;
  hasOverrides?: boolean;
  permissions: PermissionMap;
}

export interface Lead {
  _id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: LeadStatus;
  assignedTo?: User | null;
  intendedCountry?: string;
  intendedCourse?: string;
  intakeYear?: number;
  intakeSemester?: string;
  notes?: string;
  budget?: number;
  score?: string;
  convertedStudentId?: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageType = 'text' | 'file' | 'document_request' | 'form_request' | 'form_response' | 'system';

export type DocRequestStatus = 'pending' | 'fulfilled' | 'cancelled';

export interface DocRequestItem {
  requestId: string;
  type: DocType;
  label?: string;
  note?: string;
  status: DocRequestStatus;
}

export interface FormField  { id: string; label: string; required?: boolean; }
export interface FormAnswer { id: string; label: string; value: string; }

export interface MessageMeta {
  /* document_request */
  items?: DocRequestItem[];
  /* form_request */
  title?: string;
  fields?: FormField[];
  answered?: boolean;
  responseId?: string;
  /* form_response */
  formMessageId?: string;
  answers?: FormAnswer[];
}

export interface Message {
  _id: string;
  conversationId: string;
  senderId: string | { _id: string; name: string; avatar?: string };
  senderName: string;
  type: MessageType;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  meta?: MessageMeta;
  replyTo?: { messageId: string; senderName: string; preview: string };
  readBy: string[];
  createdAt: string;
}

export interface DocumentRequest {
  _id: string;
  studentId: string;
  requestedBy: { _id: string; name: string; role?: UserRole } | string;
  type: DocType;
  label?: string;
  note?: string;
  status: DocRequestStatus;
  documentId?: { _id: string; status: DocStatus; currentVersion?: { fileUrl: string; fileName: string } } | string;
  fulfilledAt?: string;
  createdAt: string;
}

export interface ConversationParticipant {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export interface Conversation {
  _id: string;
  participants: ConversationParticipant[];
  studentId?: { _id: string; personal: { name: string } };
  /** Closed after counsellor reassignment — history readable, sending blocked */
  archived?: boolean;
  lastMessage?: { text: string; senderId: string; createdAt: string };
  updatedAt: string;
  createdAt: string;
}

export interface Student {
  _id: string;
  userId?: string;
  assignedCounsellor?: User | null;
  stage: StudentStage;
  personal: {
    name: string; email?: string; phone: string;
    dob?: string; gender?: string; nationality?: string; address?: string;
  };
  education: {
    highestLevel?: string; board10?: string; percentage10?: number;
    board12?: string; percentage12?: number;
    graduationCollege?: string; graduationScore?: number;
  };
  scores: { ielts?: number; toefl?: number; gre?: number; gmat?: number; sat?: number; };
  passport: { number?: string; expiry?: string; issued?: string; };
  preferences: { countries: string[]; universities: string[]; courses: string[]; intake?: string; };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  _id: string;
  studentId: string;
  type: DocType;
  label?: string;
  status: DocStatus;
  currentVersion: { fileUrl: string; fileName: string; uploadedAt: string; };
  versions: { fileUrl: string; fileName: string; uploadedAt: string; }[];
  reviewedBy?: User;
  rejectionReason?: string;
  notes?: string;
  createdAt: string;
}

export interface Application {
  _id: string;
  studentId: string;
  university: string;
  country: string;
  course: string;
  level: string;
  intake: string;
  status: AppStatus;
  appliedDate?: string;
  offerDate?: string;
  deadline?: string;
  tuitionFee?: number;
  currency?: string;
  notes?: string;
  createdAt: string;
}

export interface Visa {
  _id: string;
  studentId: string;
  country: string;
  visaType: string;
  stage: VisaStage;
  filedDate?: string;
  biometricsDate?: string;
  interviewDate?: string;
  approvalDate?: string;
  refusalReason?: string;
  notes?: string;
  createdAt: string;
}

export interface Payment {
  _id: string;
  studentId: string;
  type: PaymentType;
  description: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate?: string;
  paidDate?: string;
  receiptUrl?: string;
  invoiceNumber?: string;
  notes?: string;
  createdAt: string;
}

export interface Notification {
  _id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  link?: string;
  createdAt: string;
}

export interface DashboardStats {
  totalLeads: number;
  totalStudents: number;
  totalApplications: number;
  visaApprovals: number;
  pendingPaymentsTotal: number;
  leadsByStatus: Record<LeadStatus, number>;
  studentsByStage: Record<StudentStage, number>;
}
