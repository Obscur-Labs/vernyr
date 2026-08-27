import { allows } from '@/lib/access';
import {
  BellIcon, BookIcon, ChartIcon, ChatIcon, DocumentTextIcon, FolderIcon,
  GraduationIcon, HomeIcon, PassportIcon, ShieldIcon, UserIcon, UsersIcon,
  WalletIcon,
} from '@/components/icons';
import type { PermissionMap } from '@/types';

/**
 * One registry behind the sidebar, the breadcrumb trail and the ⌘K palette.
 *
 * Entries nest one level. A parent with `children` is a *section*: the sidebar
 * draws it as a disclosure, the palette flattens it so every leaf is still one
 * keystroke away, and a section disappears entirely when the caller holds none
 * of its children.
 */

export interface NavLeaf {
  href: string;
  label: string;
  /** The access module this page reads. Undefined means everyone. */
  module?: string;
  /** Extra words the palette should match on, beyond the label. */
  keywords?: string;
  /** Shown under the label in the palette. */
  hint?: string;
  icon: React.ReactNode;
  /** Reachable from the header menu rather than the sidebar. */
  hidden?: boolean;
}

export interface NavSection extends NavLeaf {
  children: NavLeaf[];
  /** Open the disclosure by default. */
  defaultOpen?: boolean;
}

export type NavItem = NavLeaf | NavSection;

export const isSection = (item: NavItem): item is NavSection =>
  Array.isArray((item as NavSection).children) && (item as NavSection).children.length > 0;

/** A child row is marked by a hairline dot rather than its own glyph. */
const dot = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5" aria-hidden>
    <circle cx="12" cy="12" r="3.4" />
  </svg>
);

const ICONS = {
  dashboard: <HomeIcon />,
  leads: <UsersIcon />,
  students: <GraduationIcon />,
  chat: <ChatIcon />,
  applications: <DocumentTextIcon />,
  catalogue: <BookIcon />,
  visa: <PassportIcon />,
  documents: <FolderIcon />,
  finance: <WalletIcon />,
  reports: <ChartIcon />,
  access: <ShieldIcon />,
  profile: <UserIcon />,
  bell: <BellIcon />,
};

/* ── The tree ────────────────────────────────────────────────────────────── */

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    keywords: 'home overview stats charts',
    module: 'dashboard',
    icon: ICONS.dashboard,
  },
  {
    href: '/leads',
    label: 'Leads',
    keywords: 'enquiries prospects pipeline kanban',
    module: 'leads',
    icon: ICONS.leads,
  },
  {
    href: '/students',
    label: 'Students',
    keywords: 'applicants cases files',
    module: 'students',
    icon: ICONS.students,
  },
  {
    href: '/chat',
    label: 'Chat',
    keywords: 'messages conversations inbox rooms',
    module: 'chat',
    icon: ICONS.chat,
  },
  {
    href: '/applications',
    label: 'Applications',
    keywords: 'offers universities courses',
    module: 'applications',
    icon: ICONS.applications,
  },

  /* ── Catalogue ───────────────────────────────────────────────────────── */
  {
    href: '/courses',
    label: 'Catalogue',
    keywords: 'courses universities countries programmes catalog',
    module: 'courses',
    icon: ICONS.catalogue,
    children: [
      {
        href: '/courses',
        label: 'Courses',
        module: 'courses',
        keywords: 'programmes degrees masters bachelors search filter tuition intake',
        hint: 'Search and filter every course',
        icon: dot,
      },
      {
        href: '/courses/universities',
        label: 'Universities',
        module: 'courses',
        keywords: 'institutions schools colleges partners',
        hint: 'Institutions and what they offer',
        icon: dot,
      },
      {
        href: '/courses/countries',
        label: 'Countries',
        module: 'courses',
        keywords: 'destinations regions abroad',
        hint: 'Destinations at a glance',
        icon: dot,
      },
    ],
  },

  {
    href: '/visa',
    label: 'Visa Tracker',
    keywords: 'biometrics interview cas i20 filing',
    module: 'visa',
    icon: ICONS.visa,
  },
  {
    href: '/documents',
    label: 'Documents',
    keywords: 'passport transcripts uploads verification',
    module: 'documents',
    icon: ICONS.documents,
  },
  {
    href: '/finance',
    label: 'Finance',
    keywords: 'payments invoices fees money',
    module: 'finance',
    icon: ICONS.finance,
  },

  /* ── Reports ─────────────────────────────────────────────────────────── */
  {
    href: '/reports',
    label: 'Reports',
    keywords: 'analytics charts export insights',
    module: 'reports',
    icon: ICONS.reports,
    children: [
      { href: '/reports', label: 'Overview', module: 'reports', hint: 'The whole pipeline in one view', keywords: 'summary totals trend', icon: dot },
      { href: '/reports/finance', label: 'Finance', module: 'reports', hint: 'Revenue, ageing and outstanding', keywords: 'revenue money invoices payments ageing outstanding', icon: dot },
      { href: '/reports/students', label: 'Students', module: 'reports', hint: 'Stages, counsellors and intake', keywords: 'stage counsellor caseload nationality ielts', icon: dot },
      { href: '/reports/applications', label: 'Applications', module: 'reports', hint: 'Offers, countries and universities', keywords: 'offers acceptance rejection university country', icon: dot },
      { href: '/reports/visas', label: 'Visas', module: 'reports', hint: 'Filings, decisions and approval rate', keywords: 'visa approval rejection biometrics filing', icon: dot },
      { href: '/reports/leads', label: 'Leads', module: 'reports', hint: 'Sources and conversion', keywords: 'source conversion funnel enquiries', icon: dot },
      { href: '/reports/catalogue', label: 'Catalogue', module: 'reports', hint: 'What the course catalogue holds', keywords: 'courses universities tuition coverage', icon: dot },
    ],
  },

  /* ── Access & accounts ───────────────────────────────────────────────── */
  {
    href: '/members',
    label: 'Access & accounts',
    keywords: 'rbac roles permissions accounts logins members students universities seats security',
    icon: ICONS.access,
    children: [
      {
        href: '/members',
        label: 'Members',
        module: 'members',
        keywords: 'team staff counsellors admins invite seats seat',
        hint: 'Staff who work in the CRM',
        icon: dot,
      },
      {
        href: '/portal-accounts?role=student',
        label: 'Student logins',
        module: 'portal_accounts',
        keywords: 'student portal credentials password issue access',
        hint: 'Portal seats for students',
        icon: dot,
      },
      {
        href: '/portal-accounts?role=university',
        label: 'University logins',
        module: 'portal_accounts',
        keywords: 'university partner institution credentials password access',
        hint: 'Partner seats for institutions',
        icon: dot,
      },
      {
        href: '/roles',
        label: 'Roles & permissions',
        module: 'access',
        keywords: 'presets modules rbac privileges matrix permission',
        hint: 'Presets and the module matrix',
        icon: dot,
      },
    ],
  },

  /* Reachable from the header menu and the palette, but not the sidebar. */
  {
    href: '/profile',
    label: 'Profile',
    keywords: 'account me password security preferences settings',
    hidden: true,
    icon: ICONS.profile,
  },
  {
    href: '/notifications',
    label: 'Notifications',
    keywords: 'alerts bell updates',
    module: 'notifications',
    hidden: true,
    icon: ICONS.bell,
  },
];

