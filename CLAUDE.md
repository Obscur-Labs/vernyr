# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StudyCRM is a study-abroad management platform with four separate sub-projects:

- **`backend/`** — Express + TypeScript API (port 5000)
- **`crm/`** — Next.js 16 staff-facing CRM dashboard (port 3000)
- **`student/`** — Next.js 16 student self-service portal (port 3001)
- **`website/`** — Next.js 16 public marketing site (port 3002)

## Commands

This is an **npm workspaces monorepo**. Run everything from the repo root — there is a
single root `node_modules` and a single root `package-lock.json`. Do not run `npm install`
inside `backend/`, `crm/`, `student/` or `website/`; that would recreate the per-app
`node_modules` this layout exists to avoid.

```bash
npm install              # installs all four workspaces at once

npm run dev              # all four concurrently (colour-tagged output)
npm run dev:backend      # ts-node with nodemon (hot reload), port 5000
npm run dev:crm          # next dev, port 3000
npm run dev:student      # next dev, port 3001
npm run dev:website      # next dev, port 3002

npm run build            # backend → crm → student → website, sequentially
npm run build:backend    # tsc → backend/dist/
npm run build:crm
npm run build:student
npm run build:website

npm start                # all four production servers concurrently
npm run start:backend    # node dist/index.js
npm run start:crm
npm run start:student
npm run start:website

npm run seed             # seed initial data via ts-node backend/src/seed.ts
npm run typecheck        # tsc --noEmit across all three
npm run clean            # remove node_modules and build outputs
```

The per-app scripts still exist in each workspace's `package.json`, so `cd crm && npm run dev`
also works. The root scripts are just `npm run <script> -w <workspace>` wrappers.

All three Next apps set `outputFileTracingRoot` to the repo root in `next.config.ts` —
required because dependencies are hoisted above each app directory.

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

**`LOCKED_PRESET_KEYS` — `student` and `university` — are outside all of that.**
They still resolve exactly as before; they are simply not listed by
`GET /api/access/presets`, and `PUT`/`DELETE` on either answers 403. The
portal-accounts routes pin a locked role's seat too: `presetKey` and
`permissions` sent by the client are ignored for a student or university
login, on create and on update, so issuing or editing one can never widen it.
The student seat is fixed because its routes scope rows to the caller's own
record and the preset is the written-down half of that gate. University is
parked until we decide what a partner may do — take it out of the set to bring
it back.

Routes ask exactly one question:

```ts
router.post('/', authenticate, can('leads', 'create'), handler);
const isObserver = !may(req, 'chat', 'create');   // inline branching
```

`can()` only ever **denies**. Row-level scoping — a student seeing their own
record, a university partner seeing their
own applicants — still lives in the handlers, and holding a module permission
never widens it. `authorize(...roles)` survives for the few checks that really
are about the kind of account calling.

`authenticate` now loads the caller's live record (cached ~10s, invalidated on
any user or preset write) rather than trusting the token's claims, so a
deactivated account is refused on its next request and a permission change takes
effect without signing out.

### Row scoping — `services/scope.ts`

**A module grant answers *whether*; it never answers *whose*.** The student
preset holds read on documents, applications, visas and finance so the portal
has something to draw. For a while that was the only gate those routes had, and
the `studentId` in a query string decided whose passport scan came back.

Every route serving a portal seat goes through one of three helpers:

- `scopeToOwnStudent(req, filter)` — pins a list filter to the caller's own
  record. Returns false when they are scoped to nothing, and the route answers
  with an empty list rather than the whole collection.
- `ownsStudentRow(req, studentId)` — the single-row guard, before a read or a
  write touches it.
- `isPortalStudent(req)` — for the writes that are staff decisions whatever a
  custom preset grants: document verification, fee records, visa stages.

Staff callers pass all three unchanged, so adding one to a route costs nothing
on the CRM side. The rules are mirrored in `SCOPING_RULES` in `routes/dev.ts`,
which is what `/dev` renders — change a handler, change that list.

### Chat membership

