// The single typed HTTP client for the gateway. Components never call fetch directly.
import { apiBaseUrl } from './config';
import type { ApiErrorBody } from './types';

/** Error thrown for every failed request, carrying the server's error code and message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[];
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

// The access token lives in memory only, never in storage, so a script injected into the page
// later cannot read an old one from storage. The auth context sets it after login and refresh.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Called once when a request is refused with 401. It should get a new access token (refresh) and
 * answer true if it did. The auth context registers it; the client itself knows nothing about
 * refresh tokens.
 */
let onUnauthorized: (() => Promise<boolean>) | null = null;

export function setUnauthorizedHandler(handler: (() => Promise<boolean>) | null): void {
  onUnauthorized = handler;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** For the auth endpoints themselves: a 401 there must not trigger another refresh. */
  skipRefresh?: boolean;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function send(method: HttpMethod, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server',
      details: [],
    });
  }
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await send(method, path, options);

  // An expired access token: refresh once and repeat the request with the new token.
  if (response.status === 401 && !options.skipRefresh && accessToken && onUnauthorized) {
    if (await onUnauthorized()) {
      response = await send(method, path, options);
    }
  }

  const payload = await parseJson(response);

  if (!response.ok) {
    if (isApiErrorBody(payload)) throw new ApiError(response.status, payload.error);
    throw new ApiError(response.status, {
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      details: [],
    });
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};
