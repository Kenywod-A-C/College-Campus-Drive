import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/types';
import { buildQuery, getAccessToken, http, refreshSession, request, setAccessToken } from '../http';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = { user: { id: '1' }, permissions: [], accessToken: 'tok-2', expiresIn: 900 };

let fetchMock: ReturnType<typeof vi.fn>;
let dispatched: string[];
const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };

beforeEach(() => {
  fetchMock = vi.fn();
  dispatched = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { cookie: 'other=1; csrf_refresh_token=csrf-abc' });
  vi.stubGlobal('window', { dispatchEvent: (e: Event) => dispatched.push(e.type) });
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  Object.values(storage).forEach((f) => f.mockClear());
  setAccessToken(null);
});
afterEach(() => vi.unstubAllGlobals());

const lastInit = (i = -1) => fetchMock.mock.calls.at(i)![1] as RequestInit & { headers: Record<string, string> };
const lastUrl = (i = -1) => fetchMock.mock.calls.at(i)![0] as string;

describe('buildQuery', () => {
  it('drops undefined, null and empty values and encodes the rest', () => {
    expect(buildQuery({ q: 'a b', dept: undefined, minCgpa: 0, page: 2, status: '', x: null, flag: false })).toBe('?q=a+b&minCgpa=0&page=2&flag=false');
  });
  it('repeats keys for arrays and returns "" when nothing is left', () => {
    expect(buildQuery({ tag: ['a', 'b'] })).toBe('?tag=a&tag=b');
    expect(buildQuery({ a: undefined })).toBe('');
    expect(buildQuery()).toBe('');
  });
});

describe('envelopes', () => {
  it('unwraps {data}', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: { hello: 'world' } }));
    expect(await http.get('/x')).toEqual({ hello: 'world' });
    expect(lastUrl()).toBe('/api/v1/x');
    expect(lastInit().credentials).toBe('include');
  });
  it('converts {data, meta} into the Page shape and keeps extra meta', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [1, 2], meta: { page: 2, pageSize: 2, total: 5, totalPages: 3, industries: ['IT'] } }));
    const p = await http.page<number>('/companies', { page: 2 });
    expect(p).toMatchObject({ items: [1, 2], total: 5, page: 2, pageSize: 2, meta: { industries: ['IT'] } });
    expect(lastUrl()).toBe('/api/v1/companies?page=2');
  });
  it('rejects a 200 without a data envelope', async () => {
    fetchMock.mockImplementation(async () => json(200, { nope: 1 }));
    await expect(http.get('/x')).rejects.toMatchObject({ status: 502, code: 'bad_response' });
  });
  it('sends JSON bodies with a content type', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: { ok: true } }));
    await http.post('/jobs/1/save', { a: 1 });
    expect(lastInit().body).toBe('{"a":1}');
    expect(lastInit().headers['Content-Type']).toBe('application/json');
  });
});

describe('error mapping', () => {
  it('maps {error:{code,message,details}} onto ApiError', async () => {
    fetchMock.mockImplementation(async () => json(422, { error: { code: 'validation_error', message: 'Invalid', details: { title: ['required'] } } }));
    const err = await http.post('/jobs', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, message: 'Invalid', code: 'validation_error', details: { title: ['required'] } });
  });
  it('gives a friendly message for non-JSON 5xx responses without leaking internals', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>Traceback ...</html>', { status: 502 }));
    const err = (await http.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 502, code: 'server_error' });
    expect(err.message).not.toMatch(/Traceback|html/i);
  });
  it('maps network failures to status 0 / network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(http.get('/x')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
  it('does not try to refresh when an unauthenticated call (login) fails with 401', async () => {
    fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthenticated', message: 'Bad credentials' } }));
    await expect(http.post('/auth/login', {}, false)).rejects.toMatchObject({ status: 401, message: 'Bad credentials' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatched).toEqual([]);
  });
});

describe('401 → silent refresh → retry', () => {
  it('refreshes once with the CSRF header, then retries with the new token', async () => {
    setAccessToken('tok-1');
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'unauthenticated', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { data: tokens }))
      .mockResolvedValueOnce(json(200, { data: { ok: 1 } }));
    expect(await http.get('/jobs')).toEqual({ ok: 1 });
    expect(lastUrl(1)).toBe('/api/v1/auth/refresh');
    expect(lastInit(1).headers['X-CSRF-TOKEN']).toBe('csrf-abc');
    expect(lastInit(1).headers.Authorization).toBeUndefined();
    expect(lastInit(2).headers.Authorization).toBe('Bearer tok-2');
    expect(getAccessToken()).toBe('tok-2');
  });
  it('shares one refresh between concurrent 401s (refresh tokens rotate)', async () => {
    setAccessToken('old');
    fetchMock.mockImplementation(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
      if (url.endsWith('/auth/refresh')) { await new Promise((r) => setTimeout(r, 10)); return json(200, { data: tokens }); }
      return init.headers.Authorization === 'Bearer tok-2' ? json(200, { data: 'ok' }) : json(401, { error: { code: 'unauthenticated', message: 'expired' } });
    });
    const [a, b] = await Promise.all([http.get('/a'), http.get('/b')]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))).toHaveLength(1);
  });
  it('signals ca:unauthorized and throws when the refresh fails', async () => {
    setAccessToken('old');
    fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthenticated', message: 'expired' } }));
    await expect(request('GET', '/jobs')).rejects.toMatchObject({ status: 401 });
    expect(dispatched).toContain('ca:unauthorized');
    expect(getAccessToken()).toBeNull();
  });
  it('does not even call the server when there is no CSRF cookie (no session to restore)', async () => {
    vi.stubGlobal('document', { cookie: 'other=1' });
    expect(await refreshSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // ...and that "no" must not be cached: once a login sets the cookie, refreshing works again.
    vi.stubGlobal('document', { cookie: 'csrf_refresh_token=csrf-abc' });
    fetchMock.mockImplementation(async () => json(200, { data: tokens }));
    expect((await refreshSession())?.accessToken).toBe('tok-2');
  });
  it('refreshSession returns null (no event) when there is no session cookie', async () => {
    fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthenticated', message: 'no cookie' } }));
    expect(await refreshSession()).toBeNull();
    expect(dispatched).toEqual([]);
  });
});

describe('token handling', () => {
  it('keeps the access token in memory only', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: tokens }));
    await refreshSession();
    expect(getAccessToken()).toBe('tok-2');
    for (const f of Object.values(storage)) expect(f).not.toHaveBeenCalled();
  });
});