`can('chat','create')` says a caller may send; it never said *where*.
`openThreadFor(req, res, conversationId)` in `routes/messages.ts` is the
membership check every write goes through, and `canOpenWith()` decides who a
thread may be opened with — a portal account only ever talks to staff, never to
another portal account.

The same question is asked on the socket. `mayJoin()` in `socket/index.ts`
authorises every `join_room`: `user:<id>` is the holder's alone, and any other
room is a conversation the caller must participate in or observe. **The socket
itself now requires a valid token to connect at all** — an unauthenticated
socket used to be accepted and simply miss its personal room, which left every
other room joinable by anyone who could guess an id. The legacy `send_message`
relay is gone with it: it rebroadcast whatever a client handed it, under a
sender identity the server never checked.

### Request hardening

- `helmet` for security headers, `x-powered-by` disabled, `trust proxy` set so
  `req.ip` is the caller and not Render's load balancer.
- `express-rate-limit` in `middleware/rateLimit.ts`. `loginLimiter` is keyed on
  IP **plus the credential being tried**, so hammering one account does not lock
  every other user out from that address; `signupLimiter` caps self-registration;
  `apiLimiter` is the backstop.
- JSON bodies are capped at 256 kb. Uploads are multipart and carry their own
  10 MB limit.
- **A caught error never reaches the client.** `serverError(res, err)` in
  `utils/httpError.ts` logs it and answers with a bare message — a Mongoose
  validation error carries the whole document, a driver error the connection
  string, and every one of them a stack trace.
- `scalar(req.query.x)` in `utils/query.ts` before any query value lands in a
  filter. `?studentId[$ne]=` arrives as an object, and a filter built from one
  stops meaning what it says.

```bash
npm run test:security      # 23 checks; needs a local mongod, drops its own scratch db
```

`backend/scripts/security-smoke.js` is the regression suite. Every check in it
stands for a hole that was open in this codebase, so a failure is a return of
one, not a style disagreement.

### Roles

`User.role` still exists and still matters, but only for **data scoping** and
sign-in style — never for authorization:

- `admin` signs in with an email address; every other role uses a username.
- `counsellor` sees every student. The book is shared: `Student.counsellors` is
  a list, anyone on it is working the case, and a counsellor may add or remove
  **themselves** on any record (`POST`/`DELETE /api/students/:id/counsellors`).
  Only an admin puts someone *else* on a case. Whoever creates a student is
  added to it automatically, so a record can never be enrolled into nobody's
  hands. `GET /api/students?counsellor=me` is the "My students" filter.
- `university` is scoped to applicants who applied to their institution, and is
  refused writes on student records regardless of preset.
- `student` is bound to the one `Student` record its `studentId` points at, and
  may only set `personal`, `education`, `scores`, `passport` and `preferences`
  on it (`STUDENT_SELF_FIELDS` in `routes/students.ts`).

```bash
cd backend && npx ts-node src/scripts/backfillCounsellors.ts            # dry run
cd backend && npx ts-node src/scripts/backfillCounsellors.ts --apply    # copies the old
                                                                       # single assignedCounsellor
                                                                       # into counsellors[]
```

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
`module`, and an entry appears when the caller holds `read` on it. There is no
role list to maintain. The client copy decides what to *draw*; the server
decides what to allow.

The registry nests one level. An entry with `children` is a **section** — the
sidebar draws it as a Radix accordion, and it disappears entirely when the
caller holds none of its children. `Access & accounts` deliberately has no
`module` of its own, because holding any one of Members, Portal accounts or
Roles is reason enough to see the group.

- `sidebarFor(permissions)` — the pruned tree the sidebar renders.
- `navFor(permissions)` — the same thing flattened, so ⌘K still reaches every
  leaf by one keystroke. A section's own row is dropped in favour of its
  children, which carry the real pages.

The sections as they stand:

| Section | Children |
|---|---|
| Catalogue | Courses, Universities, Countries |
| Reports | Overview, Finance, Students, Applications, Visas, Leads, Catalogue |
| Access & accounts | Members, Student logins, University logins, Roles & permissions |

