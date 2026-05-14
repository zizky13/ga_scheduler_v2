import { create } from 'zustand';

export type UserRole = 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: { id: '1', name: 'Admin User', email: 'admin@upj.ac.id', role: 'ADMIN' },
  isAuthenticated: true,
  login: (user) => set({ user, isAuthenticated: true }),
  logout: () => set({ user: null, isAuthenticated: false }),
}));
