'use strict';
// Phase 3 (University Portal) data model additions (University doc Section 15). Same database, new tables / columns. Safe on every start.
const { db, addColumns } = require('../db');

const STD = `organisation_id INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), created_by TEXT,
  created_by_type TEXT DEFAULT 'staff', updated_at TEXT, updated_by TEXT, updated_by_type TEXT, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, deleted_by TEXT, delete_reason TEXT`;

db.exec(`
CREATE TABLE IF NOT EXISTS uni_users (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, designation TEXT,
  role TEXT NOT NULL DEFAULT 'officer', finance INTEGER DEFAULT 0, campuses_json TEXT, department TEXT, alerts_json TEXT, status TEXT NOT NULL DEFAULT 'Invited',
  password_hash TEXT, pw_history_json TEXT, totp_secret_enc TEXT, twofa_method TEXT, twofa_ready INTEGER DEFAULT 0, backup_codes_json TEXT, twofa_failed INTEGER DEFAULT 0, twofa_locked_until TEXT,
  invite_token_hash TEXT, invite_expires_at TEXT, invite_day TEXT, invite_count INTEGER DEFAULT 0, locked_until TEXT, last_login_at TEXT, is_main_contact INTEGER DEFAULT 0, ${STD});
CREATE INDEX IF NOT EXISTS ix_uu_uni ON uni_users(university_id);
CREATE TABLE IF NOT EXISTS uni_sessions (id TEXT PRIMARY KEY, uni_user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, twofa_done INTEGER DEFAULT 0, preview_by TEXT,
  created_at TEXT, last_seen_at TEXT, expires_at TEXT, revoked INTEGER DEFAULT 0, ip TEXT, user_agent TEXT);
CREATE TABLE IF NOT EXISTS uni_codes (id TEXT PRIMARY KEY, uni_user_id TEXT, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER DEFAULT 0, expires_at TEXT, used INTEGER DEFAULT 0,
  last_sent_at TEXT, payload_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS uni_trusted_devices (id TEXT PRIMARY KEY, uni_user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS uni_login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ident TEXT, success INTEGER, ip TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS uni_consents (id TEXT PRIMARY KEY, uni_user_id TEXT NOT NULL, university_id TEXT, doc_type TEXT NOT NULL, version TEXT, doc_hash TEXT, ip TEXT, user_agent TEXT, created_at TEXT);
CREATE TRIGGER IF NOT EXISTS uni_consent_no_update BEFORE UPDATE ON uni_consents BEGIN SELECT RAISE(ABORT, 'consent records are append-only'); END;
CREATE TABLE IF NOT EXISTS uni_notifications (id TEXT PRIMARY KEY, uni_user_id TEXT NOT NULL, title TEXT NOT NULL, link TEXT, is_read INTEGER DEFAULT 0, created_at TEXT);
CREATE INDEX IF NOT EXISTS ix_un_user ON uni_notifications(uni_user_id, is_read);

CREATE TABLE IF NOT EXISTS partner_agreements (id TEXT PRIMARY KEY, agreement_code TEXT UNIQUE, university_id TEXT NOT NULL, title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  auto_renew INTEGER DEFAULT 0, notice_days INTEGER, signed_by_le TEXT, signed_by_uni TEXT, signed_on TEXT, territory_json TEXT, scope_text TEXT, commission_terms TEXT,
  payment_terms_days INTEGER, invoice_currency TEXT, file_key TEXT, file_versions_json TEXT, show_to_uni INTEGER DEFAULT 1, status TEXT DEFAULT 'Draft', terminate_reason TEXT,
  internal_note TEXT, reminders_json TEXT, ${STD});
CREATE TABLE IF NOT EXISTS campuses (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, name TEXT NOT NULL, city TEXT NOT NULL, address TEXT, map_link TEXT, is_main INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Active', ${STD});
CREATE TABLE IF NOT EXISTS uni_contacts (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, department TEXT NOT NULL, name TEXT NOT NULL, designation TEXT, email TEXT NOT NULL, phone TEXT,
  is_primary INTEGER DEFAULT 0, uni_user_id TEXT, ${STD});
CREATE TABLE IF NOT EXISTS uni_profile_requests (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, payload_json TEXT NOT NULL, old_json TEXT, status TEXT DEFAULT 'Pending', requested_by TEXT,
  review_note TEXT, reviewed_by TEXT, reviewed_at TEXT, final_json TEXT, ${STD});
CREATE TABLE IF NOT EXISTS course_change_requests (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, course_id TEXT, scholarship_id TEXT, entity TEXT DEFAULT 'course', change_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, old_json TEXT, status TEXT DEFAULT 'Pending approval', urgent INTEGER DEFAULT 0, urgent_reason TEXT, batch_id TEXT, requested_by TEXT, reviewed_by TEXT, reviewed_at TEXT,
  review_note TEXT, auto_approved INTEGER DEFAULT 0, warnings_json TEXT, final_json TEXT, ${STD});
CREATE TABLE IF NOT EXISTS uni_import_batches (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, file_name TEXT, counts_json TEXT, errors_json TEXT, status TEXT DEFAULT 'Submitted', created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS scholarships (id TEXT PRIMARY KEY, code TEXT, university_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, benefit_type TEXT, amount REAL, currency TEXT, percent REAL,
  min_percent REAL, other_criteria TEXT, applies_json TEXT, deadline TEXT, how_apply TEXT, link TEXT, status TEXT DEFAULT 'Draft', valid_until TEXT, ${STD});

CREATE TABLE IF NOT EXISTS university_applications (id TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE, university_id TEXT NOT NULL, campus_id TEXT, status TEXT NOT NULL DEFAULT 'New',
  review_status TEXT, status_changed_at TEXT, submitted_at TEXT, submitted_by TEXT, cover_note TEXT, consent_id TEXT, shared_fields_json TEXT, university_ref TEXT, expected_decision TEXT,
  version INTEGER DEFAULT 1, flag_docs_requested INTEGER DEFAULT 0, flag_waitlisted INTEGER DEFAULT 0, first_decision_at TEXT, reject_reason TEXT, enrol_date TEXT, student_uni_id TEXT,
  programme_start TEXT, final_tuition REAL, final_currency TEXT, scholarship_amount REAL, deposit_amount REAL, deposit_currency TEXT, deposit_date TEXT, withdrawn_at TEXT,
  withdraw_reason_uni TEXT, email_thread_root_id TEXT, email_refs_json TEXT, last_e33_at TEXT, ${STD});
CREATE INDEX IF NOT EXISTS ix_ua_uni ON university_applications(university_id, status);
CREATE TABLE IF NOT EXISTS uni_actions (id TEXT PRIMARY KEY, uapp_id TEXT NOT NULL, university_id TEXT NOT NULL, application_id TEXT NOT NULL, type TEXT NOT NULL, data_json TEXT,
  from_status TEXT, to_status TEXT, by_uni_user_id TEXT, by_staff_id TEXT, processing TEXT DEFAULT 'Pending review', held_note TEXT, processed_by TEXT, processed_at TEXT, forced_review INTEGER DEFAULT 0,
  reminded_at TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS ix_uact ON uni_actions(uapp_id, processing);
CREATE TABLE IF NOT EXISTS uni_doc_requests (id TEXT PRIMARY KEY, uapp_id TEXT NOT NULL, university_id TEXT NOT NULL, message TEXT, needed_by TEXT, pause INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Open', prev_status TEXT, cancel_reason TEXT, created_by TEXT, created_at TEXT, answered_at TEXT, opened_by_uni_at TEXT);
CREATE TABLE IF NOT EXISTS uni_doc_request_items (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, document_type_id TEXT, title TEXT, note TEXT, status TEXT DEFAULT 'Open', reply TEXT, share_id TEXT);
CREATE TABLE IF NOT EXISTS uni_doc_shares (id TEXT PRIMARY KEY, uapp_id TEXT NOT NULL, university_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL, shared_by TEXT, shared_at TEXT,
  status TEXT DEFAULT 'Shared', revoked_reason TEXT, revoked_at TEXT, viewed_at TEXT, downloaded_at TEXT, access_expires_at TEXT);
CREATE INDEX IF NOT EXISTS ix_uds ON uni_doc_shares(uapp_id, status);
CREATE TABLE IF NOT EXISTS doc_access_log (id TEXT PRIMARY KEY, uni_user_id TEXT, university_id TEXT, uapp_id TEXT, document_id TEXT, version_id TEXT, action TEXT, ip TEXT, user_agent TEXT, at TEXT);
CREATE TRIGGER IF NOT EXISTS dal_no_update BEFORE UPDATE ON doc_access_log BEGIN SELECT RAISE(ABORT, 'access log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS dal_no_delete BEFORE DELETE ON doc_access_log BEGIN SELECT RAISE(ABORT, 'access log is append-only'); END;
CREATE TABLE IF NOT EXISTS uni_messages (id TEXT PRIMARY KEY, uapp_id TEXT, university_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_uni_user_id TEXT, sender_user_id TEXT, body TEXT,
  original_body TEXT, context_type TEXT, context_id TEXT, edited_at TEXT, deleted_at TEXT, sent_at TEXT, seen_by_uni_at TEXT, seen_by_le_at TEXT, contact_warning INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_um ON uni_messages(university_id, uapp_id);
CREATE TABLE IF NOT EXISTS uni_message_attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, file_key TEXT NOT NULL, original_name TEXT, mime_type TEXT, size_bytes INTEGER, saved_document_id TEXT);
CREATE TABLE IF NOT EXISTS uni_announcements (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, related_json TEXT, important INTEGER DEFAULT 0,
  valid_until TEXT, attachments_json TEXT, status TEXT DEFAULT 'Posted', published_at TEXT, published_by TEXT, published_scope TEXT, handled_by TEXT, handled_at TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS uni_notices (id TEXT PRIMARY KEY, university_id TEXT, title TEXT NOT NULL, body TEXT, active_until TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS offer_letters (id TEXT PRIMARY KEY, uapp_id TEXT NOT NULL, application_id TEXT NOT NULL, type TEXT, document_id TEXT, version_id TEXT, issue_date TEXT, conditions_text TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS share_consent_requests (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, university_id TEXT NOT NULL, application_id TEXT, status TEXT DEFAULT 'Requested', requested_by TEXT,
  requested_at TEXT, answered_at TEXT, method TEXT, document_id TEXT, reason TEXT);

CREATE TABLE IF NOT EXISTS commission_rules (id TEXT PRIMARY KEY, rule_code TEXT, university_id TEXT NOT NULL, agreement_id TEXT, name TEXT NOT NULL, scope TEXT DEFAULT 'all', scope_json TEXT,
  intakes_json TEXT, valid_from TEXT, valid_to TEXT, basis TEXT NOT NULL, rate REAL, fixed_amount REAL, fixed_currency TEXT, due_event TEXT DEFAULT 'enrolled', due_days INTEGER,
  slabs_json TEXT, min_amount REAL, max_amount REAL, cap_currency TEXT, show_to_uni INTEGER DEFAULT 1, status TEXT DEFAULT 'Active', internal_note TEXT, ${STD});
CREATE TABLE IF NOT EXISTS commissions (id TEXT PRIMARY KEY, commission_code TEXT, university_id TEXT NOT NULL, uapp_id TEXT NOT NULL, application_id TEXT, rule_id TEXT, basis_amount REAL, basis_currency TEXT,
  rate REAL, fixed_amount REAL, amount REAL, currency TEXT, fx_rate REAL, fx_date TEXT, invoice_amount REAL, invoice_currency TEXT, status TEXT DEFAULT 'Expected', due_date TEXT, invoice_id TEXT,
  cancel_reason TEXT, recalculated INTEGER DEFAULT 0, internal_note TEXT, ${STD});
CREATE TABLE IF NOT EXISTS commission_invoices (id TEXT PRIMARY KEY, invoice_no TEXT UNIQUE, kind TEXT DEFAULT 'invoice', credit_for TEXT, university_id TEXT NOT NULL, agreement_id TEXT,
  invoice_date TEXT, due_date TEXT, currency TEXT, subtotal REAL, tax_json TEXT, total REAL, paid REAL DEFAULT 0, bill_to_json TEXT, notes TEXT, status TEXT DEFAULT 'Draft', pdf_key TEXT,
  query_open INTEGER DEFAULT 0, reminders_paused INTEGER DEFAULT 0, last_reminder_at TEXT, cancel_reason TEXT, email_thread_root_id TEXT, email_refs_json TEXT, issued_at TEXT, issued_by TEXT, ${STD});
CREATE TABLE IF NOT EXISTS commission_payments (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, university_id TEXT NOT NULL, amount REAL NOT NULL, currency TEXT, payment_date TEXT, reference TEXT,
  proof_key TEXT, proof_name TEXT, note TEXT, status TEXT DEFAULT 'Submitted', confirmed_amount REAL, reject_reason TEXT, submitted_by TEXT, reviewed_by TEXT, reviewed_at TEXT, source TEXT DEFAULT 'university', created_at TEXT);
CREATE TABLE IF NOT EXISTS invoice_queries (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, university_id TEXT NOT NULL, commission_id TEXT, status TEXT DEFAULT 'Open', created_by TEXT, created_at TEXT, closed_at TEXT, closed_by TEXT);
CREATE TABLE IF NOT EXISTS invoice_query_messages (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, sender_type TEXT, sender_id TEXT, body TEXT, sent_at TEXT);
`);

