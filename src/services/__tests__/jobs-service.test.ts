import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../http';
import * as real from '../real';
import type { JobInput } from '../contracts/jobs';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
const call = (i = -1) => ({ url: fetchMock.mock.calls.at(i)![0] as string, init: fetchMock.mock.calls.at(i)![1] as RequestInit & { headers: Record<string, string> } });
const body = () => JSON.parse(call().init.body as string);

const input: JobInput = {
  companyId: '3', title: 'SDE', domain: 'Software', location: 'Chennai', type: 'Full-time', description: '', responsibilities: [], skills: ['Go'],
  eligibility: { minCgpa: 7, maxActiveArrears: 0, departmentIds: ['1'], graduationYears: [2027], requiredSkills: [] }, rounds: [{ id: 'r1', name: 'OA', mode: 'Online' }],
  openDate: '2030-01-01T00:00:00.000Z', deadline: '2030-02-01T00:00:00.000Z', status: 'draft',
};

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async () => json(200, { data: { id: '9' } }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal('window', { dispatchEvent: () => true });
  setAccessToken('jwt');
});
afterEach(() => vi.unstubAllGlobals());

describe('job management service → REST', () => {
  it('a new job is POST /jobs; the body never contains an id', async () => {
    await real.jobsApi.save(input);
    expect(call().init.method).toBe('POST');
    expect(call().url).toBe('/api/v1/jobs');
    expect(body()).not.toHaveProperty('id');
    expect(body().companyId).toBe('3');
  });
  it('an edit is PUT /jobs/:id with the id only in the URL (so a body id can never redirect the write)', async () => {
    await real.jobsApi.save({ ...input, id: '42' });
    expect(call().init.method).toBe('PUT');
    expect(call().url).toBe('/api/v1/jobs/42');
    expect(body()).not.toHaveProperty('id');
  });
  it('sends the bearer token for staff calls', async () => {
    await real.jobsApi.save(input);
    expect(call().init.headers.Authorization).toBe('Bearer jwt');
  });
  it('setStatus posts {status, reason}; an empty reason is omitted', async () => {
    await real.jobsApi.setStatus('5', 'cancelled', 'Company froze hiring');
    expect(call().url).toBe('/api/v1/jobs/5/status');
    expect(body()).toEqual({ status: 'cancelled', reason: 'Company froze hiring' });
    await real.jobsApi.setStatus('5', 'draft', '');
    expect(body()).toEqual({ status: 'draft' }); // unpublish
  });
  it('archive / restore post {archived}', async () => {
    await real.jobsApi.archive('5', true);
    expect(call().url).toBe('/api/v1/jobs/5/archive');
    expect(body()).toEqual({ archived: true });
    await real.jobsApi.archive('5', false);
    expect(body()).toEqual({ archived: false });
  });
  it('drive details are GET /jobs/:id/drive', async () => {
    await real.jobsApi.drive('7');
    expect(call().init.method).toBe('GET');
    expect(call().url).toBe('/api/v1/jobs/7/drive');
  });
  it('ids are URL-encoded so a crafted id cannot change the path', async () => {
    await real.jobsApi.setStatus('1/../../users', 'closed');
    expect(call().url).toBe('/api/v1/jobs/1%2F..%2F..%2Fusers/status');
  });
  it('the list passes the archived filter and drops the UI-only status "all"', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 1 } }));
    await real.jobsApi.list({ status: 'all', archived: 'only', q: 'sde' });
    expect(call().url).toBe('/api/v1/jobs?archived=only&q=sde');
  });
  it('company archive posts {archived}; the company list passes the filter and returns industries', async () => {
    await real.companiesApi.archive('3', true);
    expect(call().url).toBe('/api/v1/companies/3/archive');
    expect(body()).toEqual({ archived: true });
    fetchMock.mockImplementation(async () => json(200, { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 1, industries: ['SaaS'] } }));
    const page = await real.companiesApi.list({ archived: 'include' });
    expect(call().url).toBe('/api/v1/companies?archived=include');
    expect(page.industries).toEqual(['SaaS']);
  });
  it('server rejections surface as ApiError with the server message and details', async () => {
    fetchMock.mockImplementation(async () => json(409, { error: { code: 'conflict', message: 'This job already has 2 application(s), so it cannot be unpublished. Close it instead.' } }));
    await expect(real.jobsApi.setStatus('5', 'draft')).rejects.toMatchObject({ status: 409, code: 'conflict', message: expect.stringContaining('Close it instead') });
    fetchMock.mockImplementation(async () => json(422, { error: { code: 'validation_error', message: 'deadline: Value error', details: { deadline: ['Value error'] } } }));
    await expect(real.jobsApi.save(input)).rejects.toMatchObject({ status: 422, details: { deadline: ['Value error'] } });
  });
});
