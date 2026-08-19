# StudyCRM

A full-stack study-abroad management platform for counselling agencies. Manages the complete student lifecycle — from lead capture through visa approval — with a staff CRM and a student self-service portal...

> **Documentation lives in [`vault/`](vault/Home.md)** — an Obsidian vault of
> interlinked notes covering architecture, data models, domain workflows and
> deployment. Open the `vault/` folder as a vault in Obsidian, or just start at
> [`vault/Home.md`](vault/Home.md) on GitHub.

---

## What It Does

**For staff** (CRM dashboard):
- Track leads through a Kanban sales pipeline
- Manage student records across a 10-stage journey (inquiry → departure)
- Review and approve uploaded documents
- Manage university applications, visa cases, and payments
- Real-time chat with students and live notifications

**For students** (self-service portal):
- Track their own progress through the journey
- Upload required documents and monitor approval status
- View university applications, offer letters, and payment dues
- Chat directly with their assigned counsellor

---

## Services

| Service | Port | Stack |
|---------|------|-------|
| Backend API | 5000 | Node.js · Express · TypeScript · MongoDB · Socket.IO |
| CRM Dashboard | 3000 | Next.js 16 · React 19 · Zustand · Tailwind CSS v4 |
| Student Portal | 3001 | Next.js 16 · React 19 · Zustand · Tailwind CSS v4 (PWA) |

---

## Quick Start

This is an npm workspaces monorepo — one install at the root covers all three services.

### 1. Install

```bash
npm install                 # installs backend, crm and student together
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env              # fill in JWT_SECRET and MONGODB_URI
```

`crm/.env` and `student/.env` are already committed — flip `NEXT_PUBLIC_MODE`
in either to switch between `local` and `live`.

### 3. Run

```bash
npm run dev                 # all three at once, colour-tagged output
```

Or start them individually, each in its own terminal:

```bash
npm run dev:backend         # port 5000
npm run dev:crm             # port 3000
npm run dev:student         # port 3001
```

Seed an initial super_admin:
```bash
npm run seed
```

### Other root commands

```bash
npm run build               # build all three
npm run typecheck           # tsc --noEmit across all three
npm start                   # run all three production servers
npm run clean               # remove node_modules and build outputs
```

---

## Environment Variables

### backend/.env

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token expiry (default: 7d) |
| `CLIENT_CRM_URL` | CRM origin for CORS (default: http://localhost:3000) |
| `CLIENT_STUDENT_URL` | Student portal origin for CORS (default: http://localhost:3001) |

### crm/.env and student/.env

Committed, public hostnames only.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_MODE` | `local` or `live` — picks which pair below is used |
| `NEXT_PUBLIC_LOCAL_API_ORIGIN` | Backend origin for local (http://localhost:5000) |
| `NEXT_PUBLIC_LIVE_API_ORIGIN` | Backend origin for live (https://api.vernyr.com) |
| `NEXT_PUBLIC_LOCAL_STUDENT_URL` | CRM only — student portal, local |
| `NEXT_PUBLIC_LIVE_STUDENT_URL` | CRM only — student portal, live |

The REST base is derived as `API_ORIGIN + /api`, so there is no separate
API/socket URL to keep in sync.

---

## Student Journey (10 Stages)

```
Inquiry → Counselling → University Selection → Application Submitted
  → Offer Letter → Fee Payment → CAS/I-20 → Visa Filing
  → Visa Approved → Departure
```

Application status runs on a separate track: `drafting → submitted → offer received → conditional offer → accepted | rejected | withdrawn | deferred`

---

## Role-Based Access Control

11 staff roles with route-level enforcement:

`super_admin` · `admin` · `counsellor_manager` · `counsellor` · `finance` · `accountant` · `visa_team` · `doc_verification` · `university_team` · `support` · `student`

| Capability | Roles |
|-----------|-------|
| Full system access | super_admin, admin |
| Lead & student management | counsellor_manager, counsellor |
| Document approval | doc_verification |
| Visa tracking | visa_team |
| Finance & payments | finance, accountant |
| Reports | super_admin, admin, counsellor_manager |
| Student (own data only) | student |

---

## API Overview

Base URL: `http://localhost:5000/api`

| Resource | Endpoints |
|----------|-----------|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/register-student` |
| Users | `GET/POST /users`, `PUT /users/:id`, `POST /users/student-account` |
| Leads | `GET/POST /leads`, `GET/PUT/DELETE /leads/:id` |
| Students | `GET/POST /students`, `GET/PUT/PATCH/DELETE /students/:id` |
| Documents | `GET/POST /documents`, `POST /documents/upload`, `PUT /documents/:id/status` |
| Applications | `GET/POST /applications`, `GET/PUT/DELETE /applications/:id` |
| Visas | `GET/POST /visas`, `GET/PUT/DELETE /visas/:id` |
| Payments | `GET/POST /payments`, `GET/PUT/DELETE /payments/:id` |
| Messages | `GET/POST /messages/conversations`, `POST /messages/send`, `GET /messages/:conversationId` |
| Notifications | `GET/POST /notifications`, `PUT /notifications/read-all`, `PUT /notifications/:id/read` |
| Dashboard | `GET /dashboard/stats`, `GET /dashboard/reports` |

Uploaded files served at `/uploads/<filename>`.

---

## Key Features

### CRM Dashboard
- Lead Kanban board with 7 status columns
- Student 360 profile: stage tracker, applications, documents, visa, payments, notes
- Document review queue with approve/reject and rejection reason
- Visa stage progression tracker
- Finance module: payment recording, mark-paid, receipt links
- Monthly KPI reports and lead funnel analytics
- Issue student portal credentials from the student profile

### Student Portal
- Home dashboard with counsellor card, pending actions summary
- 10-stage visual journey tracker with stage-specific guidance
- Multipart document upload with approval status tracking
- University applications with offer dates and tuition details
- Payment history with overdue detection
- Real-time chat with assigned counsellor (typing indicators, read receipts)
- PWA — installable on mobile, bottom navigation

### Platform-wide
- Socket.IO real-time messaging and notifications
- Dark / light theme with localStorage persistence
- JWT auth with automatic token refresh redirect
- Toast notification system

---

## Project Docs

- [`context.md`](./context.md) — Deep technical reference: models, routes, auth flow, socket events, design tokens
- [`summary.md`](./summary.md) — One-page high-level overview
