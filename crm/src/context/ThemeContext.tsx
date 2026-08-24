'use client';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme   = 'dark' | 'light';
export type Palette = 'indigo' | 'violet' | 'emerald' | 'rose' | 'amber' | 'sky';

interface ThemeCtx {
  theme:      Theme;
  toggle:     () => void;
  palette:    Palette;
  setPalette: (p: Palette) => void;
  /** True on /dev, where the theme is pinned and `toggle` does nothing. */
  locked:     boolean;
}

const ThemeContext = createContext<ThemeCtx>({
  theme:      'dark',
  toggle:     () => {},
  palette:    'indigo',
  setPalette: () => {},
  locked:     false,
});

/** The dev console is dark-only, so it opts out of the light theme entirely. */
const isThemeLocked = (pathname: string | null) => !!pathname?.startsWith('/dev');

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locked   = isThemeLocked(pathname);

  const [theme,   setTheme]        = useState<Theme>('dark');
  const [palette, setPaletteState] = useState<Palette>('indigo');

  // Restore persisted preferences on mount
  useEffect(() => {
    const savedTheme   = localStorage.getItem('crm-theme')   as Theme   | null;
    const savedPalette = localStorage.getItem('crm-palette') as Palette | null;

    if (savedTheme) setTheme(savedTheme);
    if (savedPalette) {
      setPaletteState(savedPalette);
      document.documentElement.setAttribute('data-palette', savedPalette);
    }
  }, []);

  // Single owner of the `light` class: applying it here rather than at each call
  // site means a locked route cannot lose a race with whoever toggled last.
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light' && !locked);
  }, [theme, locked]);

  const toggle = () => {
    if (locked) return;
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('crm-theme', next);
      return next;
    });
  };

  const setPalette = (p: Palette) => {
    setPaletteState(p);
    localStorage.setItem('crm-palette', p);
    document.documentElement.setAttribute('data-palette', p);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle, palette, setPalette, locked }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
