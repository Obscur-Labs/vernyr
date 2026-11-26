# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vernyr is La Europa's study-abroad platform (Vernyr is the product, La Europa the company: keep "La Europa" wherever it names the company). Five sub-projects:

- **`backend/`**: Express + TypeScript API (port 5000)
- **`crm/`**: Next.js 16 staff-facing CRM dashboard (port 3000)
- **`portal/`**: Next.js 16 student self-service portal (port 3001)
- **`partner/`**: Next.js 16 university partner portal (port 3003). On hold: a placeholder page, with the client's plain-JS MVP kept in `partner/mvp-reference/` as the spec
- **`website/`**: Next.js 16 public marketing site (port 3002)

## Feature reference

`legacy/` (git-ignored) holds the client's final build (Express + SQLite + plain JS). It is the feature spec being ported into this monorepo; where the two disagree, `legacy/` behaviour wins. See `PORTING.md`. Do not change UI without asking the user first.

## Deploying

`DEPLOY.md` is the runbook. `npm run doctor` checks every env file, `npm run deploy:env` writes what to paste into Render and Vercel, `npm run bootstrap` creates a CRM Admin (username + password, asked in the terminal).

## Commands

npm workspaces monorepo: run everything from the repo root (one root `node_modules`, one `package-lock.json`). Never run `npm install` inside a workspace; that recreates the per-app `node_modules` this layout exists to avoid. Root scripts are `npm run <script> -w <workspace>` wrappers, listed in `package.json`.

Every Next app sets `outputFileTracingRoot` to the repo root in `next.config.ts`, required because dependencies are hoisted above each app directory.

## Environment Setup

No env file is committed anywhere. `backend/.env`, `crm/.env` and `portal/.env`
are all gitignored and created by hand.

**backend/.env**: `MODE=local|live` picks the `LOCAL_`/`LIVE_` variant of each
mode-scoped var; the bare name (`MONGODB_URI`) still works as a fallback.

```
MODE=local
PORT=5000

LOCAL_MONGODB_URI=...
LOCAL_CLIENT_CRM_URL=http://localhost:3000
LOCAL_CLIENT_STUDENT_URL=http://localhost:3001

LIVE_MONGODB_URI=...
LIVE_CLIENT_CRM_URL=...
LIVE_CLIENT_STUDENT_URL=...

JWT_SECRET=...
JWT_EXPIRES_IN=7d
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=vernyr-docs
```

`backend/src/config/env.ts` is the only place env is read. It throws at boot when
`MODE=live` (or `NODE_ENV=production`) and a required value is missing.

Uploads return `503` until the `CLOUDINARY_*` values are filled in; `GET /api/health`
reports `storage: "cloudinary" | "unconfigured"`.

The Cloudinary API key must carry a role that can **create** assets. A key
without one still passes `api.ping()` and reports `configured`, but every
upload is refused with a 403; the routes answer 502 with a message saying so.

### Frontend environments

`crm/.env` and `portal/.env` are gitignored. Each holds both URL sets plus
`NEXT_PUBLIC_MODE=local|live`; flip that one line to switch locally. On Vercel
the values are entered in project settings instead; `NEXT_PUBLIC_MODE=live`
plus the `LIVE_` pair.

```
NEXT_PUBLIC_MODE=local
NEXT_PUBLIC_LOCAL_API_ORIGIN=http://localhost:5000
NEXT_PUBLIC_LOCAL_STUDENT_URL=http://localhost:3001
NEXT_PUBLIC_LIVE_API_ORIGIN=...
NEXT_PUBLIC_LIVE_STUDENT_URL=...
```

`src/lib/config.ts` reads them and exports `mode`, `apiOrigin`, `apiUrl`
(= `apiOrigin + '/api'`) and, in the CRM, `studentUrl`. Import from
`@/lib/config`; never read `process.env` in a component. `next.config.ts`
throws if the selected mode's values are missing.

## Architecture

The CRM and the student portal run the client's product: their routes (ported into `backend/src/routes/`) and their screens (ported into `crm/src/le/` and `portal/src/le/`). An older permission and chat layer from before the port is still mounted; it is described at the end of this section, and nothing in the two apps' UI calls it.

### Auth Flow
JWT-based. Staff and students both sign in at `POST /api/auth/login`. The CRM keeps the token in `localStorage` under `crm_token`, the portal under `student_token`; each has a Zustand `persist` store (`crm-auth` / `student-auth`). The axios instance in each app's `src/lib/api.ts` attaches it and redirects to `/login` on 401. Staff sign in with a username (`EMAIL_LOGIN_ROLES` is empty); students with email, mobile or username.

