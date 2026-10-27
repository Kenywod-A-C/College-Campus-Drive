import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../http';
import * as real from '../real';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const meta = (total = 1, over: Record<string, unknown> = {}) => ({ page: 1, pageSize: 10, total, totalPages: 1, ...over });
let fetchMock: ReturnType<typeof vi.fn>;
const call = (i = -1) => ({ url: fetchMock.mock.calls.at(i)![0] as string, init: fetchMock.mock.calls.at(i)![1] as RequestInit & { headers: Record<string, string> } });
const body = (i = -1) => JSON.parse(call(i).init.body as string);

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', { cookie: 'csrf_refresh_token=c1' });
  vi.stubGlobal('window', { dispatchEvent: () => true });
  setAccessToken('jwt');
});
afterEach(() => vi.unstubAllGlobals());

const reply = (data: unknown, m?: unknown) => fetchMock.mockImplementation(async () => json(200, m ? { data, meta: m } : { data }));

describe('applications (staff)', () => {
  it('listAll sends server-side filters, drops the "all" sentinel and returns the Page shape', async () => {
    reply([{ application: { id: '1' } }], meta(25, { pageSize: 10, totalPages: 3 }));
    const p = await real.applicationsApi.listAll({ status: 'all', companyId: '3', eligibility: 'eligible', sort: 'cgpa', page: 2, pageSize: 10, q: 'ann' });
    expect(call().url).toBe('/api/v1/applications?companyId=3&eligibility=eligible&sort=cgpa&page=2&pageSize=10&q=ann');
    expect(call().init.method).toBe('GET');
    expect(p).toEqual({ items: [{ application: { id: '1' } }], total: 25, page: 1, pageSize: 10 });
  });
  it('updateStage posts numeric ids, the stage, the note and the exception', async () => {
    reply({ updated: ['1'], failed: [{ id: '2', reason: 'already rejected' }] });
    const r = await real.applicationsApi.updateStage(['1', '2'], 'shortlisted', 'good', { reason: 'HOD approved', approvedBy: 'Dr. Rao' });
    expect(call().url).toBe('/api/v1/applications/stage');
    expect(body()).toEqual({ ids: [1, 2], status: 'shortlisted', note: 'good', exception: { reason: 'HOD approved', approvedBy: 'Dr. Rao' } });
    expect(r.failed[0].reason).toBe('already rejected');
    await real.applicationsApi.updateStage(['3'], 'rejected');
    expect(body()).toEqual({ ids: [3], status: 'rejected' });
  });
  it('exportCsv returns the CSV text from the envelope', async () => {
    reply('"a","b"\n');
    expect(await real.applicationsApi.exportCsv({ status: 'applied', dept: '2' })).toBe('"a","b"\n');
    expect(call().url).toBe('/api/v1/applications/export?status=applied&dept=2');
  });
  it('surfaces a 403 as an ApiError with the server message', async () => {
    fetchMock.mockImplementation(async () => json(403, { error: { code: 'forbidden', message: 'You do not have permission to do this.' } }));
    await expect(real.applicationsApi.listAll()).rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'You do not have permission to do this.' });
  });
});

