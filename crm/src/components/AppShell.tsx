'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { Header } from '@/components/Header';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { sidebarFor, isSection, type NavItem, type NavLeaf } from '@/lib/navigation';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { BreadcrumbProvider } from '@/context/BreadcrumbContext';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import type { AccessSnapshot, Notification } from '@/types';
import { apiOrigin } from '@/lib/config';

const FOLD_KEY = 'crm_sidebar_folded';
const OPEN_KEY = 'crm_sidebar_sections';

/** `/portal-accounts?role=student` -> `/portal-accounts`. */
const pathOf = (href: string) => href.split('?')[0];

/** One sidebar row — a leaf, or a whole section when the rail is folded. */
function NavRow({
  href, label, icon, active, folded, onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  folded: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={folded ? label : undefined}
      className={cn(
        'hig-press relative flex h-11 items-center rounded-xl text-[15px] font-medium',
        folded ? 'justify-center px-0' : 'gap-3 px-3',
        active ? 'bg-accent/15 text-accent' : 'text-t2 hover:bg-muted hover:text-t1',
      )}
    >
      <span className={cn('flex shrink-0 items-center', active ? 'text-accent' : 'text-t3')}>{icon}</span>
      {!folded && <span className="hig-fold-label flex-1 truncate">{label}</span>}
    </Link>
  );
}

