import type { UserRole } from '@/types';

/**
 * One registry behind the sidebar, the breadcrumb trail and the ⌘K palette.
 * Keeping them on the same list is what stops a page appearing in search that
 * the caller's role cannot actually open.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Undefined means every role. */
  roles?: UserRole[];
  /** Extra words the palette should match on, beyond the label. */
  keywords?: string;
  icon: React.ReactNode;
  /** Reachable from the header menu rather than the sidebar. */
  hidden?: boolean;
}

const icon = (children: React.ReactNode) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">{children}</svg>
);

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    keywords: 'home overview stats',
    icon: icon(<path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />),
  },
  {
    href: '/leads',
    label: 'Leads',
    keywords: 'enquiries prospects pipeline kanban',
    roles: ['admin', 'counsellor', 'university'],
    icon: icon(<path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />),
  },
  {
    href: '/students',
    label: 'Students',
    keywords: 'applicants cases files',
    icon: icon(<path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />),
  },
  {
    href: '/chat',
    label: 'Chat',
    keywords: 'messages conversations inbox',
    roles: ['admin', 'counsellor'],
    icon: icon(<path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />),
  },
  {
    href: '/applications',
    label: 'Applications',
    keywords: 'offers universities courses',
    roles: ['admin', 'counsellor', 'university'],
    icon: icon(<path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />),
  },
  {
    href: '/visa',
    label: 'Visa Tracker',
    keywords: 'biometrics interview cas i20 filing',
    roles: ['admin', 'counsellor'],
    icon: icon(<path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />),
  },
  {
    href: '/documents',
    label: 'Documents',
    keywords: 'passport transcripts uploads verification',
    roles: ['admin', 'counsellor'],
    icon: icon(<path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />),
  },
  {
    href: '/finance',
    label: 'Finance',
    keywords: 'payments invoices fees money',
    roles: ['admin'],
    icon: icon(<>
      <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
    </>),
  },
  {
    href: '/reports',
    label: 'Reports',
    keywords: 'analytics charts export',
    roles: ['admin'],
    icon: icon(<path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />),
  },
  {
    href: '/members',
    label: 'Members',
    keywords: 'team staff users accounts roles permissions invite',
    roles: ['admin'],
    icon: icon(<path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a5.97 5.97 0 00-.941-3.223A3 3 0 0119 15v2h-6.07zM6 11a5.97 5.97 0 00-1.941.777A3 3 0 001 15v2h10v-2a5.97 5.97 0 00-.941-3.223A5.98 5.98 0 006 11z" />),
  },

  /* Reachable from the header menu and the palette, but not the sidebar. */
  {
    href: '/profile',
    label: 'Profile',
    keywords: 'account me password security preferences settings',
    hidden: true,
    icon: icon(<path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />),
  },
  {
    href: '/notifications',
    label: 'Notifications',
    keywords: 'alerts bell updates',
    hidden: true,
    icon: icon(<path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />),
  },
];

/** Nav entries the given role may actually open. */
export const navFor = (role: UserRole | undefined) =>
  NAV_ITEMS.filter((i) => !i.roles || (role && i.roles.includes(role)));

/** Sidebar entries only — `hidden` items live in the header menu. */
export const sidebarFor = (role: UserRole | undefined) =>
  navFor(role).filter((i) => !i.hidden);

/**
 * Labels for path segments the registry does not cover — mostly record ids,
 * which the breadcrumb replaces with a readable name once the page has it.
 */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  students: 'Students',
  chat: 'Chat',
  applications: 'Applications',
  visa: 'Visa Tracker',
  documents: 'Documents',
  finance: 'Finance',
  reports: 'Reports',
  members: 'Members',
  profile: 'Profile',
  notifications: 'Notifications',
};

export interface Crumb { label: string; href?: string }

/**
 * `/students/abc123` → Students → abc123. Mongo ids are opaque, so a page that
 * knows the record's name passes it in as `tail` to replace the last crumb.
 */
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
