# Porting plan: client build (legacy/) into the monorepo

`legacy/` is the client's final build and the feature spec. The monorepo (from the dump) is the stack:
Next.js 16 + TypeScript + Express + MongoDB (Mongoose) + Cloudinary + Socket.IO.
Rule: where the two disagree on **behaviour**, legacy wins. Where they disagree on **plumbing**, the monorepo wins.
UI: the client's look is kept (user decision, 25 Nov 2026). Their CSS is copied into each app as `src/styles/le-ui.css`, every rule scoped under `.le-ui`, so a ported screen wears it while the rest of the app is untouched until its turn.

## Decisions already taken

| Topic | Legacy | Monorepo | Kept |
|---|---|---|---|
| Database | SQLite, 164 tables | MongoDB | MongoDB, one database `vernyr` (local and live) |
| Files | AES-encrypted local disk | Cloudinary, 5-minute signed links | Cloudinary (Render has no persistent disk) |
| Chat | 15 s polling | Socket.IO, replies, pins, reactions | Socket.IO |
| Login transport | Cookie session + CSRF | JWT bearer | JWT (apps and API are on different subdomains) |
| Course import | Excel upload per university in the UI | Importer script + parsers (`services/catalogue.ts`) | Monorepo parsers, plus legacy's upload screen |
| Partner portal | Plain JS MVP | none | On hold, MVP kept in `partner/mvp-reference/` |
| Staff login | Username; Super Admin by email + Google Authenticator | Admin by email | Username for every staff role, Admins included (user decision) |

## Behaviour conflicts (legacy wins unless the user says otherwise)

1. **Who sees a student.** Legacy: one counsellor owns a student from first contact to visa; a Manager sees all.
   Monorepo: every counsellor sees every student (shared book, `Student.counsellors[]`).
2. **Visa.** Legacy: one Applications & Visa flow per application (Visa document preparation, Appointment booked, Approved / Declined).
   Monorepo: a separate `Visa` record with its own stages.
3. **Roles.** Legacy: Counsellor, Manager, Admin, Finance, Super Admin (above Admin, hidden from Admins), role builder with data scope own / team / branch / all.
   Monorepo: presets + modules (`config/presets.ts`): admin, counsellor, student, university. The preset system stays; legacy's roles become presets and data scope is added.
4. **Login rules.** Legacy: staff sign in with a username, the Super Admin with email + Google Authenticator in production; email code on the first login only; forgot password by 6-digit email code; lockout after wrong passwords; idle timeout; new-device email.
   Monorepo: username / email + password only.

## Phases

Each phase ends with typecheck, build, `npm run test:security` and new tests for what it adds.

| # | Phase | From legacy | Status |
|---|---|---|---|
| 0 | Foundation | repo, branch, backups, empty database, secrets, database `vernyr`, deploy kit, `portal/` + `partner/` | done |
| 1a | Sign-in (client UI) | CRM login + first-login code + forgot by code; portal login (email or mobile), sign-up with email code, guardian consent, forgot; lockout 5 / 15 min; 12 h or 7 day sessions; reset signs out every session; legal pages at portal `/legal/*` | done |
| 1b | Accounts and access | roles above as presets, Super Admin, data scope, one-counsellor rule, idle timeout, new-device email, audit log, settings registry | next |
| 2 | Email engine | nodemailer queue with retries, templates E01 to E49, one thread per student, hard CC `laeuropaapplication@gmail.com`, placeholder whitelist, security emails without CC | done |
| 3 | Student lifecycle | leads, conversion, Applications & Visa flow, document checklists per country / level, versions, PDF merge, tasks, comments, appointments, walk-in QR / info form | |
| 4 | Money | service packages + instalments, discounts with approval, refunds, GST invoices (CGST + SGST in Gujarat, IGST elsewhere, FY number series), payment proof with UTR, receipts, UPI QR, PDFs (pdf-lib) | |
| 5 | Student portal rules | profile wizard, eligibility, Apply Now requests, one signed Student Agreement & Consent with PDF, offers, wallet, referrals, promotions | |
| 6 | Admin console | assignment engine, approvals centre, 10 standard reports + scheduled emails, sessions, backups, company profile, India DPDP module | done |
| 7 | Jobs | reminders, 9:00 AM IST summaries, 2:00 AM IST retention / backups (Render cron or in-process) | done |
| 8 | Screens | new or changed UI for phases 1 to 7, each shown to the user before it is built | waits for approval |
| 9 | Partner portal | from `partner/mvp-reference/` | on hold |