describe('offers (placement cell)', () => {
  it('listAll maps meta summaries into the OfferList shape', async () => {
    reply([{ offer: { id: '1' } }], meta(31, { pageSize: 10, byDept: [{ dept: 'CSE', offers: 3, placed: 2, students: 9 }], byCompany: [], totals: { offers: 31, accepted: 12, placed: 11 }, selectedWithoutOffer: [{ application: { id: '9' } }] }));
    const r = await real.offersApi.listAll({ status: 'all', q: 'zoho', page: 3, pageSize: 10 });
    expect(call().url).toBe('/api/v1/offers?q=zoho&page=3&pageSize=10');
    expect(r).toMatchObject({ rows: [{ offer: { id: '1' } }], total: 31, totals: { offers: 31, accepted: 12, placed: 11 }, byDept: [{ dept: 'CSE' }], selectedWithoutOffer: [{ application: { id: '9' } }] });
  });
  it('listAll tolerates a response without summaries', async () => {
    reply([], meta(0));
    expect(await real.offersApi.listAll()).toMatchObject({ rows: [], total: 0, byDept: [], byCompany: [], selectedWithoutOffer: [], totals: { offers: 0, accepted: 0, placed: 0 } });
  });
  it('create and setStatus post to the staff endpoints (never to /respond)', async () => {
    reply({ offer: { id: '5' } });
    await real.offersApi.create('12', 8.5, '2026-12-01T00:00:00.000Z');
    expect(call().url).toBe('/api/v1/offers');
    expect(body()).toEqual({ applicationId: 12, ctcLpa: 8.5, acceptBy: '2026-12-01T00:00:00.000Z' });
    await real.offersApi.setStatus('5', 'withdrawn', 'Company rescinded');
    expect(call().url).toBe('/api/v1/offers/5/status');
    expect(body()).toEqual({ status: 'withdrawn', reason: 'Company rescinded' });
    await real.offersApi.setStatus('5', 'accepted');
    expect(body()).toEqual({ status: 'accepted' });
  });
  it('a 409 policy refusal reaches the caller with its message', async () => {
    fetchMock.mockImplementation(async () => json(409, { error: { code: 'conflict', message: 'Policy check failed: 2 of 2 accepted offers used.' } }));
    await expect(real.offersApi.create('1', 5, '2030-01-01T00:00:00Z')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Policy check failed') });
  });
});

describe('interviews', () => {
  it('list walks every server page (the server caps a page at 100)', async () => {
    const mk = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ interview: { id: String(from + i) } }));
    fetchMock
      .mockResolvedValueOnce(json(200, { data: mk(100, 0), meta: meta(150, { pageSize: 100, totalPages: 2 }) }))
      .mockResolvedValueOnce(json(200, { data: mk(50, 100), meta: meta(150, { page: 2, pageSize: 100, totalPages: 2 }) }));
    const all = await real.interviewsApi.list();
    expect(all).toHaveLength(150);
    expect(call(0).url).toBe('/api/v1/interviews?page=1&pageSize=100');
    expect(call(1).url).toBe('/api/v1/interviews?page=2&pageSize=100');
  });
  it('list stops on an empty page instead of looping', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [], meta: meta(5, { pageSize: 100 }) }));
    expect(await real.interviewsApi.list()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('save creates with POST and edits with PUT; ids become numbers', async () => {
    reply({ interview: { id: '3' } });
    const input = { jobId: '7', applicationIds: ['1', '2'], round: 'Technical', at: '2030-01-01T10:00:00.000Z', durationMins: 45, location: 'Room 4' };
    await real.interviewsApi.save(input);
    expect(call().init.method).toBe('POST');
    expect(call().url).toBe('/api/v1/interviews');
    expect(body()).toEqual({ ...input, jobId: 7, applicationIds: [1, 2] });
    await real.interviewsApi.save({ ...input, id: '3' });
    expect(call().init.method).toBe('PUT');
    expect(call().url).toBe('/api/v1/interviews/3');
    expect(body()).not.toHaveProperty('id');
  });
  it('setStatus and notify hit their endpoints', async () => {
    reply({ notified: 2 });
    await real.interviewsApi.setStatus('3', 'no_show');
    expect(call().url).toBe('/api/v1/interviews/3/status');
    expect(body()).toEqual({ status: 'no_show' });
    expect(await real.interviewsApi.notify('3')).toEqual({ notified: 2 });
    expect(call().url).toBe('/api/v1/interviews/3/notify');
  });
});

describe('users (administrator)', () => {
  it('list omits "all" sentinels and returns a Page', async () => {
    reply([{ id: '1' }], meta(40));
    const p = await real.usersApi.list({ q: 'ann', role: 'all', status: 'all', dept: '2', page: 2 });
    expect(call().url).toBe('/api/v1/users?q=ann&dept=2&page=2');
    expect(p).toMatchObject({ items: [{ id: '1' }], total: 40 });
  });
  it('save never sends a status or password and maps the department to a number', async () => {
    reply({ id: '9' });
    await real.usersApi.save({ name: 'Dr. Rao', email: 'rao@college.edu', userCode: 'FAC9', role: 'faculty', departmentId: '3', status: 'active' });
    expect(call().init.method).toBe('POST');
    expect(call().url).toBe('/api/v1/users');
    expect(body()).toEqual({ name: 'Dr. Rao', email: 'rao@college.edu', userCode: 'FAC9', role: 'faculty', departmentId: 3 });
    await real.usersApi.save({ id: '9', name: 'Dr. Rao', email: 'rao@college.edu', userCode: 'FAC9', role: 'admin' });
    expect(call().init.method).toBe('PUT');
    expect(call().url).toBe('/api/v1/users/9');
    expect(body()).toEqual({ name: 'Dr. Rao', email: 'rao@college.edu', userCode: 'FAC9', role: 'admin', departmentId: null });
  });
  it('setStatus, resetPassword and importStudents call the right endpoints', async () => {
    reply({ ok: 1 });
    await real.usersApi.setStatus('9', 'inactive');
    expect(call().url).toBe('/api/v1/users/9/status');
    expect(body()).toEqual({ status: 'inactive' });
    await real.usersApi.resetPassword('9');
    expect(call().url).toBe('/api/v1/users/9/reset-password');
    const rows = [{ studentCode: '1', name: 'A', email: 'a@b.co', departmentCode: 'CSE', graduationYear: '2027' }];
    await real.usersApi.importStudents(rows);
    expect(call().url).toBe('/api/v1/users/import');
    expect(body()).toEqual({ rows });
  });
});

