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

Users have a `role` field (`super_admin`, `admin`, `counsellor_manager`, `finance`, `visa_team`, `doc_verification`, `university_team`, `counsellor`, `accountant`, `support`, `student`, `university`). Route-level authorization uses the `authorize(...roles)` middleware from `backend/src/middleware/auth.ts`.

The `student` role has a `studentId` FK on the User document pointing to the `Student` collection. Self-registration (`POST /api/auth/register-student`) atomically creates both records and links them.

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

`ENABLE_DEV_ROUTES` must never be set on a deployed backend. Note that `authorize()` is used
in only one route file — most guards are inline `req.user.role` checks — so the access matrix
in `routes/dev.ts` is a hand-maintained mirror. Update it whenever you change a guard.

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
