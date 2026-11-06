// Holds the logged-in user and keeps the session alive.
// - The access token is kept in memory only (api/client.ts).
// - The refresh token is kept in sessionStorage (CLAUDE.md), so a page reload keeps the session but
//   closing the tab ends it. Trade-off: a script injected into the page (XSS) could read it and use
//   it from anywhere. It is limited by rotation (each token works once) and reuse detection (when the
//   stolen or the real copy is used a second time, the whole session is revoked, A-07). An httpOnly
//   cookie would hide it from scripts, but needs CSRF protection and cookie handling at the gateway.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authApi, type Role, type TokenResponse, type User } from '../api/auth';
import { ApiError, setAccessToken, setUnauthorizedHandler } from '../api/client';
import { AuthContext, type AuthState, type AuthStatus } from '../hooks/useAuth';

const REFRESH_TOKEN_KEY = 'auction.refreshToken';
/** Refresh this long before the access token expires, so requests rarely meet an expired one. */
const REFRESH_MARGIN_SECONDS = 60;

function readRefreshToken(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeRefreshToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    else sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Storage can be blocked (private mode). The session then lasts until the page reloads.
  }
}

// Refresh tokens rotate: each one works once. If two refreshes ran at the same time, the second
// would present a token that was just used, the server would see "reuse" and end the whole session.
// So every caller (startup, the timer, a 401 retry, React StrictMode running effects twice) shares
// the one refresh that is in flight.
let refreshInFlight: Promise<TokenResponse | null> | null = null;

function refreshOnce(): Promise<TokenResponse | null> {
  refreshInFlight ??= (async () => {
    const token = readRefreshToken();
    if (!token) return null;
    try {
      const tokens = await authApi.refresh(token);
      storeRefreshToken(tokens.refreshToken);
      setAccessToken(tokens.accessToken);
      return tokens;
    } catch (error) {
      // 400/401: the token is invalid, expired or revoked, so the session is over. A network error
      // keeps the token, so a later attempt can still succeed.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        storeRefreshToken(null);
        setAccessToken(null);
      }
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>(() =>
    readRefreshToken() ? 'loading' : 'anonymous',
  );
  const [user, setUser] = useState<User | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endSession = useCallback(() => {
    clearTimeout(timer.current);
    storeRefreshToken(null);
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    // Cached answers may contain data only this user may see (for example reserve prices).
    queryClient.clear();
  }, [queryClient]);

  // Plans the next refresh shortly before the access token expires. Roles can change (an admin
  // grants SELLER), and the new token carries them, so the profile is read again afterwards.
  // The timer plans the following refresh through a ref, because a callback cannot name itself.
  const scheduleNext = useRef<(expiresInSeconds: number) => void>(() => undefined);
  const scheduleRefresh = useCallback(
    (expiresInSeconds: number) => {
      clearTimeout(timer.current);
      const delayMs = Math.max(expiresInSeconds - REFRESH_MARGIN_SECONDS, 5) * 1000;
      timer.current = setTimeout(() => {
        void refreshOnce().then(async (tokens) => {
          if (!tokens) {
            endSession();
            return;
          }
          scheduleNext.current(tokens.expiresIn);
          try {
            setUser(await authApi.me());
          } catch {
            // Keep the profile we have; the next request will show any real problem.
          }
        });
      }, delayMs);
    },
    [endSession],
  );
  useEffect(() => {
    scheduleNext.current = scheduleRefresh;
  }, [scheduleRefresh]);

  // Restore a saved session once at startup.
  useEffect(() => {
    if (!readRefreshToken()) return;
    let active = true;
    void (async () => {
      const tokens = await refreshOnce();
      if (!active) return;
      if (!tokens) {
        endSession();
        return;
      }
      scheduleRefresh(tokens.expiresIn);
      try {
        const me = await authApi.me();
        if (!active) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (active) endSession();
      }
    })();
    return () => {
      active = false;
    };
  }, [endSession, scheduleRefresh]);

  // A request answered 401 although we sent a token: it expired early (laptop asleep, clock
  // skew). Refresh once; if that fails too, the session is over.
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      const tokens = await refreshOnce();
      if (!tokens) {
        endSession();
        return false;
      }
      scheduleRefresh(tokens.expiresIn);
      return true;
    });
    return () => setUnauthorizedHandler(null);
  }, [endSession, scheduleRefresh]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login({ email, password });
      storeRefreshToken(result.refreshToken);
      setAccessToken(result.accessToken);
      scheduleRefresh(result.expiresIn);
      queryClient.clear();
      setUser(result.user);
      setStatus('authenticated');
    },
    [queryClient, scheduleRefresh],
  );

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      await authApi.register(input);
      await login(input.email, input.password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    const token = readRefreshToken();
    endSession();
    // Revoke on the server too. The local session is already gone, so a failure changes nothing
    // for the user; the token then simply expires.
    if (token) await authApi.logout(token).catch(() => undefined);
  }, [endSession]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login,
      register,
      logout,
      hasRole: (...roles: Role[]) => !!user && roles.some((role) => user.roles.includes(role)),
    }),
    [status, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