/** A child row — inset, dot-marked, quieter than its parent. */
function SubRow({ item, active, onNavigate }: { item: NavLeaf; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'hig-press relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-[14px]',
        active ? 'font-semibold text-accent' : 'font-medium text-t2 hover:bg-muted hover:text-t1',
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full transition-opacity"
        style={{
          background: active ? 'var(--color-accent)' : 'var(--color-t3)',
          opacity: active ? 1 : 0.45,
        }}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

interface SidebarProps {
  items: NavItem[];
  pathname: string;
  folded: boolean;
  openSections: string[];
  onOpenSections: (values: string[]) => void;
  onNavigate: () => void;
}

/**
 * The sidebar.
 *
 * Sections are a Radix accordion in `multiple` mode: more than one can stand
 * open, Radix owns the height animation and the `aria-expanded`/`aria-controls`
 * pairing, and the open set is lifted here so it can be persisted and so the
 * section holding the current page can open itself.
 *
 * Folded, the rail is 68px and has no room for a disclosure, so each section
 * collapses to a single link to its first page.
 */
function Sidebar({ items, pathname, folded, openSections, onOpenSections, onNavigate }: SidebarProps) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="flex h-full flex-col">
      {/* Brand — the same height as the toolbar, so the two share one baseline. */}
      <div
        className={cn(
          'flex h-[var(--chrome-h)] shrink-0 items-center border-b border-line',
          folded ? 'justify-center px-0' : 'px-5',
        )}
      >
        <Link
          href="/dashboard"
          aria-label="Vernyr - go to dashboard"
          className="hig-press flex items-center rounded-lg text-t1"
        >
          {folded ? <VernyrMark className="h-7 w-7" /> : <Wordmark className="text-[19px]" />}
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        <Accordion
          type="multiple"
          value={folded ? [] : openSections}
          onValueChange={onOpenSections}
          className="space-y-1"
        >
          {items.map((item) => {
            if (!isSection(item)) {
              return (
                <NavRow
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href)}
                  folded={folded}
                  onNavigate={onNavigate}
                />
              );
            }

            const inSection = item.children.some(
              (c) => pathname === pathOf(c.href) || pathname.startsWith(pathOf(c.href) + '/'),
            );

            if (folded) {
              return (
                <NavRow
                  key={item.label}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={inSection}
                  folded
                  onNavigate={onNavigate}
                />
              );
            }

            const open = openSections.includes(item.label);

            return (
              <AccordionItem key={item.label} value={item.label}>
                <AccordionTrigger
                  className={cn(
                    'h-11 text-[15px] font-medium',
                    // Closed but current: the row itself carries the highlight,
                    // because the active child inside it is not visible.
                    inSection && !open ? 'bg-accent/10 text-accent' : 'text-t2 hover:bg-muted hover:text-t1',
                  )}
                >
                  <span className={cn('flex shrink-0 items-center', inSection ? 'text-accent' : 'text-t3')}>
                    {item.icon}
                  </span>
                  <span className="hig-fold-label truncate">{item.label}</span>
                </AccordionTrigger>

                <AccordionContent>
                  {/* The rail lines the children up under the parent's icon. */}
                  <div className="ml-[22px] space-y-0.5 border-l border-line pl-2.5">
                    {item.children.map((child) => (
                      <SubRow
                        key={child.href}
                        item={child}
                        active={pathname === pathOf(child.href)}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, access, setAccess } = useAuthStore();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const { open: palette, setOpen: setPalette } = useCommandPalette();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const visibleNav = useMemo(() => sidebarFor(access?.permissions), [access?.permissions]);

  const [openSections, setOpenSections] = useState<string[]>([]);

  // Restore the fold and the section state after hydration. Reading
  // localStorage during render would make server and client markup disagree.
  useEffect(() => {
    setFolded(localStorage.getItem(FOLD_KEY) === '1');
    try {
      const stored = localStorage.getItem(OPEN_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) setOpenSections(parsed.filter((v): v is string => typeof v === 'string'));
    } catch { /* a corrupt entry just means every section starts closed */ }
  }, []);

  // Whichever section holds the current page opens itself, so a deep link or a
  // ⌘K jump never lands with its own section collapsed.
  useEffect(() => {
    const owner = visibleNav.find(
      (item) => isSection(item) && item.children.some((c) => pathname === pathOf(c.href) || pathname.startsWith(pathOf(c.href) + '/')),
    );
    if (!owner) return;
    setOpenSections((prev) => (prev.includes(owner.label) ? prev : [...prev, owner.label]));
  }, [pathname, visibleNav]);

  /** Radix hands back the whole open set; persist it as it is. */
  const handleOpenSections = useCallback((values: string[]) => {
    setOpenSections(values);
    localStorage.setItem(OPEN_KEY, JSON.stringify(values));
  }, []);

  const toggleFold = useCallback(() => {
    setFolded((v) => {
      localStorage.setItem(FOLD_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // ⌘\ folds the sidebar — the Finder / Xcode binding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleFold();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFold]);

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (!token) router.push('/login');
  }, [router]);

  // Refresh the seat on boot. The persisted copy is what draws the first paint;
  // this is what catches a permission changed while the tab was closed.
  useEffect(() => {
    if (!user) return;
    api.get<AccessSnapshot>('/access/me')
      .then((r) => setAccess(r.data))
      .catch(() => {});
  }, [user, setAccess]);

  // Close the mobile drawer on navigation — otherwise it covers the page it
  // just opened.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const loadNotifications = useCallback(() => {
    api.get<Notification[]>('/notifications?limit=100')
      .then((r) => setNotifications(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    loadNotifications();
  }, [user, pathname, loadNotifications]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('crm_token');
    const socket = io(apiOrigin, { auth: { token } });
    socketRef.current = socket;
    socket.on('notification', (n: Notification) => {
      setNotifications((prev) => [n, ...prev.filter((p) => p._id !== n._id)]);
      toast(`New notification: ${n.title}`, 'info');
    });
    return () => { socket.disconnect(); };
  }, [user, toast]);

  /** The header's panel acts on notifications; the shell owns the list. */
  const actOnNotifications = useCallback(
    async (action: 'read' | 'unread' | 'delete', ids: string[]) => {
      if (!ids.length) return;
      setNotifications((prev) => {
        if (action === 'delete') return prev.filter((n) => !ids.includes(n._id));
        return prev.map((n) => (ids.includes(n._id) ? { ...n, read: action === 'read' } : n));
      });
      try {
        await api.post('/notifications/bulk', { action, ids });
      } catch {
        toast('Could not update notifications', 'error');
        loadNotifications();
      }
    },
    [toast, loadNotifications],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-base">
      {/* Desktop sidebar */}
      <aside
        className="hig-fold hig-sidebar hidden shrink-0 flex-col border-r border-line lg:flex"
        style={{ width: folded ? 'var(--sidebar-w-fold)' : 'var(--sidebar-w)' }}
      >
        <Sidebar
          items={visibleNav}
          pathname={pathname}
          folded={folded}
          openSections={openSections}
          onOpenSections={handleOpenSections}
          onNavigate={() => {}}
        />
      </aside>

      {/* Mobile drawer */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-md transition-opacity duration-300 lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{ transitionTimingFunction: 'var(--ease-out)' }}
      />
      <aside
        className={`hig-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line transition-transform duration-300 lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ transitionTimingFunction: 'var(--ease-out)' }}
        aria-hidden={!mobileOpen}
      >
        <Sidebar
          items={visibleNav}
          pathname={pathname}
          folded={false}
          openSections={openSections}
          onOpenSections={handleOpenSections}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      <BreadcrumbProvider>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header
            onOpenSearch={() => setPalette(true)}
            onOpenMenu={() => setMobileOpen(true)}
            onToggleFold={toggleFold}
            folded={folded}
            notifications={notifications}
            unreadCount={unreadCount}
            onNotificationAction={actOnNotifications}
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </BreadcrumbProvider>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
