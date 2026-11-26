# crm/

## Structure

Every staff screen is the client's, ported from `legacy/public/js/pages/` and living in the `app/(le)/` route group behind `le/Shell.tsx`. The rest of `app/` is ours: `login/`, `forgot/` (client-design sign-in screens), `dev/` (the local console), `not-found.tsx`.

- `app/layout.tsx` holds the global providers (`ThemeProvider`, `ToastProvider`, `InstallPrompt`) used by the screens outside `(le)`.
- `app/(le)/layout.tsx` wraps every client screen in `Shell`: top bar (global search, bell, account menu), grouped sidebar, and Reports / Admin Settings below a separator, as in the client's `main.js`.
- A page file exports only its default component. Anything shared goes into `le/`, or Next refuses the build.

## The client toolkit (`le/`)

The ported screens share one toolkit, the client's `core.js` rewritten for React. Use it in any `(le)` screen; do not mix in `components/ui`.

| File | Holds |
|---|---|
| `api.ts` | `GET` / `POST` / `PUT` / `DEL`, `SEND` (FormData), `download`, `blob`, `ApiError` (carries `errors` per field) |
| `meta.ts` | `useMeta` (the caller and the masters from `/api/meta`) and `M` (role and permission helpers, master lists) |
| `ui.tsx` | `toast`, `showError`, `openOverlay`, `Modal`, `confirmBox` (with an optional reason) |
| `form.tsx` | `formModal`, `FormGrid`, `Options`, the `Field` vocabulary (select, multi, phone, file, html, color...) |
| `format.ts` | IST dates and times, `money`, `qs`, `apiSrc` |
| `ListView.tsx` | the client's paged, filterable, saved-view list |
| `Shell.tsx`, `TopBar.tsx`, `Icon.tsx`, `badges.tsx` | chrome, icons (Lucide, the client's names), status badges |
| `InfoForm.tsx` | the one student information form, shared with the portal (definition comes from the server) |

Screens: `leads.tsx`, `tasks.tsx`, `notify.tsx`, `portalcrm.tsx` (requests, chat, change requests, file opening), `student/` (the student profile frame and tabs), `work/` (shortlist, applications and visa, documents, fees), `promotions.tsx`, `wallet.tsx`, `admin.tsx`, `catalogue.tsx`, `privacy.tsx`, `console.tsx`, `console2.tsx`, `university.tsx` (Admin > University portal, the University panel of an application, university updates and messages, the dashboard strip).

Rules the screens keep:
- **Navigation is permission-driven**: `NAV` in `Shell.tsx` gives each entry a `show()` reading `M` (the caller's matrix permissions from `/api/meta`). The client copy decides what to draw; the server decides what to allow.
- **No `window.confirm` or `window.prompt`**: `confirmBox` and `formModal` replace them.
- **Stored files open through the API** (`openFile()` in `portalcrm.tsx`), never by their stored URL; API-served images go through `apiSrc()`.

### Styles

`styles/le-ui.css` is the client's `app.css` and `portal.css`, every rule scoped under `.le-ui` so it never touches the rest of the app; keyframes are prefixed `le-`. `le-fonts.css` loads the client's fonts, `le-infoform.css` the information form. Change the look of a client screen there, and only with the user's go-ahead (see the root CLAUDE.md).

## The older UI layer (outside `(le)`)

`login`, `forgot`, `dev` and `not-found` still use our own layer: Tailwind v4 tokens in `globals.css` (`bg-base`, `bg-card`, `text-t1/t2/t3`, `bg-accent`, `text-accent-ink`), `components/ui/` (import from `@/components/ui`), `components/charts/` (Recharts in the house style), and the Apple HIG layer at the end of `globals.css` (type scale, 8pt grid, 44pt targets).

- **The accent is two tokens.** `--color-accent` is the fill (white text on top), `--color-accent-ink` is the accent used as ink. On the dark ground no single value can do both. **Never `text-accent`**: it does not exist.
- Tailwind's own type steps are redefined onto the HIG scale in the `@theme` block (`text-sm` is 13, `text-base` 15). Do not correct them back.
- `Modal` in `components/ui` is the only modal there; it owns the focus trap, scroll lock and exit animation.
