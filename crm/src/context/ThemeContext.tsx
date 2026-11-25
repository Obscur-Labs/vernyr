'use client';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  /** True on /dev, where the theme is pinned and `toggle` does nothing. */
  locked: boolean;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'dark',
  toggle: () => {},
  locked: false,
});

/** The dev console is dark-only, so it opts out of the light theme entirely. */
const isThemeLocked = (pathname: string | null) => !!pathname?.startsWith('/dev');

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locked = isThemeLocked(pathname);

  const [theme, setTheme] = useState<Theme>('dark');

  // Restore the persisted preference on mount.
  useEffect(() => {
    const saved = localStorage.getItem('crm-theme') as Theme | null;
    if (saved) setTheme(saved);
    // The accent used to be switchable and wrote `data-palette` here. The CRM
    // has one colour now, so clear the attribute a previous build may have left
    // on the element — a stale `data-palette` matches nothing but is confusing
    // to find in the inspector.
    document.documentElement.removeAttribute('data-palette');
    localStorage.removeItem('crm-palette');
  }, []);

  // Single owner of the `light` class: applying it here rather than at each call
  // site means a locked route cannot lose a race with whoever toggled last.
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light' && !locked);
  }, [theme, locked]);

  const toggle = () => {
    if (locked) return;
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('crm-theme', next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle, locked }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
