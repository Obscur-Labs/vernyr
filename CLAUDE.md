# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StudyCRM is a study-abroad management platform with three separate sub-projects:

- **`backend/`** — Express + TypeScript API (port 5000)
- **`crm/`** — Next.js 16 staff-facing CRM dashboard (port 3000)
- **`student/`** — Next.js 16 student self-service portal (port 3001)

## Commands

This is an **npm workspaces monorepo**. Run everything from the repo root — there is a
single root `node_modules` and a single root `package-lock.json`. Do not run `npm install`
inside `backend/`, `crm/`, or `student/`; that would recreate the per-app `node_modules`
this layout exists to avoid.

```bash
npm install              # installs all three workspaces at once

npm run dev              # all three concurrently (colour-tagged output)
npm run dev:backend      # ts-node with nodemon (hot reload), port 5000
npm run dev:crm          # next dev, port 3000
npm run dev:student      # next dev, port 3001

npm run build            # backend → crm → student, sequentially
npm run build:backend    # tsc → backend/dist/
npm run build:crm
npm run build:student

npm start                # all three production servers concurrently
npm run start:backend    # node dist/index.js
npm run start:crm
npm run start:student

npm run seed             # seed initial data via ts-node backend/src/seed.ts
npm run typecheck        # tsc --noEmit across all three
npm run clean            # remove node_modules and build outputs
```

The per-app scripts still exist in each workspace's `package.json`, so `cd crm && npm run dev`
also works. The root scripts are just `npm run <script> -w <workspace>` wrappers.

Both Next apps set `outputFileTracingRoot` to the repo root in `next.config.ts` — required
because dependencies are hoisted above each app directory.

## Environment Setup

No env file is committed anywhere. `backend/.env`, `crm/.env` and `student/.env`
are all gitignored and created by hand.

**backend/.env** — `MODE=local|live` picks the `LOCAL_`/`LIVE_` variant of each
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

### Frontend environments

`crm/.env` and `student/.env` are gitignored. Each holds both URL sets plus
`NEXT_PUBLIC_MODE=local|live`; flip that one line to switch locally. On Vercel
the values are entered in project settings instead — `NEXT_PUBLIC_MODE=live`
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
`@/lib/config` — never read `process.env` in a component. `next.config.ts`
throws if the selected mode's values are missing.

## Architecture

### Auth Flow
JWT-based. The backend issues a token on `/api/auth/login`. The CRM stores it in `localStorage` under `crm_token`; the student portal uses `student_token`. Both frontends use Zustand with `persist` middleware (`crm-auth` / `student-auth` keys) to hydrate auth state. The Axios instance in `src/lib/api.ts` (each frontend has one) attaches the token via an interceptor and redirects to `/login` on 401.

### Accounts live in two collections

- **`users`** — staff: `admin`, `counsellor`.
- **`portalaccounts`** — the people we serve: `student`, `university`.

Both share `models/accountFields.ts` (credentials, hashing, `presetKey`,
`permissions`), so a login is a login either way. Ids come from one space and
were preserved when the two were split, so every existing `ref: 'User'` on a
message, conversation, notification or document still points at the right
document.

**`backend/src/services/accounts.ts` is the seam.** Anything spanning both goes
through it:

- `findAccountByCredential` / `findAccountById` — sign-in and principal lookup
- `credentialConflict` — usernames and emails must be unique across **both**
  collections; a Mongo unique index only covers its own, so every create and
  update path must call this
- `attachAccounts(docs, paths)` — `.populate()` for a ref that could be either
  kind (chat participants, message senders, `currentVersion.uploadedBy`). Call
  it on lean objects; `refPath` was rejected because it would need a
  discriminator written into every existing message and conversation.

Portal logins are managed at `/portal-accounts` in the CRM (module:
`portal_accounts`), never on Members.

```bash
npm run migrate:split-accounts                    # dry run
cd backend && npx ts-node src/scripts/splitPortalAccounts.ts --apply
cd backend && npx ts-node src/scripts/splitPortalAccounts.ts --apply --rollback
```

### Access control — modules, presets, overrides

Authorization is a permission system, not a role check. Three files own it:

- **`backend/src/config/modules.ts`** — the module registry. Every area of the
  product is a module (`students`, `finance`, `chat`, `members`, `access`, …) and
  every action inside it is one of `create` / `read` / `update` / `delete`. This
  list lives in code because each entry must match a guarded route; adding one
  here without guarding its routes gives the UI a switch that does nothing.
