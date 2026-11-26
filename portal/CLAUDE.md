# portal/

## Student Portal Structure
Mirrors the CRM structure but also has `ThemeContext` for light/dark switching. Auth store tracks `studentId` separately. Portal pages live under `app/(portal)/`.

`components/Header.tsx` is the top bar on every breakpoint, like the CRM's:
page title, appearance toggle, notifications, and the account menu (profile,
sign out). The sidebar is navigation only — Home, Apply, Chat, Documents,
Payments, the same five as the phone tab bar. Progress lives under
Profile → Progress (`?tab=progress`); `/progress` only redirects there.
