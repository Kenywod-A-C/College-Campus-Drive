import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, setAccessToken } from '../http';
import * as real from '../real';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
const call = (i = -1) => ({ url: fetchMock.mock.calls.at(i)![0] as string, init: fetchMock.mock.calls.at(i)![1] as RequestInit & { headers: Record<string, string> } });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { cookie: 'csrf_refresh_token=c1' });
  vi.stubGlobal('window', { dispatchEvent: () => true });
  setAccessToken(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('real services → REST endpoints', () => {
  it('login posts credentials without auth, stores only the in-memory token and returns {user, permissions}', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: { user: { id: '1', role: 'student' }, permissions: [], accessToken: 'jwt', expiresIn: 900 } }));
    const res = await real.authApi.login('a@b.c', 'pw', true);
    expect(call().url).toBe('/api/v1/auth/login');
    expect(JSON.parse(call().init.body as string)).toEqual({ identifier: 'a@b.c', password: 'pw', remember: true });
    expect(res).toEqual({ user: { id: '1', role: 'student' }, permissions: [] });
    expect(res).not.toHaveProperty('accessToken');
    expect(getAccessToken()).toBe('jwt');
  });
  it('me() restores the session via refresh, then GET /auth/me; returns null when there is no session', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { user: {}, permissions: [], accessToken: 'jwt2', expiresIn: 900 } }))
      .mockResolvedValueOnce(json(200, { data: { user: { id: '9' }, permissions: ['x'] } }));
    expect(await real.authApi.me()).toEqual({ user: { id: '9' }, permissions: ['x'] });
    expect(call(0).url).toBe('/api/v1/auth/refresh');
    expect(call(1).url).toBe('/api/v1/auth/me');
    setAccessToken(null);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthenticated', message: 'no session' } }));
    expect(await real.authApi.me()).toBeNull();
  });
  it('logout calls the API and clears the token even if the call fails', async () => {
    setAccessToken('jwt');
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(real.authApi.logout()).rejects.toBeTruthy();
    expect(getAccessToken()).toBeNull();
  });
  it('jobs.list omits the UI "all" sentinel and returns the Page shape', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [{ job: { id: '1' } }], meta: { page: 1, pageSize: 9, total: 1, totalPages: 1 } }));
    const p = await real.jobsApi.list({ q: 'zoho', status: 'all', minCgpa: 7.5, page: 1 });
    expect(call().url).toBe('/api/v1/jobs?q=zoho&minCgpa=7.5&page=1');
    expect(p).toMatchObject({ items: [{ job: { id: '1' } }], total: 1, page: 1, pageSize: 9 });
  });
  it('applications.apply posts {jobId}; offers.respond posts {decision}', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: {} }));
    setAccessToken('jwt');
    await real.applicationsApi.apply('12');
    expect(call().url).toBe('/api/v1/applications');
    expect(JSON.parse(call().init.body as string)).toEqual({ jobId: '12' });
    expect(call().init.headers.Authorization).toBe('Bearer jwt');
    await real.offersApi.respond('5', 'accepted');
    expect(call().url).toBe('/api/v1/offers/5/respond');
    expect(JSON.parse(call().init.body as string)).toEqual({ decision: 'accepted' });
  });
  it('companies.list puts meta.industries on the result; save uses PUT for edits and POST for new', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [], meta: { page: 1, pageSize: 10, total: 0, industries: ['IT'] } }));
    expect((await real.companiesApi.list({ industry: '' })).industries).toEqual(['IT']);
    fetchMock.mockImplementation(async () => json(200, { data: { id: '3' } }));
    await real.companiesApi.save({ id: '3', name: 'N', website: 'https://n.example', industry: 'IT', description: '', contactName: '', contactEmail: 'a@b.c', tier: 'regular' });
    expect(call().init.method).toBe('PUT');
    expect(call().url).toBe('/api/v1/companies/3');
  });
});