`Student logins` and `University logins` are `/portal-accounts?role=…` — the
same screen with its filter pre-set, which the page reads back off the query
string.

### Course catalogue

Country → university → course, in two collections plus a denormalised country
string. There is no `Country` model: a country is whatever the universities say
it is, and `GET /api/catalogue/countries` aggregates it.

- **`University`** — unique on `(country, slug)`, which is what the importer
  upserts against.
- **`Course`** — unique on `(university, name, level)`. Carries both the parsed
  value and the source's own wording: `tuition.amount`/`tuition.currency` drive
  the filters, `tuition.text` ("6,000 EUR/year") is what gets shown when the
  parse found no number. Anything the sheet had that the schema does not name
  lands in `extras`, so next year's extra column survives without a migration.

`backend/src/services/catalogue.ts` owns every parser — headers, money,
duration, intakes, deadlines, exams, degree level. **Both the importer and the
write routes run it**, so a hand-typed course and an imported one are the same
shape and equally filterable. Add a header spelling there, not in the script.

```bash
npm run import:courses -- --dir "C:/path/to/courses data"           # dry run
npm run import:courses -- --dir "C:/path/to/courses data" --apply
```

One workbook per country, one sheet per university, one row per course.
`backend/src/utils/xlsx.ts` reads .xlsx with no dependency — a zip directory
walk plus `inflateRaw` — because the alternative was a spreadsheet library in
the runtime dependencies for a job that only ever runs from a script. The
importer also handles what the real sheets do: truncated 31-character tab names
resolved against the workbook's own "University list" sheet, lone `Bachelor's`
banner rows that set the level for the block beneath them, and title rows above
the header when the tab is just `Sheet1`.

Every list endpoint under `/api/catalogue` speaks one filter vocabulary
(`q`, `country`, `level`, `intake`, `university`, `discipline`, `exam`,
`minTuition`, `maxTuition`, `sort`, `page`), so the CRM browser, a university's
page and the portal's future picker all read the same query shape. Search is a
substring regex rather than `$text`: a search-as-you-type box sends partial
words, and "engin" matches nothing under a text index.

Guarded by the `courses` module. The student and university presets already
hold `courses.read` — the catalogue is ready for the portal, which has no UI
for it yet.

### Reports

`/api/reports/{overview,finance,students,applications,visas,leads,catalogue}`,
all behind `reports.read`. Each answers with series and breakdowns rather than
finished sentences, in two uniform shapes — `{ value, count }` for a breakdown
and a parallel `months[]` + `series` for a trend — so one chart component reads
any of them. `?months=` sets the window (3–36, default 12) and gaps are filled
with zeros, because a line chart needs a point per month.

### Data Model Relationships
```
User ──(role=student)──► Student          Student.counsellors[] ──► User
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
- Tailwind CSS v4 with a custom design token vocabulary: `bg-base`, `bg-surface`, `bg-card`, `bg-muted`, `border-line`, `text-t1/t2/t3`, `bg-accent`, `text-accent-ink` — defined in global CSS, not `tailwind.config`

**The accent is two tokens.** `--color-accent` is the *fill* — button and chip
backgrounds, with white text on top. `--color-accent-ink` is the accent used as
*ink* — `text-accent-ink`, icons, the focus ring, the active-nav bar. On the
light theme both are the brand indigo `#3853DE`; on dark the fill stays
`#3853DE` and the ink lifts to `#7e8fea`.

They are split because on the dark ground no single value can do both jobs:
white text needs the accent dark enough to sit on (luminance ≤ 0.183) and
accent text needs it light enough to read against a card (luminance ≥ 0.236),
and those windows do not overlap. Use `bg-accent` for a surface you put white
on, `text-accent-ink` for anything you read. **Never `text-accent`** — it does
not exist, and reaching for it means the fill is being used as ink.

The CRM ships one colour. It used to offer six switchable palettes behind a
docked tray; the tray is gone, light/dark moved into the header toolbar, and
`data-palette` is no longer written. `#3853DE` is the same indigo the marketing
site and the auth screens carry.
- `useToast()` from `ToastContext` for all user-facing feedback
- `useAuthStore` from `stores/authStore.ts` for auth state
- All API calls go through the configured Axios instance at `lib/api.ts`

