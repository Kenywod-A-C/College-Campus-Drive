// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  adminApi: { academic: vi.fn(), saveDepartment: vi.fn(), deleteDepartment: vi.fn(), saveCourse: vi.fn(), deleteCourse: vi.fn(), saveAcademicYear: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { AdminDepartments } from '../Departments';

const overview = () => ({
  departments: [
    { id: '1', code: 'CSE', name: 'Computer Science', headName: 'Dr. Rao', students: 120, courses: 2 },
    { id: '2', code: 'MECH', name: 'Mechanical', headName: '', students: 0, courses: 0 },
  ],
  courses: [{ id: 'c1', code: 'BE-CSE', name: 'B.E. Computer Science', degree: 'B.E.' as const, departmentId: '1', durationYears: 4 }],
  academicYears: [{ id: 'y1', label: '2026-27', graduationYear: 2027, active: true }, { id: 'y2', label: '2025-26', graduationYear: 2026, active: false }],
});
const render = () => renderPage(<AdminDepartments />, { base: '/admin' });
const tab = async (name: string) => userEvent.click(await screen.findByRole('tab', { name }));
const dialog = (name: string) => screen.findByRole('dialog', { name });

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('admin'), permissions: [] });
  api.adminApi.academic.mockResolvedValue(overview());
});

describe('academic overview', () => {
  it('renders departments, then courses and academic years from adminApi.academic()', async () => {
    render();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    const cse = (await screen.findByText('Computer Science')).closest('tr')!;
    expect(within(cse).getByText('CSE')).toBeInTheDocument();
    expect(within(cse).getByText('Dr. Rao')).toBeInTheDocument();
    expect(within(cse).getByText('120')).toBeInTheDocument();
    expect(within(screen.getByText('Mechanical').closest('tr')!).getByText('—')).toBeInTheDocument(); // no head recorded

    await tab('Degree programs & courses');
    const course = (await screen.findByText('B.E. Computer Science')).closest('tr')!;
    expect(within(course).getByText('BE-CSE')).toBeInTheDocument();
    expect(within(course).getByText('CSE')).toBeInTheDocument(); // department code resolved
    expect(within(course).getByText('4 yrs')).toBeInTheDocument();

    await tab('Academic years & batches');
    expect(within((await screen.findByText('2026-27')).closest('tr')!).getByText('Current')).toBeInTheDocument();
    expect(within(screen.getByText('2025-26').closest('tr')!).getByText('Not current')).toBeInTheDocument();
  });

  it('shows empty states when nothing is configured', async () => {
    api.adminApi.academic.mockResolvedValue({ departments: [], courses: [], academicYears: [] });
    render();
    expect(await screen.findByText('No departments')).toBeInTheDocument();
    await tab('Degree programs & courses');
    expect(await screen.findByText('No programs')).toBeInTheDocument();
  });

  it('403 renders permission-denied; 501 renders not-available; 500 Retry reloads', async () => {
    api.adminApi.academic.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const a = render();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    a.unmount();
    api.adminApi.academic.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    const b = render();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    b.unmount();
    api.adminApi.academic.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Computer Science')).toBeInTheDocument();
  });
});

describe('deleting', () => {
  it('a department that is still in use (409) shows the server message to the admin and stays listed', async () => {
    api.adminApi.deleteDepartment.mockRejectedValue(new ApiError(409, 'Department CSE is still in use by 120 students and 2 programs.', 'conflict'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete CSE' }));
    const dlg = await dialog('Delete department?');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.adminApi.deleteDepartment).toHaveBeenCalledWith('1'));
    expect(await within(dlg).findByText('Department CSE is still in use by 120 students and 2 programs.')).toBeInTheDocument();
    expect(screen.queryByText('Department deleted')).not.toBeInTheDocument();
    expect(api.adminApi.academic).toHaveBeenCalledTimes(1); // no refresh, nothing changed
  });

  it('an unused department is deleted after confirmation and the overview reloads', async () => {
    api.adminApi.deleteDepartment.mockResolvedValue({ ok: true });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete MECH' }));
    const dlg = await dialog('Delete department?');
    expect(within(dlg).getByText('MECH — Mechanical')).toBeInTheDocument();
    expect(api.adminApi.deleteDepartment).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.adminApi.deleteDepartment).toHaveBeenCalledWith('2'));
    expect(await screen.findByText('Department deleted')).toBeInTheDocument();
    await waitFor(() => expect(api.adminApi.academic).toHaveBeenCalledTimes(2));
  });

  it('deleting a program calls deleteCourse; a 409 is shown in the dialog', async () => {
    api.adminApi.deleteCourse.mockRejectedValueOnce(new ApiError(409, 'Program BE-CSE is still in use.', 'conflict')).mockResolvedValueOnce({ ok: true });
    render();
    await tab('Degree programs & courses');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete BE-CSE' }));
    const dlg = await dialog('Delete program?');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    expect(await within(dlg).findByText('Program BE-CSE is still in use.')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.adminApi.deleteCourse).toHaveBeenCalledTimes(2));
    expect(api.adminApi.deleteCourse).toHaveBeenLastCalledWith('c1');
    expect(await screen.findByText('Program deleted')).toBeInTheDocument();
  });
});

