// auth-service endpoints (docs/requirements.md FR-01). Typed wrappers around the one API client.
import { apiClient } from './client';

export type Role = 'BIDDER' | 'SELLER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'BANNED';
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface LoginResponse extends TokenResponse {
  user: User;
}

// The auth endpoints answer 401 for bad credentials or an old refresh token. That must never start
// another refresh, so they all skip it.
const noRefresh = { skipRefresh: true };

export const authApi = {
  register: (input: { email: string; password: string; displayName: string }) =>
    apiClient.post<User>('/auth/register', input, noRefresh),
  login: (input: { email: string; password: string }) =>
    apiClient.post<LoginResponse>('/auth/login', input, noRefresh),
  refresh: (refreshToken: string) =>
    apiClient.post<TokenResponse>('/auth/refresh', { refreshToken }, noRefresh),
  logout: (refreshToken: string) =>
    apiClient.post<undefined>('/auth/logout', { refreshToken }, noRefresh),
  me: () => apiClient.get<User>('/users/me'),
};