#### The UI layer

`components/ui/` is the shared vocabulary — import from `@/components/ui`, not
from the individual files. Variants are declared with `class-variance-authority`
and merged with `cn()` (`lib/utils.ts`), which is what lets a component's own
padding and a caller's `className` override coexist instead of both landing in
the class list.

| Component | Notes |
|---|---|
| `Button` / `ButtonLink` / `IconButton` | variants `primary·secondary·outline·ghost·danger·destructive`, sizes `sm·md·lg·icon` |
| `Card` / `CardHeader` / `PageHeader` | the panel and the two header rows every screen repeats |
| `EmptyState` / `Skeleton` / `SkeletonList` | the two states every list reaches |
| `Field` / `Input` / `Select` / `Textarea` / `Checkbox` | one `control` recipe behind all of them; `Field` wires label, hint and error to the control by id |
| `SearchInput` / `Segmented` | the search box and the iOS-style range picker |
| `Badge` / `RoleBadge` / `LevelBadge` | tones are semantic, not colours |
| `Modal` / `ConfirmModal` | see below |
| `Stat` | one component behind the dashboard's tinted tiles and the reports' plain metrics |
| `Table` / `TR` / `TD` / `TableEmpty` / `Avatar` | row rhythm, hairlines and the scroll container; sorting and selection stay with the page |
| `Accordion` | Radix, used by the sidebar sections |

Every screen goes through these, `/dev` included — the console having no auth
is not a reason for it to have its own buttons. `window.confirm` and
`window.prompt` appear nowhere in the CRM: they block the thread, ignore the
theme and cannot say what is about to be lost, so `ConfirmModal` and a real
form replace them.

`lib/format.ts` holds `timeAgo` and `fullDate`. There were three `timeAgo`
implementations before it, and they disagreed on when to give up and print a
date.

Icons are Lucide, aliased once in `components/icons.tsx` so the whole app
shares a size and stroke and no page imports `lucide-react` directly. Swapping
which glyph means "university" is a one-line change there. Emoji are not used
as icons — they bring their own palette, ignore the theme and render
differently on every platform. Country flags are the exception: those identify
a place rather than decorate a control.

#### The Apple HIG layer

`globals.css` ends with the HIG layer: the San Francisco stack, the iOS type
scale, the 8pt grid, concentric radii, Apple's easing curves and the
translucent chrome materials. **It governs form, rhythm and motion — never
hue.** The palettes above it stay the brand's own, which is why a HIG change
does not disturb the five themes or the light/dark pairs.

Two rules the components depend on:

- **Type comes off the scale.** 11 / 12 / 13 / 15 / 17 / 20 / 22 / 28 / 34, and
  nothing between. The semantic classes — `.hig-title1`, `.hig-headline`,
  `.hig-subhead`, `.hig-footnote`, `.hig-caption`, `.hig-label` — name the role
  so a component says what a line *is* rather than how many pixels it is.
  `text-[14px]` and `text-[11.5px]` are the shape of the old drift; there
  should be none left.

- **44pt is the minimum target.** `.hig-control` sets the height for anything
  a finger lands on. Where a control should stay visually smaller — a 36pt
  toolbar glyph, a 32pt filter in a dense row — `.hig-touch` grows only the
  area that receives the tap, using an `::after` overlay so the border and
  background do not move with it. `.hig-touch-tight` is the 40pt variant, for
  a row of adjacent targets that would otherwise overlap and steal each
  other's taps.

  The one exemption is an inline affordance inside an already-clickable row:
  an overlay there covers the row itself. Those are given more room instead.

**Tailwind's own type steps are redefined onto the scale** in the `@theme`
block at the end of the file — `text-sm` is 13 (footnote), `text-base` is 15
(subhead), `text-2xl` is 22 (title2). The app sizes most of its text with
those names, so redefining the step moves ~370 call sites at once. This is the
same move the light-theme colour ramp makes, for the same reason: rewriting
every class by hand would be a worse change with more ways to go wrong. **Do
not "correct" these back to Tailwind's defaults** — that silently pulls half
the app off the grid again.

