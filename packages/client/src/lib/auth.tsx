import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from './api';

interface User {
  id: number;
  email: string;
  role: 'gp' | 'lp';
  name: string;
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

function readStoredUser(): User | null {
  const stored = localStorage.getItem('user');
  if (!stored || stored === 'undefined' || stored === 'null') return null;
  try {
    const parsed = JSON.parse(stored) as Partial<User>;
    if (
      typeof parsed?.id === 'number' &&
      typeof parsed?.email === 'string' &&
      (parsed?.role === 'gp' || parsed?.role === 'lp') &&
      typeof parsed?.name === 'string'
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
  };

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