addColumns('universities', ['short_name TEXT', 'logo_key TEXT', 'logo_updated_at TEXT', 'portal_status TEXT', 'account_code TEXT', 'display_name TEXT', 'partner_manager_id TEXT', "notify_mode TEXT DEFAULT 'review'", 'share_contact INTEGER DEFAULT 0',
  'share_passport INTEGER DEFAULT 0', 'share_visa INTEGER DEFAULT 0', 'viewer_docs INTEGER DEFAULT 0', 'officers_propose INTEGER DEFAULT 1', 'max_users INTEGER DEFAULT 10',
  "doc_access_rule TEXT DEFAULT 'enrolment'", 'doc_access_months INTEGER', 'uni_internal_note TEXT', 'partner_thread_root_id TEXT', 'partner_refs_json TEXT', 'about TEXT', 'uni_type TEXT',
  'intl_page TEXT', 'founded_year INTEGER', 'students_count INTEGER', 'languages_json TEXT', 'rankings_json TEXT', 'accreditations_json TEXT', 'social_json TEXT', 'cover_key TEXT',
  'watermark INTEGER DEFAULT 1', 'zip_download INTEGER DEFAULT 1', 'enrol_from_accepted INTEGER DEFAULT 0', 'ip_allowlist TEXT', 'show_expected_commission INTEGER DEFAULT 0',
  'viewer_exports INTEGER DEFAULT 1', 'suspend_reason TEXT', 'legal_name TEXT', 'billing_address TEXT', 'vat_id TEXT', 'timezone TEXT', 'override_reason TEXT', 'transfer_blocked INTEGER DEFAULT 0']);
