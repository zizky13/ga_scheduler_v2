import { create } from 'zustand';
import api, { setAccessToken, setOnSessionExpired, ApiRequestError } from '../lib/api';

export type UserRole = 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface LoginResponse {
  user: { id: number; email: string; fullName: string; role: string };
  accessToken: string;
  expiresIn: number;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  sessionExpired: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser, accessToken: string, expiresIn?: number) => void;
  clearAuth: () => void;
}

function mapUser(raw: LoginResponse['user']): AuthUser {
  return {
    id: String(raw.id),
    name: raw.fullName,
    email: raw.email,
    role: raw.role.toUpperCase() as UserRole,
  };
}

export const useAuthStore = create<AuthState>((set) => {
  const clearAuth = () => {
    setAccessToken(null);
    set({ user: null, isAuthenticated: false, sessionExpired: false });
  };

  setOnSessionExpired(() => {
    set({ sessionExpired: true });
  });

  return {
    user: null,
    isAuthenticated: false,
    loading: false,
    sessionExpired: false,

    login: async (email, password) => {
      set({ loading: true });
      try {
        const res = await api.post<LoginResponse>('/auth/login', { email, password });
        const data = res.data;
        setAccessToken(data.accessToken, data.expiresIn);
        set({
          user: mapUser(data.user),
          isAuthenticated: true,
          loading: false,
          sessionExpired: false,
        });
      } catch (err) {
        set({ loading: false });
        throw err;
      }
    },

    logout: async () => {
      try {
        await api.post('/auth/logout');
      } catch {
        // best-effort; clear local state regardless
      }
      setAccessToken(null);
      set({ user: null, isAuthenticated: false, sessionExpired: false });
    },

    setUser: (user, accessToken, expiresIn) => {
      setAccessToken(accessToken, expiresIn);
      set({ user, isAuthenticated: true, sessionExpired: false });
    },

    clearAuth,
  };
});

export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'INVALID_CREDENTIALS') return 'Invalid email or password.';
    if (err.code === 'ACCOUNT_DISABLED') return 'This account has been disabled.';
    if (err.status === 429) return 'Too many login attempts. Please try again later.';
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
