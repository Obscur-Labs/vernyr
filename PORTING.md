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
| 2 | Email engine | nodemailer queue with retries, templates E01 to E49, one thread per student, hard CC `laeuropaapplication@gmail.com`, placeholder whitelist, security emails without CC | |
| 3 | Student lifecycle | leads, conversion, Applications & Visa flow, document checklists per country / level, versions, PDF merge, tasks, comments, appointments, walk-in QR / info form | |
| 4 | Money | service packages + instalments, discounts with approval, refunds, GST invoices (CGST + SGST in Gujarat, IGST elsewhere, FY number series), payment proof with UTR, receipts, UPI QR, PDFs (pdf-lib) | |
| 5 | Student portal rules | profile wizard, eligibility, Apply Now requests, one signed Student Agreement & Consent with PDF, offers, wallet, referrals, promotions | |
| 6 | Admin console | assignment engine, approvals centre, 10 standard reports + scheduled emails, sessions, backups, company profile, India DPDP module | |
| 7 | Jobs | reminders, 9:00 AM IST summaries, 2:00 AM IST retention / backups (Render cron or in-process) | |
| 8 | Screens | new or changed UI for phases 1 to 7, each shown to the user before it is built | waits for approval |
| 9 | Partner portal | from `partner/mvp-reference/` | on hold |

Legacy source map for each phase: `legacy/server/` (`auth.js`, `rbac.js`, `email.js`, `routes/*`, `admin5/*`, `portal/*`, `svcinvoice.js`, `wallet.js`, `promotions.js`, `appointments.js`, `dpdp.js`, `legal/*`) and the rules in `legacy/README.md`.
Legacy tests (`legacy/tests/*.test.js`, 77 passing) are the acceptance list for each phase.