// the Phase 1 placeholder table "commissions" already exists: extend it with the Phase 3 columns
addColumns('commissions', ['commission_code TEXT', 'uapp_id TEXT', 'rule_id TEXT', 'basis_amount REAL', 'basis_currency TEXT', 'rate REAL', 'fixed_amount REAL', 'fx_rate REAL', 'fx_date TEXT', 'invoice_amount REAL',
  'invoice_currency TEXT', 'due_date TEXT', 'invoice_id TEXT', 'cancel_reason TEXT', 'recalculated INTEGER DEFAULT 0', 'internal_note TEXT']);
addColumns('courses', ['campus_id TEXT', 'university_course_code TEXT', "uni_status TEXT DEFAULT 'Active'", 'seats_for_le INTEGER', 'note_for_le TEXT', 'change_source TEXT']);
addColumns('course_intakes', ["status TEXT DEFAULT 'Open'", 'closed_reason TEXT']);
addColumns('course_academic_requirements', ['academic_note TEXT', 'min_12th_english_percent REAL']);
addColumns('application_stage_history', ['source TEXT', 'uni_action_id TEXT']);
addColumns('applications', ['uni_flag TEXT']);
addColumns('email_logs', ["recipient_type TEXT DEFAULT 'student'", 'university_id TEXT', 'uapp_id TEXT', 'invoice_id TEXT', 'thread_kind TEXT']);
addColumns('audit_log', ['university_id TEXT']);
addColumns('consent_records', ['university_id TEXT', 'application_id TEXT']);
addColumns('countries', ['transfers_allowed INTEGER DEFAULT 1']);

module.exports = { STD };
