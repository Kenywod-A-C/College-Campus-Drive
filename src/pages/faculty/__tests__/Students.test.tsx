// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { StudentRow } from '@/types/views';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  studentsApi: { list: vi.fn(), get: vi.fn(), verifyCgpa: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyStudents } from '../Students';
import { FacultyStudentDetail } from '../StudentDetail';

const row = (over: Partial<StudentRow> = {}): StudentRow => ({
  id: '7', userId: '70', studentCode: '23CSE001', name: 'Ann Alpha', email: 'ann@campus.test', departmentId: '1', degree: 'B.E.', currentYear: 4, graduationYear: 2027,
  academic: { cgpa: 9.1, cgpaVerified: true, activeArrears: 0, arrearHistory: 0 }, skills: ['Python', 'React'], interests: [], preferredRoles: [], profileCompletion: 90,
  placementStatus: 'unplaced', applicationCount: 2, offerCount: 0, ...over,
});
const page = (items: StudentRow[], total = items.length, pageSize = 10) => ({ items, total, page: 1, pageSize });

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: ['students.view'] });
  api.reportsApi.filterOptions.mockResolvedValue({ departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [], companies: [], jobs: [] });
});

describe('student directory page', () => {
  it('shows a skeleton while loading, then the rows from the API', async () => {
    let resolve!: (v: unknown) => void;
    api.studentsApi.list.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage(<FacultyStudents />);
    expect(screen.getByLabelText('Loading table')).toBeInTheDocument();
    resolve(page([row(), row({ id: '8', name: 'Bob Beta', studentCode: '23IT002', academic: { cgpaVerified: false, activeArrears: 0, arrearHistory: 0 }, applicationCount: 0 })], 12, 2));
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bob Beta')).toBeInTheDocument();
    expect(screen.getByText('9.10')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument(); // student without a CGPA
    expect(screen.getByText(/Showing 1–2 of 12/)).toBeInTheDocument();
  });

  it('passes the search text and filters to the server (server-side filtering)', async () => {
    api.studentsApi.list.mockResolvedValue(page([row()]));
    renderPage(<FacultyStudents />);
    await screen.findByText('Ann Alpha');
    await userEvent.type(screen.getByLabelText('Filter by skill'), 'pyth');
    await waitFor(() => expect(api.studentsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ skill: 'pyth', page: 1 })), { timeout: 2000 });
    await userEvent.type(screen.getByLabelText('Search by name, ID or email'), 'ann');
    await waitFor(() => expect(api.studentsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ann', skill: 'pyth' })), { timeout: 2000 });
  });

  it('requests the next page from the server', async () => {
    api.studentsApi.list.mockResolvedValue(page([row()], 25));
    renderPage(<FacultyStudents />);
    await screen.findByText('Ann Alpha');
    await userEvent.click(screen.getByRole('button', { name: /page 2/i }));
    await waitFor(() => expect(api.studentsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('shows the empty state when nothing matches', async () => {
    api.studentsApi.list.mockResolvedValue(page([]));
    renderPage(<FacultyStudents />);
    expect(await screen.findByText('No students match')).toBeInTheDocument();
  });

  it('403 renders permission-denied with the server message and no data', async () => {
    api.studentsApi.list.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderPage(<FacultyStudents />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByText('Ann Alpha')).not.toBeInTheDocument();
  });

  it('501 renders an honest "not available yet" state, not a retry loop', async () => {
    api.studentsApi.list.mockRejectedValue(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    renderPage(<FacultyStudents />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a server error offers Retry, and Retry re-queries', async () => {
    api.studentsApi.list.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error')).mockResolvedValue(page([row()]));
    renderPage(<FacultyStudents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    expect(api.studentsApi.list).toHaveBeenCalledTimes(2);
  });

  it('a network failure is reported, not swallowed', async () => {
    api.studentsApi.list.mockRejectedValue(new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'network_error'));
    renderPage(<FacultyStudents />);
    expect(await screen.findByText('Cannot reach the server. Check your connection and try again.')).toBeInTheDocument();
  });

  it('clicking a row opens that student (base-aware link)', async () => {
    api.studentsApi.list.mockResolvedValue(page([row()]));
    renderPage(<FacultyStudents />, { base: '/admin', path: '/' });  // '/' so the catch-all route can show where we navigated
    await userEvent.click(await screen.findByText('Ann Alpha'));
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
  });
});

describe('student detail page', () => {
  const detail = (student = row({ academic: { cgpa: 8.1, cgpaVerified: false, activeArrears: 0, arrearHistory: 0 } })) => ({ student, applications: [], offers: [] });
  const renderDetail = () => renderPage(<FacultyStudentDetail />, { route: '/faculty/students/7', path: '/faculty/students/:studentId' });

  it('hides the verify action from users without students.edit', async () => {
    api.studentsApi.get.mockResolvedValue(detail());
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Ann Alpha' })).toBeInTheDocument();
    expect(screen.getByText(/awaiting verification/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify CGPA' })).not.toBeInTheDocument();
  });

  it('lets students.edit holders verify, with a confirmation, and refreshes', async () => {
    api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: ['students.view', 'students.edit'] });
    api.studentsApi.get.mockResolvedValue(detail());
    api.studentsApi.verifyCgpa.mockResolvedValue(row());
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify CGPA' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/8\.10/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.studentsApi.verifyCgpa).toHaveBeenCalledWith('7'));
    expect(await screen.findByText('CGPA verified')).toBeInTheDocument();
    await waitFor(() => expect(api.studentsApi.get).toHaveBeenCalledTimes(2));
  });

  it('shows the server error inside the dialog when verification is refused', async () => {
    api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: ['students.view', 'students.edit'] });
    api.studentsApi.get.mockResolvedValue(detail());
    api.studentsApi.verifyCgpa.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify CGPA' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Verify' }));
    expect(await within(screen.getByRole('dialog')).findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByText('CGPA verified')).not.toBeInTheDocument(); // never claims success
  });

  it('404 for an unknown student id', async () => {
    api.studentsApi.get.mockRejectedValue(new ApiError(404, 'Student not found.', 'not_found'));
    renderDetail();
    expect(await screen.findByText('Not found')).toBeInTheDocument();
    expect(screen.getByText('Student not found.')).toBeInTheDocument();
  });

  it('403 when the role lacks students.view', async () => {
    api.studentsApi.get.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderDetail();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('501 is shown honestly', async () => {
    api.studentsApi.get.mockRejectedValue(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    renderDetail();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
  });
});
