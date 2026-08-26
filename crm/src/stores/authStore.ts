import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { allows } from '@/lib/access';
import type { AccessSnapshot, Action, User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  /** What this account may do. */
  access: AccessSnapshot | null;
  isLoading: boolean;
  setAuth: (user: User, token: string, access?: AccessSnapshot | null) => void;
  setAccess: (access: AccessSnapshot | null) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      access: null,
      isLoading: false,
      setAuth: (user, token, access = null) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('crm_token', token);
        }
        set({ user, token, ...(access ? { access } : {}) });
      },
      setAccess: (access) => set({ access }),
      clearAuth: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('crm_token');
        }
        set({ user: null, token: null, access: null });
      },
      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'crm-auth',
      partialize: (state) => ({ user: state.user, token: state.token, access: state.access }),
    },
  ),
);

/** `usePermission()('leads', 'create')`. Falsy until the snapshot loads. */
export function usePermission() {
  const permissions = useAuthStore((s) => s.access?.permissions);
  return (module: string, action: Action) => allows(permissions, module, action);
}
