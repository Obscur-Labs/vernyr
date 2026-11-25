'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

const ToastContext = createContext<{ toast: (msg: string, type?: ToastType) => void }>({
  toast: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);

  const icons: Record<ToastType, string> = {
    success: '✓',
    error:   '✕',
    info:    'ℹ',
  };
  const colors: Record<ToastType, string> = {
    success: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
    error:   'bg-red-500/10 border-red-500/25 text-red-300',
    info:    'bg-sky-500/10 border-sky-500/25 text-sky-300',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 pointer-events-none md:bottom-4">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`animate-toast-in flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium shadow-xl ${colors[t.type]}`}
          >
            <span className="text-base leading-none">{icons[t.type]}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