- **`backend/src/config/presets.ts`** — the built-in presets (`admin`,
  `counsellor`, `university`, `student`), also in code. **Nothing has to exist in
  the `presets` collection for the app to work.**
- **`backend/src/services/access.ts`** — resolution and the principal cache.

A caller's effective permissions resolve in three layers:

1. the preset named by `presetKey` on the account (either collection), or — when
   that field is absent, which is the normal state for any account created
   before this system — the built-in whose key matches their `role`;
2. `fullAccess`, which grants every module including ones added later. It is a
   *floor*, not a wall: the preset's own map is laid over it, which is how the
   Admin seat holds everything and is still barred from replying in chat;
3. `permissions` on the account — the per-person grants and revocations behind
   Advanced settings. An override can revoke as well as grant.

Editing a built-in preset writes a row in `presets` that **shadows** the code
default; deleting that row restores it. Custom presets are rows with a key no
built-in claims.

Routes ask exactly one question:

```ts
router.post('/', authenticate, can('leads', 'create'), handler);
const isObserver = !may(req, 'chat', 'create');   // inline branching
```

`can()` only ever **denies**. Row-level scoping — a student seeing their own
record, a counsellor seeing their own caseload, a university partner seeing their
own applicants — still lives in the handlers, and holding a module permission
never widens it. `authorize(...roles)` survives for the few checks that really
are about the kind of account calling.

`authenticate` now loads the caller's live record (cached ~10s, invalidated on
any user or preset write) rather than trusting the token's claims, so a
deactivated account is refused on its next request and a permission change takes
effect without signing out.

### Roles

`User.role` still exists and still matters, but only for **data scoping** and
sign-in style — never for authorization:

- `admin` signs in with an email address; every other role uses a username.
- `counsellor` is scoped to their own caseload.
- `university` is scoped to applicants who applied to their institution, and is
  refused writes on student records regardless of preset.
- `student` is bound to the one `Student` record its `studentId` points at, and
  may only set `personal`, `education`, `scores`, `passport` and `preferences`
  on it (`STUDENT_SELF_FIELDS` in `routes/students.ts`).

### CRM access surfaces

