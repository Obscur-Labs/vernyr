export type StudentStage =
  | 'inquiry'
  | 'counselling'
  | 'university_selection'
  | 'application_submitted'
  | 'offer_letter'
  | 'fee_payment'
  | 'cas_i20'
  | 'visa_filing'
  | 'visa_approved'
  | 'departure';

export type DocType =
  | 'passport' | 'marksheet_10' | 'marksheet_12' | 'ielts' | 'toefl'
  | 'gre' | 'gmat' | 'sop' | 'lor' | 'bank_statement' | 'photo'
  | 'offer_letter' | 'visa_copy' | 'other';
export type DocStatus = 'uploaded' | 'under_review' | 'approved' | 'rejected';

export type AppStatus =
  | 'drafting' | 'submitted' | 'offer_received' | 'conditional_offer'
  | 'accepted' | 'rejected' | 'withdrawn' | 'deferred';

export type VisaStage =
  | 'not_started' | 'documents_complete' | 'visa_filed' | 'biometrics'
  | 'interview' | 'decision' | 'approved' | 'rejected' | 'reapplied';

export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'waived';
export type PaymentType =
  | 'application_fee' | 'university_fee' | 'visa_fee' | 'service_fee' | 'courier_fee' | 'other';

export interface StudentUser {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  role: 'student';
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Counsellor {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  phone?: string;
}

export interface Student {
  _id: string;
  userId?: string;
  assignedCounsellor?: Counsellor | null;
  stage: StudentStage;
  personal: {
    name: string; email?: string; phone: string;
    dob?: string; gender?: string; nationality?: string; address?: string;
  };
  /* These sub-objects can be absent on records created via self-registration
     or lead conversion — always access them defensively. */
  education?: {
    highestLevel?: string; board10?: string; percentage10?: number;
    board12?: string; percentage12?: number;
    graduationCollege?: string; graduationScore?: number;
  };
  scores?: { ielts?: number; toefl?: number; gre?: number; gmat?: number; sat?: number; };
  passport?: { number?: string; expiry?: string; issued?: string; };
  preferences?: { countries?: string[]; universities?: string[]; courses?: string[]; intake?: string; };
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
  reviewedBy?: { name: string };
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
  senderId: string;
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
  requestedBy: { _id: string; name: string } | string;
  type: DocType;
  label?: string;
  note?: string;
  status: DocRequestStatus;
  documentId?: string | { _id: string };
  fulfilledAt?: string;
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
