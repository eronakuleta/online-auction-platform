import { createContext, useContext } from 'react';
import type { Role, User } from '../api/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  /** "loading" only at startup, while a saved session is being restored. */
  status: AuthStatus;
  user: User | null;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; displayName: string }): Promise<void>;
  logout(): Promise<void>;
  /** True if the user has at least one of the roles. Only for the UI: the server checks again. */
  hasRole(...roles: Role[]): boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}
