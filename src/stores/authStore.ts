import { create } from 'zustand';
import { apiFetch, setToken, clearToken } from '../api/http';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  avatar?: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  isAdmin: () => boolean;
  loadMe: () => Promise<void>;
}

function readStored(): { token: string | null; user: AuthUser | null } {
  try {
    const t = localStorage.getItem('token');
    const u = localStorage.getItem('user');
    return { token: t, user: u ? (JSON.parse(u) as AuthUser) : null };
  } catch {
    return { token: null, user: null };
  }
}

const stored = readStored();

export const useAuthStore = create<AuthState>((set, get) => ({
  token: stored.token,
  user: stored.user,

  setAuth: (token, user) => {
    setToken(token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user });
  },

  logout: () => {
    clearToken();
    set({ token: null, user: null });
  },

  isAdmin: () => get().user?.role === 'admin',

  loadMe: async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const user = (await res.json()) as AuthUser;
        localStorage.setItem('user', JSON.stringify(user));
        set({ user });
      }
    } catch {
      // 忽略
    }
  },
}));