Legacy source map for each phase: `legacy/server/` (`auth.js`, `rbac.js`, `email.js`, `routes/*`, `admin5/*`, `portal/*`, `svcinvoice.js`, `wallet.js`, `promotions.js`, `appointments.js`, `dpdp.js`, `legal/*`) and the rules in `legacy/README.md`.
Legacy tests (`legacy/tests/*.test.js`, 77 passing) are the acceptance list for each phase.

## CRM screen by screen (current)

Toolkit in `crm/src/le/` mirrors the client's `core.js`: `form.tsx` (field descriptors, formModal), `ListView.tsx`, `ui.tsx` (toast, modal, confirm),
`meta.ts` (`/api/meta` + `M` helpers), `Shell.tsx`, `format.ts`. Ported screens live in `crm/src/app/(le)/`; the dump's page is deleted when its replacement lands.
Backend modules follow the client's JSON contract (`backend/src/routes/meta.ts`, `routes/leads.ts`, `config/clientPerms.ts`).

| Backend module | Status |
|---|---|
| Masters, /api/meta, /api/me, client permission matrix (admin, counsellor, manager) | done |
| Leads (list, CRUD, duplicates, status flow, call log, follow-up task, convert) | done |
| Students (profile tabs, transfer, timeline, comments, pinned notes) | done |
| Core: dashboard, tasks, notifications, search, my profile | done |
| Shortlist, applications (one Application & Visa flow), documents, fees, visa | done |
| Admin: users, masters, templates, settings, audit, reports, export; counsellors; walk-in QR | done |
| Email engine (queue, templates E01 to E49, thread, hard CC, template admin, student email log, webhook) | done |
| Portal staff side: invite, Apply Now requests, chat, change requests, saved courses, sharing, fee instructions, offer conditions, payment proofs, student accounts, deletion requests | done (portal "view as student" preview and the catalogue admin come with the portal and course modules) |
| Meetings (counsellor hours, slots, accept / decline), promotions, referral rewards, vouchers (PDF), partner companies, wallet, GST invoices + receipts (PDF, UPI QR) | done (staff side; the student side comes with the portal) |
| Legal & privacy: versioned legal documents (seeded from `backend/legal/`), consent log + export, privacy requests with deadlines, breach register + Board templates, DPDP notices, cold-lead retention, processors register | done |
| Profile engine (sections, validation, locks after submit, change requests, lead drafts copied on convert, completion, journey) + the one Student information form, CRM tab routes | done (portal routes come with the portal) |
| Course catalogue in the client's model (University ID / Course ID, university settings every course follows, per-university Excel, publish rules, logos), course admin, staff course search with eligibility; the dump's catalogue and importer deleted | done |
| Admin console (`admin5/`: Super Admin, console permissions, settings registry, approvals, home, company, health, audit; packages, payments, refunds, reconciliation; templates, senders, email monitor, channels, announcements; checklist templates, catalogue quality, universities, standard + scheduled reports; roles grid, users, branches, teams, assignment engine + queue, bulk transfer, duplicate merge) | done (no step-up codes, sessions list or backups: JWT is stateless and Atlas keeps the snapshots; commissions wait for the partner portal) |
| Jobs (`services/jobs.ts`): follow-up and task reminders, 9 AM IST digests and deadlines, portal reminders (E30, E18, E29, visa), expired Apply Now requests, 2 AM IST duplicate / catalogue scans, scheduled reports, approvals SLA, announcements, cleanup | done (in-process; reminders deduped in `reminderssent`) |
| Student portal API (`/api/portal`: guard with read-only preview and consent gate, me, profile wizard, dashboard, courses, shortlist, Apply Now, applications and offers, documents, payments, visa, tasks, chat, notifications, settings, privacy, my data, referrals, calendar) | done |
| Student portal API, rest: signed Student Declaration (email code, guardian code, locked PDF, certificate, public verify), invite accept, staff preview links, portal side of meetings, promotions, wallet, invoices and the information form | done (signature in Times bold italic: the handwriting font needs `@pdf-lib/fontkit`; no printable referral card, the QR comes with `/referrals`) |
| CRM screens in the client UI | next |
| `backend/scripts/security-smoke.js` | broken: still loads `models/Document` and the dump routes; rewrite against the ported API |

| CRM screen (client UI) | Status |
|---|---|
| Shell, Leads | done |
| Everything else | after the backend |