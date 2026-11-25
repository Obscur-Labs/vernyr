'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';
interface ThemeCtx { theme: Theme; toggle: () => void; }

const ThemeContext = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  // With no saved choice, follow the device. Someone reading at night has
  // usually already told their phone that; making them find a toggle in the
  // sidebar first means one screenful of glare before they get there.
  useEffect(() => {
    const saved = localStorage.getItem('student-theme') as Theme | null;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const resolved: Theme = saved ?? (prefersDark ? 'dark' : 'light');
    setTheme(resolved);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('student-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
