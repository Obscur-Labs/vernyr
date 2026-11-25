import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudentUser } from '@/types';

interface AuthState {
  user: StudentUser | null;
  token: string | null;
  studentId: string | null;
  isLoading: boolean;
  setAuth: (user: StudentUser, token: string, studentId?: string) => void;
  setStudentId: (id: string) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      studentId: null,
      isLoading: false,
      setAuth: (user, token, studentId) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('student_token', token);
        }
        set({ user, token, studentId: studentId ?? null });
      },
      setStudentId: (studentId) => set({ studentId }),
      clearAuth: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('student_token');
        }
        set({ user: null, token: null, studentId: null });
      },
      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'student-auth',
      partialize: (state) => ({ user: state.user, token: state.token, studentId: state.studentId }),
    }
  )
);
