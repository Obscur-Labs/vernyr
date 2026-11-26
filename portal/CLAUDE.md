# portal/

## Structure

Every signed-in screen is the client's student portal, ported from `legacy/public/portal/js/` and living in the `app/(le)/` route group behind `le/Shell.tsx`. Outside it: `login`, `register`, `forgot`, `invite/[token]` (client-design sign-in screens in `components/auth/ClientAuth.tsx`), `legal/[slug]` (the legal texts, built from `src/legal/*.md`) and the public `get-app`.

The client's hash routes became paths: `#/dashboard` is `/dashboard`, `#/applications/<id>` is `/applications/<id>`. Old links are redirected: `/home` to `/dashboard`, `/wizard` to `/my-information`, `/visa` to the application that holds the visa.

## The shell (`le/Shell.tsx`)

Top bar (chat and bell with unread counts, account menu), side nav, phone bottom bar, as in the client's `main.js`. It also owns:
- **The consent gate** (`le/Gate.tsx`): full screen, cannot be closed. Each document must be scrolled to the end; the Student Declaration & Consent is signed with a typed name and an email code (the guardian signs too for an under-18). Any 428 from the API reopens it, through `setConsentHandler` in `le/api.ts`.
- **First login**: until the profile is submitted, Home sends the student to My information once per session.
- **Badges** every 30 s (`/notifications`, sent as passive so it does not count as activity), and the **idle logout** with a 2-minute warning.
- The install banner (after the second login) and the weekly phone nudge to `/get-app`.

## The toolkit (`le/`)

The CRM's toolkit (`ui.tsx`, `form.tsx`, `format.ts`, `Icon.tsx`, `InfoForm.tsx`) plus the portal's own:

| File | Holds |
|---|---|
| `api.ts` | `GET` / `POST` / `PUT` / `PATCH` / `DEL`, `SEND`, `download`, `blob`. Every path goes under `/api/portal`, except `/auth`, `/legal` and paths that already start with `/portal` |
| `p.tsx` | `usePMe` (the signed-in student), `t()` (every visible text; English is the key, no other language is published yet), eligibility and deadline helpers, `openLink`, `apiSrc`, `logout` |
| `docs.tsx` | the file picker (reorder, camera, merge note), `uploadDialog`, `taskDone`, `openChatWith`, the Documents page |
| `share.tsx` | `showLegal`, `share` / `shareCard` / `saveFile` (referral card), `ShareConsents` |

Screens: `account.tsx` (profile, settings, notifications, referral, privacy), `apps.tsx` (applications, visa, payments, tasks), `courses.tsx` (search, detail, compare, Apply Now, shortlist), `extras.tsx` (appointments, offers, wallet, from your university, more, install), `getapp.tsx`.

## Rules

- A staff preview (`me.preview`) is read only: the server refuses every write (the chat composer is also disabled).
- Links the server hands out under `/api/portal` (PDFs, `.ics`) need the token: open them with `openLink()`, never as a plain `href`.
- Styles are the client's, in `styles/le-ui.css` (scoped under `.le-ui`), with the `portal` class on the wrapper. `ThemeContext` and `ToastContext` in `app/layout.tsx` only serve the screens outside `(le)`.
