'use client';
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; message: string; type: ToastType; }
interface ToastCtx { toast: (message: string, type?: ToastType) => void; }
const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const COLOR: Record<ToastType, string> = {
    success: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400',
    error:   'bg-red-500/15 border-red-500/25 text-red-400',
    warning: 'bg-amber-500/15 border-amber-500/25 text-amber-400',
    info:    'bg-indigo-500/15 border-indigo-500/25 text-indigo-400',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          // The tint sits on an opaque panel: on its own it is 15% colour over
          // whatever the page happens to be showing, which reads as see-through.
          <div
            key={t.id}
            className="overlay-panel animate-toast-in pointer-events-auto max-w-xs overflow-hidden rounded-xl"
          >
            <div className={`border-l-2 px-4 py-3 text-sm font-medium ${COLOR[t.type]}`}>
              {t.message}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