/* ── Filtering ───────────────────────────────────────────────────────────── */

const mayOpen = (permissions: PermissionMap | undefined, item: { module?: string }) =>
  !item.module || allows(permissions, item.module, 'read');

/**
 * The sidebar tree, pruned. A section survives on its children: it is drawn
 * when at least one leaf is reachable, and its own `module` never hides it —
 * "Access & accounts" has none, because holding *any* of Members, Portal
 * accounts or Roles is reason enough to see the group.
 */
export function sidebarFor(permissions: PermissionMap | undefined): NavItem[] {
  const out: NavItem[] = [];
  for (const item of NAV_ITEMS) {
    if (item.hidden) continue;

    if (isSection(item)) {
      const children = item.children.filter((c) => mayOpen(permissions, c));
      if (!children.length) continue;
      // The section's own link points at whatever the caller can actually open.
      out.push({ ...item, children, href: children[0].href });
      continue;
    }
    if (mayOpen(permissions, item)) out.push(item);
  }
  return out;
}

export interface FlatNavItem extends NavLeaf {
  /** The section this leaf belongs to, for the palette's second line. */
  section?: string;
}

/**
 * Every reachable destination as one flat list — what ⌘K searches. A section's
 * own row is dropped in favour of its children, which carry the real pages.
 */
export function navFor(permissions: PermissionMap | undefined): FlatNavItem[] {
  const out: FlatNavItem[] = [];
  for (const item of NAV_ITEMS) {
    if (isSection(item)) {
      for (const child of item.children) {
        if (mayOpen(permissions, child)) out.push({ ...child, section: item.label, icon: item.icon });
      }
      continue;
    }
    if (mayOpen(permissions, item)) out.push(item);
  }
  return out;
}

/* ── Breadcrumbs ─────────────────────────────────────────────────────────── */

/** Labels for segments the registry does not cover. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  students: 'Students',
  chat: 'Chat',
  applications: 'Applications',
  courses: 'Catalogue',
  universities: 'Universities',
  countries: 'Countries',
  visa: 'Visa Tracker',
  documents: 'Documents',
  finance: 'Finance',
  reports: 'Reports',
  visas: 'Visas',
  catalogue: 'Catalogue',
  members: 'Members',
  'portal-accounts': 'Portal accounts',
  roles: 'Roles & permissions',
  profile: 'Profile',
  notifications: 'Notifications',
};

export interface Crumb { label: string; href?: string }

/** `/reports/finance` → Reports → Finance. */
export function crumbsFor(pathname: string, tail?: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [];

  return segments.map((segment, i) => {
    const isLast = i === segments.length - 1;
    const href = '/' + segments.slice(0, i + 1).join('/');
    const known = SEGMENT_LABELS[segment];
    const label = isLast && tail ? tail : known ?? decodeURIComponent(segment);
    return isLast ? { label } : { label, href };
  });
}