### Accounts live in two collections
- **`users`**: staff, `role` one of `admin`, `counsellor`, `manager`. Super Admin, finance, signing authority and discount approver are flags on the user.
- **`portalaccounts`**: the people we serve, `student` (and `university`, for the partner portal).

Both share `models/accountFields.ts`. `services/accounts.ts` is the seam for anything spanning both (`findAccountByCredential`, `findAccountById`, `credentialConflict`, `attachAccounts`): usernames and emails must be unique across **both** collections, so every create and update path calls `credentialConflict`.

### Staff permissions: the client's matrix
`config/clientPerms.ts` is the client's permission matrix (`legacy/server/rbac.js`): module × role → F / E / V / -. Routes ask `need(req, module, action)` from `services/crm.ts`; `staffOnly` in `middleware/auth.ts` refuses portal tokens outright. **Only staff roles hold anything in the matrix**: a portal login holds nothing on any staff route, whatever it sends. `GET /api/meta` returns the caller's `perms` and the masters the CRM draws from.

The Admin console has its own permissions (`services/console.ts`: `AD_MODULES`, per-role overrides, Super Admin checks), edited in Console → Roles.

### Row scoping
A permission answers *whether*; it never answers *whose*.
- **Staff**: `seesAll()` (admin, manager) see every record. A counsellor sees the students whose `primary_counsellor_id` is theirs: one counsellor per student, as in the client. `studentScope(req)` is the list filter, `loadStudent(req, id)` the single-row guard (`services/students.ts`). Leads follow the same rule.
- **Students**: `portalAuth` (`middleware/portal.ts`) mounts every `/api/portal` route. It loads the account and its context (`req.su`, `req.c`), refuses locked or deactivated accounts, and answers 428 to every write until the Student Declaration & Consent is signed (only `/consent`, `/privacy`, `/ping` stay open). Handlers read only through `req.c`, so a student can only ever reach their own lead or student record.
- **Staff preview** ("View as student"): `previewToken()` mints a 2-hour portal token with a `pv` claim. It is read only: every non-GET answers 403.

### The student portal API
`/api/portal/auth/*` (invite activation) is public; everything else under `/api/portal` goes through `portalAuth`: `routes/portal.ts` (me, consent and signing, dashboard, documents, applications), `portalAccount.ts` (profile, settings, chat, notifications, privacy, referrals), `portalModules.ts` (info form, appointments, promotions, wallet, invoices, referral card). The staff side of the same features is `portalStaff.ts`.

Consent and signing: `services/consent.ts`, `services/signing.ts` (email codes, guardian co-signature for under-18s, one locked PDF per signature), `services/legalPdf.ts`. Public legal texts are `GET /api/legal/:type`.