- `/members` — staff and partner accounts only (`GET /api/users` excludes
  `role: 'student'`; portal logins are issued from the student's own page).
  Create, edit, assign a preset, and open Advanced settings for per-person
  overrides.
- `/roles` — preset CRUD and the module × action matrix, behind an Advanced
  settings disclosure. Guarded by the `access` module, so granting `access.update`
  lets someone change what everyone else can do.

Both refuse a save that would cost the caller their own `access.update`.

Navigation is permission-driven: `crm/src/lib/navigation.tsx` gives each entry a
`module`, and `navFor(permissions)` shows it when the caller holds `read` on it.
There is no role list to maintain. The client copy decides what to *draw*; the
server decides what to allow.

### Data Model Relationships
```
User ──(role=student)──► Student
                            │
                ┌───────────┼───────────┬──────────────┐
                ▼           ▼           ▼              ▼
          Application    Document    Payment          Visa
```

- **Lead** → converted to **Student** via `convertedStudentId`
- **Conversation** → has a `studentId` and `participants[]` (User refs); **Message** belongs to a Conversation
- **Notification** and **ActivityLog** are per-user/student side-effect records

### Student Journey Stages
The `StudentStage` enum drives the entire pipeline:
`inquiry → counselling → university_selection → application_submitted → offer_letter → fee_payment → cas_i20 → visa_filing → visa_approved → departure`

`Application.status` is separate: `drafting → submitted → offer_received → conditional_offer → accepted | rejected | withdrawn | deferred`

`Visa.stage`: `not_started → documents_complete → visa_filed → biometrics → interview → decision → approved | rejected | reapplied`

### Real-time (Socket.io)
The backend creates an `http.Server` wrapping Express and attaches `socket.io`. CORS is configured to allow both frontend origins. The socket setup lives in `backend/src/socket.ts`. Both frontends connect via `apiOrigin` from `@/lib/config`. The exported `io` instance from `backend/src/index.ts` is used inside routes to emit events.

### File Storage (Cloudinary)
Every user-uploaded file goes to Cloudinary — nothing is written to the local disk.
`backend/src/middleware/upload.ts` exports a memory-storage `multer` instance plus a
`requireCloudinary` guard (503 when credentials are missing); `backend/src/config/cloudinary.ts`
streams the buffer up and owns the folder vocabulary:

```
<CLOUDINARY_FOLDER>/                     (default: la-europa-docs)
  students/<studentId>/documents/        ← POST /api/documents/upload
  chat/<conversationId>/files/           ← POST /api/messages/send-file
  chat/<conversationId>/voice/           ← the same route with voice=true
```

Images upload as `image`, audio/video as `video`, everything else (PDF, DOCX …) as `raw`
so it is delivered byte-for-byte and is unaffected by Cloudinary's PDF delivery restrictions.

`fileUrl` fields now hold an absolute `https://res.cloudinary.com/…` URL, alongside a
`publicId`/`resourceType` pair (`filePublicId`/`fileResourceType` on `Message`) used for
deletion. Both are optional — records predating the migration still hold a relative
`/uploads/…` path, which the backend keeps serving statically when that folder exists and
which the frontends resolve through `fileHref()` in `src/lib/media.ts`. Always render file
links through that helper, never by concatenating the API base.

Deleting a document destroys its Cloudinary assets, except any still referenced by a
`Message` (chat attachments and documents can share one upload).

### Developer Console (local only)
`/dev` in the CRM is an unauthenticated console for local development: user/RBAC CRUD,
password resets, one-click impersonation, the access matrix, and a read-only collection
browser. It talks to `backend/src/routes/dev.ts` via `crm/src/lib/devApi.ts` (raw `fetch`,
not the shared axios instance, which would attach a token and redirect on 401).

It is gated four ways — leave every one of them in place:

| Gate | Where |
|---|---|
| `NODE_ENV !== 'production'` **and** `ENABLE_DEV_ROUTES === 'true'` | mount check in `index.ts` |
| same check re-run per request | `localhostOnly` in `routes/dev.ts` |
| caller must be loopback (`127.0.0.1` / `::1`) | `localhostOnly` |
| CRM page renders `notFound()` in production builds | `crm/src/app/dev/layout.tsx` |

`ENABLE_DEV_ROUTES` must never be set on a deployed backend. `GET /api/dev/rbac` now derives
the module matrix from the live registry and the presets in force, so it cannot drift. The one
hand-maintained part is `SCOPING_RULES` — the row-level rules that live inside handlers and
that permissions cannot express. Update those when you change a handler's scoping.

### CRM Frontend Structure
- App Router with a `(crm)` route group for authenticated pages
- Global providers in `app/layout.tsx`: `ThemeProvider` → `ToastProvider`
- Tailwind CSS v4 with a custom design token vocabulary: `bg-base`, `bg-surface`, `bg-card`, `bg-muted`, `border-line`, `text-t1/t2/t3`, `bg-accent` — defined in global CSS, not `tailwind.config`
- `useToast()` from `ToastContext` for all user-facing feedback
- `useAuthStore` from `stores/authStore.ts` for auth state
- All API calls go through the configured Axios instance at `lib/api.ts`

### Student Portal Structure
Mirrors the CRM structure but also has `ThemeContext` for light/dark switching. Auth store tracks `studentId` separately. Portal pages live under `app/(portal)/`.

## Key Conventions

- Backend routes always import `AuthRequest` (not plain `Request`) for authenticated handlers, and use `req.user!.id` for the caller's identity.
- Mongoose models export both the interface (`IStudent`, etc.) and the compiled model as the default export.
- `User.toJSON` strips the `password` field automatically — never manually omit it in routes.
- Frontend pages use `'use client'` and fetch data in `useEffect`; there is no server-side data fetching (RSC) in use.

## Installable apps (PWA)

Both Next apps install to a phone home screen from the browser.

- `src/app/manifest.ts` in each app → `/manifest.webmanifest`
- `public/sw.js` — a minimal service worker. It exists to make the app
  installable and keep the shell reachable offline; it never caches `/api/`.
- `components/InstallPrompt.tsx` registers the worker and shows the banner.
  Android/Chrome uses `beforeinstallprompt`; iOS fires no such event, so Safari
  gets the Share → Add to Home Screen wording instead.
- Icons are `public/icon-192.png` and `icon-512.png` (`any` + `maskable`).

Installability needs HTTPS in production; `localhost` is exempt.