describe('create / edit dialogs', () => {
  it('department: code and name are required; payload is trimmed; a 409 duplicate is shown in the dialog', async () => {
    api.adminApi.saveDepartment.mockRejectedValueOnce(new ApiError(409, 'A department with code ECE already exists.', 'conflict')).mockResolvedValueOnce({ id: '9', code: 'ECE', name: 'Electronics', headName: '' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Add department' }));
    const dlg = await dialog('Add department');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Code is required')).toBeInTheDocument();
    expect(within(dlg).getByText('Name is required')).toBeInTheDocument();
    expect(api.adminApi.saveDepartment).not.toHaveBeenCalled();

    await userEvent.type(within(dlg).getByLabelText('Code'), ' ECE ');
    await userEvent.type(within(dlg).getByLabelText('Department name'), 'Electronics');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('A department with code ECE already exists.')).toBeInTheDocument();
    expect(api.adminApi.saveDepartment).toHaveBeenLastCalledWith({ id: undefined, code: 'ECE', name: 'Electronics', headName: '' });

    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' })); // retry succeeds
    expect(await screen.findByText('Department saved')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add department' })).not.toBeInTheDocument());
    expect(api.adminApi.academic).toHaveBeenCalledTimes(2);
  });

  it('editing a department pre-fills the form and sends its id', async () => {
    api.adminApi.saveDepartment.mockResolvedValue({ id: '1', code: 'CSE', name: 'Computer Science & Engg', headName: 'Dr. Rao' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit CSE' }));
    const dlg = await dialog('Edit department');
    expect(within(dlg).getByLabelText('Head of department')).toHaveValue('Dr. Rao');
    await userEvent.clear(within(dlg).getByLabelText('Department name'));
    await userEvent.type(within(dlg).getByLabelText('Department name'), 'Computer Science & Engg');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.adminApi.saveDepartment).toHaveBeenCalledWith({ id: '1', code: 'CSE', name: 'Computer Science & Engg', headName: 'Dr. Rao' }));
  });

  it('program: requires a department and a 1-6 year duration, then sends the typed payload', async () => {
    api.adminApi.saveCourse.mockResolvedValue({ id: 'c9' });
    render();
    await tab('Degree programs & courses');
    await userEvent.click(await screen.findByRole('button', { name: 'Add program' }));
    const dlg = await dialog('Add degree program');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Code is required')).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText('Course code'), 'MBA-GEN');
    await userEvent.type(within(dlg).getByLabelText('Program name'), 'MBA General');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Choose a department.')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByLabelText('Department'));
    await userEvent.click(await screen.findByRole('option', { name: 'MECH — Mechanical' }));
    await userEvent.clear(within(dlg).getByLabelText('Duration (years)'));
    await userEvent.type(within(dlg).getByLabelText('Duration (years)'), '7');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Duration must be 1–6 years.')).toBeInTheDocument();
    expect(api.adminApi.saveCourse).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByLabelText('Degree'));
    await userEvent.click(await screen.findByRole('option', { name: 'MBA' }));
    await userEvent.clear(within(dlg).getByLabelText('Duration (years)'));
    await userEvent.type(within(dlg).getByLabelText('Duration (years)'), '2');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.adminApi.saveCourse).toHaveBeenCalledWith({ id: undefined, code: 'MBA-GEN', name: 'MBA General', degree: 'MBA', departmentId: '2', durationYears: 2 }));
    expect(await screen.findByText('Program saved')).toBeInTheDocument();
  });

  it('academic year: label must look like 2026-27; payload has a numeric graduation year and the active flag', async () => {
    api.adminApi.saveAcademicYear.mockResolvedValue([]);
    render();
    await tab('Academic years & batches');
    await userEvent.click(await screen.findByRole('button', { name: 'Add academic year' }));
    const dlg = await dialog('Add academic year');
    await userEvent.type(within(dlg).getByLabelText('Academic year'), '2027/28');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Use the format 2026-27')).toBeInTheDocument();
    expect(api.adminApi.saveAcademicYear).not.toHaveBeenCalled();
    await userEvent.clear(within(dlg).getByLabelText('Academic year'));
    await userEvent.type(within(dlg).getByLabelText('Academic year'), '2027-28');
    await userEvent.clear(within(dlg).getByLabelText('Graduation year (batch)'));
    await userEvent.type(within(dlg).getByLabelText('Graduation year (batch)'), '2028');
    await userEvent.click(within(dlg).getByLabelText(/Current academic year/));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.adminApi.saveAcademicYear).toHaveBeenCalledWith({ id: undefined, label: '2027-28', graduationYear: 2028, active: true }));
    expect(await screen.findByText('Academic year saved')).toBeInTheDocument();
  });
});
