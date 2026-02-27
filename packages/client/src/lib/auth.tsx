import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from './api';

interface User {
  id: number;
  email: string;
  role: 'gp' | 'lp';
  name: string;
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string, role?: 'gp' | 'lp') => Promise<User>;
  logout: () => void;
  isGP: boolean;
  isLP: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const ACTIVITY_KEY = 'session_activity_at';
const LOGOUT_BROADCAST_KEY = 'session_logout_at';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function readStoredUser(): User | null {
  const stored = localStorage.getItem('user');
  if (!stored || stored === 'undefined' || stored === 'null') return null;
  try {
    const parsed = JSON.parse(stored) as Partial<User>;
    if (
      typeof parsed?.id === 'number' &&
      typeof parsed?.email === 'string' &&
      (parsed?.role === 'gp' || parsed?.role === 'lp') &&
      typeof parsed?.name === 'string' &&
      (parsed?.mustChangePassword === undefined || typeof parsed?.mustChangePassword === 'boolean')
    ) {
      return parsed as User;
    }
  } catch {
    // Ignore invalid localStorage payloads from older/corrupt sessions.
  }
  localStorage.removeItem('user');
  return null;
}

function readStoredToken(): string | null {
  const stored = localStorage.getItem('token');
  if (!stored || stored === 'undefined' || stored === 'null') return null;
  return stored;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [token, setToken] = useState<string | null>(readStoredToken);

  const login = async (email: string, password: string, role?: 'gp' | 'lp') => {
    const { data } = await api.post('/auth/login', { email, password, role });
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    return data.user as User;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.setItem(LOGOUT_BROADCAST_KEY, String(Date.now()));
  };

  useEffect(() => {
    const bumpActivity = () => {
      if (!token) return;
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOGOUT_BROADCAST_KEY && e.newValue) {
        setToken(null);
        setUser(null);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
      if (e.key === 'token' && !e.newValue) {
        setToken(null);
        setUser(null);
      }
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    for (const ev of events) window.addEventListener(ev, bumpActivity, { passive: true });
    window.addEventListener('storage', onStorage);
    bumpActivity();

    const interval = window.setInterval(() => {
      if (!token) return;
      const last = Number(localStorage.getItem(ACTIVITY_KEY) || Date.now());
      if (Date.now() - last > IDLE_TIMEOUT_MS) {
        logout();
      }
    }, 30_000);

    return () => {
      for (const ev of events) window.removeEventListener(ev, bumpActivity);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(interval);
    };
  }, [token]);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      isGP: user?.role === 'gp',
      isLP: user?.role === 'lp',
      isAuthenticated: !!token,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