describe('assistant service → /assistant endpoints', () => {
  const body = (i = -1) => JSON.parse(call(i).init.body as string);
  it('status, suggestions and the conversation list/get/create/delete map to the REST endpoints', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: { available: true, provider: 'anthropic' } }));
    expect(await real.assistantApi.status()).toEqual({ available: true, provider: 'anthropic' });
    expect(call().url).toBe('/api/v1/assistant/status');
    await real.assistantApi.suggestions();
    expect(call().url).toBe('/api/v1/assistant/suggestions');
    await real.assistantApi.list();
    expect(call().url).toBe('/api/v1/assistant/conversations');
    await real.assistantApi.get('12');
    expect(call().url).toBe('/api/v1/assistant/conversations/12');
    await real.assistantApi.create();
    expect([call().init.method, call().url]).toEqual(['POST', '/api/v1/assistant/conversations']);
    await expect(real.assistantApi.remove('12')).resolves.toBeUndefined();
    expect([call().init.method, call().url]).toEqual(['DELETE', '/api/v1/assistant/conversations/12']);
  });
  it('send posts to /assistant/chat with a numeric conversation id, or none to start a new conversation; identity is never sent', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: { id: '12', title: 't', updatedAt: 'x', messages: [] } }));
    await real.assistantApi.send('12', 'hello');
    expect([call().init.method, call().url]).toEqual(['POST', '/api/v1/assistant/chat']);
    expect(body()).toEqual({ conversationId: 12, message: 'hello' });
    await real.assistantApi.send(undefined, 'first message');
    expect(body()).toEqual({ message: 'first message' });
    expect(JSON.stringify(body())).not.toMatch(/role|userId|studentId|permission/i);
  });
  it('surfaces the API error envelope (e.g. 503 not configured) as an ApiError with its code', async () => {
    fetchMock.mockImplementation(async () => json(503, { error: { code: 'assistant_unavailable', message: 'The AI assistant is not configured yet.' } }));
    await expect(real.assistantApi.send(undefined, 'hi')).rejects.toMatchObject({ status: 503, code: 'assistant_unavailable', message: 'The AI assistant is not configured yet.' });
  });
  it('resolveAction confirms or rejects the action by its id, then returns the refreshed conversation', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: { id: '12', title: 't', updatedAt: 'x', messages: [] } }));
    await real.assistantApi.resolveAction('12', '7', true);
    expect([call(-2).init.method, call(-2).url]).toEqual(['POST', '/api/v1/assistant/actions/7/confirm']);
    expect(call().url).toBe('/api/v1/assistant/conversations/12');
    await real.assistantApi.resolveAction('12', '7', false);
    expect(call(-2).url).toBe('/api/v1/assistant/actions/7/reject');
  });
  it('chat is allowed far longer than the default 30 s (several model rounds) but is not unbounded', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => rej(new Error('aborted'))); }));
      const outcome = real.assistantApi.send(undefined, 'slow').then(() => 'resolved', (e: { code?: string }) => e.code);
      await vi.advanceTimersByTimeAsync(31_000);
      const early = await Promise.race([outcome, Promise.resolve('still waiting')]);
      expect(early).toBe('still waiting'); // a default request would already have been aborted here
      await vi.advanceTimersByTimeAsync(95_000);
      expect(await outcome).toBe('network_error');
    } finally { vi.useRealTimers(); }
  });
  it('does not answer 501 any more: it really calls the server', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [] }));
    await real.assistantApi.list();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('endpoints the backend does not provide yet', () => {
  it('reject with 501 not_implemented and never touch the network', async () => {
    await expect(real.adminApi.settings()).rejects.toMatchObject({ status: 501, code: 'not_implemented' });
    await expect(real.adminApi.saveSettings({ collegeName: 'x' })).rejects.toMatchObject({ status: 501 });
    await expect(real.documentsApi.list()).rejects.toMatchObject({ status: 501 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
