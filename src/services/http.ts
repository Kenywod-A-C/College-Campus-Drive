// Fetch wrapper for the Flask REST API. Conventions: docs/API_CONVENTIONS.md
//  - JSON + camelCase keys, string IDs
//  - success `{data}` / `{data, meta}`, failure `{error:{code,message,details}}`
//  - access token (JWT) lives in MEMORY ONLY; the refresh token is an httpOnly cookie the browser sends itself
import { ApiError } from '@/types';
import { API_BASE_URL } from './config';

export interface Meta { page?: number; pageSize?: number; total?: number; totalPages?: number; [extra: string]: unknown }
export interface Envelope<T> { data: T; meta?: Meta }
export interface AuthTokens { user: import('@/types').User; permissions: import('@/types').Permission[]; accessToken: string; expiresIn: number }

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

const TIMEOUT_MS = 30_000;
const NOT_REACHABLE = 'Cannot reach the server. Check your connection and try again.';

export type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

/** Serialises a query object, dropping undefined / null / empty values. */
export function buildQuery(query?: Query): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function toError(status: number, body: unknown): ApiError {
  const e = (body as { error?: { code?: string; message?: string; details?: Record<string, string[]> } } | undefined)?.error;
  if (e?.message) return new ApiError(status, e.message, e.code, e.details);
  if (status >= 500) return new ApiError(status, 'The server ran into a problem. Please try again shortly.', 'server_error');
  return new ApiError(status, `Request failed (${status}).`);
}

interface RawOptions { query?: Query; body?: unknown; auth?: boolean; headers?: Record<string, string>; timeoutMs?: number }

async function send(method: string, path: string, opts: RawOptions): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}${path}${buildQuery(opts.query)}`, {
      method, headers, credentials: 'include', signal: ctrl.signal,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { status: res.status, body: await parse(res) };
  } catch {
    throw new ApiError(0, NOT_REACHABLE, 'network_error');
  } finally {
    clearTimeout(timer);
  }
}

// Single-flight silent refresh: concurrent 401s share one /auth/refresh call (refresh tokens rotate on use).
let refreshing: Promise<AuthTokens | null> | null = null;

async function doRefresh(): Promise<AuthTokens | null> {
  // No CSRF cookie means there is no session to restore (login sets it, logout clears it): skip the doomed request.
  if (!readCookie('csrf_refresh_token')) return null;
  try {
    const { status, body } = await send('POST', '/auth/refresh', { auth: false, headers: { 'X-CSRF-TOKEN': readCookie('csrf_refresh_token') } });
    const tokens = (body as Envelope<AuthTokens> | undefined)?.data;
    if (status !== 200 || !tokens?.accessToken) { accessToken = null; return null; }
    accessToken = tokens.accessToken;
    return tokens;
  } catch {
    return null;
  }
}

export function refreshSession(): Promise<AuthTokens | null> {
  // The slot is cleared by .finally() on the promise itself: clearing it inside the async body would run BEFORE
  // the assignment on the synchronous early-return path and leave a stale result cached forever.
  refreshing ??= doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

export async function request<T>(method: string, path: string, opts: RawOptions = {}): Promise<Envelope<T>> {
  let r = await send(method, path, opts);
  if (r.status === 401 && opts.auth !== false) {
    if (await refreshSession()) r = await send(method, path, opts);
    if (r.status === 401) {
      accessToken = null;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('ca:unauthorized'));
    }
  }
  if (r.status < 200 || r.status >= 300) throw toError(r.status, r.body);
  const env = r.body as Envelope<T> | undefined;
  if (!env || !('data' in env)) throw new ApiError(502, 'The server sent an unexpected response.', 'bad_response');
  return env;
}

/** Convenience helpers returning the unwrapped `data`. */
export const http = {
  get: <T>(path: string, query?: Query, auth?: boolean) => request<T>('GET', path, { query, auth }).then((e) => e.data),
  post: <T>(path: string, body?: unknown, auth?: boolean) => request<T>('POST', path, { body: body ?? {}, auth }).then((e) => e.data),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }).then((e) => e.data),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }).then((e) => e.data),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }).then((e) => e.data),
  /** Paginated GET: `{data, meta}` → `{items, total, page, pageSize}` plus any extra meta keys. */
  page: async <T>(path: string, query?: Query) => {
    const { data, meta = {} } = await request<T[]>('GET', path, { query });
    const { page = 1, pageSize = data.length, total = data.length, ...extra } = meta;
    return { items: data, total, page, pageSize, meta: extra as Record<string, unknown> };
  },
};