### Opening stored files
Cloudinary refuses plain delivery URLs for raw files on this account (`401 deny or ACL failure`), so **never link a PDF by its stored URL**. The server signs every link it hands out (`fileUrl()` in `services/files.ts`, `signedFileUrl()` in `config/cloudinary.ts`). Where a route answers `{ url }` instead (`/documents/:id/open`, `/chat/attachments/:aid/open`, the portal's `/chatfile/:aid`), the CRM opens it with `openFile()` (`crm/src/le/portalcrm.tsx`) and the portal with `openLink()` (`portal/src/le/p.tsx`).

Paths the API serves itself (`/api/logos/:id`, PDFs, `.ics`) need care: the apps are served from another origin than the API. Images go through `apiSrc()` (in each app's `le/` toolkit); files that need the token go through `download()`.

### Request hardening
- `helmet`, `x-powered-by` off, `trust proxy` so `req.ip` is the caller and not Render's load balancer.
- `express-rate-limit` in `middleware/rateLimit.ts`: `loginLimiter` keyed on IP **plus the credential tried**, `signupLimiter`, `apiLimiter` as the backstop.
- JSON bodies capped at 256 kb; uploads are multipart with their own 10 MB limit.
- **A caught error never reaches the client**: `serverError()` / `handle()` log it and answer with a bare message.
- `scalar(req.query.x)` (`utils/query.ts`) and `oid()` before any query value lands in a filter.

```bash
npm run test:security      # 39 checks; needs a local mongod, uses its own scratch db
```

`backend/scripts/security-smoke.js` is the regression suite. Every check in it stands for a hole that was open in this codebase, so a failure is a return of one, not a style disagreement. Re-run it after any auth, permission or scoping change.

### Background jobs
`services/jobs.ts` (`startJobs`) sends the reminders and scheduled reports. `ReminderSent` (60-day TTL) dedupes them, so a restart never sends a reminder twice.

### Course catalogue and reports
Catalogue model, importer, filter vocabulary and the reports API: see `backend/CLAUDE.md`, which loads when working in that folder.

### File Storage (Cloudinary)
Every user-uploaded file goes to Cloudinary; nothing is written to the local disk. `middleware/upload.ts` exports a memory-storage `multer` instance plus a `requireCloudinary` guard (503 when credentials are missing); `config/cloudinary.ts` streams the buffer up and owns the folder vocabulary (`<CLOUDINARY_FOLDER>/students/<id>/documents/`, `chat/<id>/files/`). Images upload as `image`, audio and video as `video`, everything else (PDF, DOCX) as `raw` so it is delivered byte for byte. Deleting a document destroys its Cloudinary assets, except any still referenced by a chat message.

### The older layer (still mounted, not used by the apps)
From before the port, still mounted and still covered by the security suite: the module / preset / override permission system (`config/modules.ts`, `config/presets.ts`, `services/access.ts`, `/api/access`), row scoping helpers (`services/scope.ts`), `/api/users`, and the staff chat API (`/api/messages`) with its Socket.IO server (`socket/index.ts`: token required to connect, `mayJoin()` on every room). The `/dev` console uses them. Leave them in place until they are removed on purpose; do not build new features on them.

### Developer Console (local only)
`/dev` in the CRM is an unauthenticated console for local development: user CRUD, password resets, impersonation, the access matrix, a read-only collection browser. It talks to `backend/src/routes/dev.ts` via `crm/src/lib/devApi.ts` (raw `fetch`, not the shared axios instance).

It is gated four ways; leave every one of them in place:

| Gate | Where |
|---|---|
| `NODE_ENV !== 'production'` **and** `ENABLE_DEV_ROUTES === 'true'` | mount check in `index.ts` |
| same check re-run per request | `localhostOnly` in `routes/dev.ts` |
| caller must be loopback (`127.0.0.1` / `::1`) | `localhostOnly` |
| CRM page renders `notFound()` in production builds | `crm/src/app/dev/layout.tsx` |

`ENABLE_DEV_ROUTES` must never be set on a deployed backend.

### CRM and portal frontends
CRM structure, the client UI toolkit and its screens: see `crm/CLAUDE.md`. Student portal: see `portal/CLAUDE.md`. Both load when working in that folder.

## Key Conventions

- Backend routes always import `AuthRequest` (not plain `Request`) for authenticated handlers, and use `req.user!.id` for the caller's identity.
- Mongoose models export both the interface (`IStudent`, etc.) and the compiled model as the default export.
- `User.toJSON` strips the `password` field automatically; never manually omit it in routes.
- Frontend pages use `'use client'` and fetch data in `useEffect`; there is no server-side data fetching (RSC) in use.

## Installable apps (PWA)

Both Next apps install to a phone home screen from the browser.

- `src/app/manifest.ts` in each app → `/manifest.webmanifest`
- Icons are `public/icon-192.png` and `icon-512.png` (`any` + `maskable`).
- `components/InstallPrompt.tsx` shows the banner. Android/Chrome uses
  `beforeinstallprompt`; iOS fires no such event, so Safari gets the Share →
  Add to Home Screen wording instead.

**There is no service worker, on purpose.** Its cache kept installed apps on an
old build after deploys. `InstallPrompt` unregisters any worker and clears every
Cache Storage entry on load, and `public/sw.js` is a retired worker that does the
same for a browser whose old worker checks for an update. Do not bring caching
back.

Nothing holds data for long:

- API answers carry `Cache-Control: no-store` and no ETag (`backend/src/index.ts`).
- Pages are static shells Vercel serves with `max-age=0, must-revalidate`; only
  content-hashed `/_next/static` files are cached long-term.
- `src/lib/api.ts` shares identical GETs that are *in flight at the same time*
  and forgets them as they settle; no response is reused afterwards.
- The persisted auth store (token, profile) survives reloads so sign-in sticks;
  each app's `le/Shell.tsx` loads the live profile on mount (`/meta` in the CRM,
  `/portal/me` in the portal).

The client's own install screens sit beside it: `/install` in both apps,
`/get-app` (public) and a weekly phone banner in the portal, all reading
`le/install.ts`, which catches the browser's install event on first load.

## Marketing site (`website/`)

Static marketing site, links file, gradient skin, type: see `website/CLAUDE.md`, which loads when working in that folder.