describe('admin configuration', () => {
  it('roles and setPermission use the role name in the path and send {enabled}', async () => {
    reply({ matrix: {} });
    await real.adminApi.roles();
    expect(call().url).toBe('/api/v1/admin/roles');
    reply(['reports.view']);
    await real.adminApi.setPermission('faculty', 'reports.view', false);
    expect(call().init.method).toBe('PUT');
    expect(call().url).toBe('/api/v1/admin/roles/faculty/permissions/reports.view');
    expect(body()).toEqual({ enabled: false });
  });
  it('policies: create = POST, edit = PUT without the id in the body, delete sends the reason in a JSON body', async () => {
    reply({ id: '1' });
    const p = { name: 'Cap', description: '', kind: 'max_offers' as const, scope: 'college' as const, params: { maxAcceptedOffers: 2 }, enabled: true };
    await real.adminApi.savePolicy(p);
    expect([call().init.method, call().url]).toEqual(['POST', '/api/v1/admin/policies']);
    await real.adminApi.savePolicy({ ...p, id: '4' });
    expect([call().init.method, call().url]).toEqual(['PUT', '/api/v1/admin/policies/4']);
    expect(body()).toEqual(p);
    await real.adminApi.deletePolicy('4', 'Superseded');
    expect([call().init.method, call().url]).toEqual(['DELETE', '/api/v1/admin/policies/4']);
    expect(body()).toEqual({ reason: 'Superseded' });
    expect(call().init.headers['Content-Type']).toBe('application/json');
  });
  it('departments, courses and academic years use REST verbs and numeric department ids', async () => {
    reply({});
    await real.adminApi.saveDepartment({ code: 'BIO', name: 'Biotech', headName: '' });
    expect([call().init.method, call().url]).toEqual(['POST', '/api/v1/admin/departments']);
    await real.adminApi.saveDepartment({ id: '8', code: 'BIO', name: 'Biotech', headName: 'Dr. X' });
    expect([call().init.method, call().url]).toEqual(['PUT', '/api/v1/admin/departments/8']);
    await real.adminApi.deleteDepartment('8');
    expect([call().init.method, call().url]).toEqual(['DELETE', '/api/v1/admin/departments/8']);
    await real.adminApi.saveCourse({ code: 'C1', name: 'Prog', degree: 'M.E.', departmentId: '8', durationYears: 2 });
    expect(body()).toEqual({ code: 'C1', name: 'Prog', degree: 'M.E.', departmentId: 8, durationYears: 2 });
    await real.adminApi.deleteCourse('2');
    expect(call().url).toBe('/api/v1/admin/courses/2');
    await real.adminApi.saveAcademicYear({ label: '2028-29', graduationYear: 2029, active: true });
    expect([call().init.method, call().url]).toEqual(['POST', '/api/v1/admin/academic-years']);
    await real.adminApi.saveAcademicYear({ id: '3', label: '2028-29', graduationYear: 2029, active: false });
    expect([call().init.method, call().url]).toEqual(['PUT', '/api/v1/admin/academic-years/3']);
  });
  it('auditLogs sends the filters, the date range as "from"/"to", and returns the action list', async () => {
    reply([{ id: '1' }], meta(3, { pageSize: 12, actions: ['auth', 'job'] }));
    const r = await real.adminApi.auditLogs({ actor: 'ann', result: 'all', from: '2026-01-01', to: '2026-02-01', page: 2 });
    expect(call().url).toBe('/api/v1/admin/audit-logs?actor=ann&from=2026-01-01&to=2026-02-01&page=2');
    expect(r).toEqual({ items: [{ id: '1' }], total: 3, page: 1, pageSize: 12, actions: ['auth', 'job'] });
  });
  it('a 403 from a config endpoint is an ApiError the UI can render as "Permission denied"', async () => {
    fetchMock.mockImplementation(async () => json(403, { error: { code: 'forbidden', message: 'You do not have permission to do this.' } }));
    for (const fn of [() => real.adminApi.policies(), () => real.adminApi.academic(), () => real.adminApi.roles(), () => real.adminApi.auditLogs()]) {
      await expect(fn()).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('reports', () => {
  it('placement and export send filters without the "all" sentinels', async () => {
    reply({ kpis: {} });
    await real.reportsApi.placement({ academicYear: '2027', dept: '2', appStatus: 'all', offerStatus: 'accepted' });
    expect(call().url).toBe('/api/v1/reports/placement?academicYear=2027&dept=2&offerStatus=accepted');
    reply('"x"\n');
    expect(await real.reportsApi.exportPlacementCsv({ companyId: '4' })).toBe('"x"\n');
    expect(call().url).toBe('/api/v1/reports/placement/export.csv?companyId=4');
  });
});