#### Overlays

`Modal` is the only modal. It keeps the element mounted for the exit animation
(`open` going false starts the exit; a timer unmounts it after), and owns the
focus trap, the scroll lock and the scrollbar-gutter compensation. Pass
`variant="sheet"` for a right-docked panel.

Everything that floats shares one vocabulary in `globals.css`: `.overlay-scrim`
(28px blur, theme-aware), `.overlay-panel`, and paired enter/exit animations —
`animate-{backdrop,overlay,popover,sheet}-{in,out}`. Never hand-roll a
`fixed inset-0 bg-black/50`; there is a class for it.

#### Charts

`components/charts/` wraps Recharts in the house style: `DonutChart`,
`BarChart`, `HBarChart`, `LineChart`, `StackedBar`, `Sparkline`, plus
`ChartCard` and one `ChartTooltip` for all of them — Recharts' default tooltip
is a white box with inline styles that ignores the theme entirely.

Every chart takes the same `{ value, count }` rows the reports API returns, so
one can be pointed at a new endpoint without reshaping the data. The
categorical palette is `--chart-1` … `--chart-12` in `globals.css`, with a
light-theme override, so a series keeps its identity when the theme flips.
`lib/reports.ts` maps each status enum to a fixed colour — "closed won" is the
same green on the dashboard, in the reports and on the board.

**Progress bars are not a chart.** A proportion goes in a donut, a comparison
in bars, a trend in a line. `HBarChart` is the one bar-shaped exception, and
only because long country and university names read better as HTML than as an
SVG axis tick.

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

  **The worker is registered in production builds only,** and in development it
  actively unregisters itself and drops its caches. The dev server reuses chunk
  filenames across rebuilds, so a cache-first worker serves a stale
  `foo_abc._.js` for a module whose contents have changed; the page then
  hydrates against a module graph that no longer matches and fails *silently* —
  no console error, just a screen stuck on the loading spinner. Registering in
  dev cost a day of exactly that.

  `CACHE` is versioned (`VERSION` in `sw.js`) because `activate` deletes every
  cache that is not the current one — a pinned name means a deploy never
  invalidates anything. Cache-first is used only for `/_next/static/`, whose
  URLs are content-addressed in a production build; assets are
  stale-while-revalidate, navigations are network-first, and everything else is
  left to the network.
  Android/Chrome uses `beforeinstallprompt`; iOS fires no such event, so Safari
  gets the Share → Add to Home Screen wording instead.
- Icons are `public/icon-192.png` and `icon-512.png` (`any` + `maskable`).

Installability needs HTTPS in production; `localhost` is exempt.

## Marketing site (`website/`)

The public page at the apex, `vernyr.com`. Static — no API calls, no auth, no
env file. Every outward link lives in `src/lib/site.ts`: the two product
subdomains, the contact details, the Drive links for terms and privacy, and the
catalogue counts quoted on the page. Change them there, nowhere else.

The look comes from the `gradient-skin` skill in `.claude/skills/`, derived from
the brand indigo `#3853DE`: big soft pools of colour bleeding in from the edges,
cool on the left, warm on the right, with a white light-leak up the middle where
the type sits. `.skin` in `globals.css` is that gradient; `.skin-soft` is the
quieter wash the sections below the fold use. Regenerate with:

```bash
python .claude/skills/gradient-skin/scripts/skin.py \
  --from-brand "#3853DE" --blank --seed 3 --format css
```

Type is Instrument Serif for display with a true italic second line, Inter for
body, JetBrains Mono for the tracked-out eyebrows. Cards carry no border and no
shadow — both fight the softness; `.panel` is a white wash plus a blur instead.
The one bordered thing on the page is the badge.

`Brand.tsx` re-declares the same traced mark geometry the apps use in
`components/auth/Insignia.tsx`, and paints `wordmark.png` as an alpha mask over
`currentColor`. If the mark is ever re-fitted, both copies move together.
