// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { User } from '@/types';
import { pageOf } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  usersApi: { list: vi.fn(), save: vi.fn(), setStatus: vi.fn(), resetPassword: vi.fn(), importStudents: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { AdminUsers } from '../Users';

const user = (id: string, name: string, over: Partial<User> = {}): User => makeUser('student', { id, name, userCode: `U${id}`, email: `${name.split(' ')[0].toLowerCase()}@campus.test`, ...over });
const ann = user('1', 'Ann Student');
const fay = user('2', 'Fay Faculty', { role: 'faculty', departmentId: '1' });
const ivy = user('3', 'Ivy Inactive', { status: 'inactive' });
const render = () => renderPage(<AdminUsers />, { base: '/admin' });
const row = async (name: string) => (await screen.findByText(name)).closest('tr')!;

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('admin'), permissions: ['users.manage'] });
  api.reportsApi.filterOptions.mockResolvedValue({ departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [], companies: [], jobs: [] });
  api.usersApi.list.mockResolvedValue(pageOf([ann, fay, ivy]));
});

describe('admin users list', () => {
  it('shows a skeleton, then users with role, resolved department and status', async () => {
    let resolve!: (v: unknown) => void;
    api.usersApi.list.mockReturnValue(new Promise((r) => { resolve = r; }));
    render();
    expect(screen.getByLabelText('Loading table')).toBeInTheDocument();
    resolve(pageOf([ann, fay, ivy]));
    const faculty = await row('Fay Faculty');
    expect(within(faculty).getByText('Faculty')).toBeInTheDocument();
    expect(within(faculty).getByText('CSE')).toBeInTheDocument(); // departmentId '1' resolved through filter options
    expect(within(await row('Ivy Inactive')).getByText('Inactive')).toBeInTheDocument();
    expect(api.usersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'all', status: 'all', page: 1 }));
  });

  it('sends search, role, status and department filters to the server', async () => {
    render();
    await screen.findByText('Ann Student');
    await userEvent.click(screen.getByLabelText('Role'));
    await userEvent.click(await screen.findByRole('option', { name: 'Faculty' }));
    await waitFor(() => expect(api.usersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'faculty', page: 1 })));
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Inactive' }));
    await waitFor(() => expect(api.usersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'faculty', status: 'inactive' })));
    await userEvent.click(screen.getByLabelText('Department'));
    await userEvent.click(await screen.findByRole('option', { name: 'CSE' }));
    await waitFor(() => expect(api.usersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ dept: '1' })));
    await userEvent.type(screen.getByLabelText('Search name, email or ID'), 'fay');
    await waitFor(() => expect(api.usersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'fay', role: 'faculty', status: 'inactive', dept: '1' })), { timeout: 2000 });
  });

  it('empty result shows the empty state; 403 shows permission-denied; 501 not-available', async () => {
    api.usersApi.list.mockResolvedValueOnce(pageOf([]));
    const a = render();
    expect(await screen.findByText('No users match')).toBeInTheDocument();
    a.unmount();
    api.usersApi.list.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const b = render();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByText('Ann Student')).not.toBeInTheDocument();
    b.unmount();
    api.usersApi.list.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    render();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
  });
});

describe('create / edit user dialog', () => {
  const openAdd = async () => { render(); await userEvent.click(await screen.findByRole('button', { name: 'Add user' })); return screen.findByRole('dialog', { name: 'Add user' }); };

  it('validates required fields, email format and the faculty department scope without calling the API', async () => {
    const dlg = await openAdd();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create user' }));
    expect(await within(dlg).findByText('Name is required')).toBeInTheDocument();
    expect(within(dlg).getByText('Email is required')).toBeInTheDocument();
    expect(within(dlg).getByText('User ID is required')).toBeInTheDocument();

    await userEvent.type(within(dlg).getByLabelText('Full name'), 'Gina Green');
    await userEvent.type(within(dlg).getByLabelText('College email'), 'gina@campus'); // browser-valid, but fails the app's own x@y.z rule
    await userEvent.type(within(dlg).getByLabelText('User ID / roll number'), 'G1');
    await userEvent.click(within(dlg).getByLabelText('Role'));
    await userEvent.click(await screen.findByRole('option', { name: 'Faculty / Placement Officer' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create user' }));
    expect(await within(dlg).findByText('Enter a valid email address')).toBeInTheDocument();
    expect(within(dlg).getByText('Faculty must be scoped to a department')).toBeInTheDocument();
    expect(api.usersApi.save).not.toHaveBeenCalled();
  });

  it('save is called with the trimmed input, then the dialog closes and the list refreshes', async () => {
    api.usersApi.save.mockResolvedValue(user('9', 'Gina Green'));
    const dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Full name'), '  Gina Green ');
    await userEvent.type(within(dlg).getByLabelText('College email'), 'gina@campus.test');
    await userEvent.type(within(dlg).getByLabelText('User ID / roll number'), 'G1');
    await userEvent.click(within(dlg).getByLabelText('Role'));
    await userEvent.click(await screen.findByRole('option', { name: 'Faculty / Placement Officer' }));
    await userEvent.click(within(dlg).getByLabelText('Department scope'));
    await userEvent.click(await screen.findByRole('option', { name: 'CSE — Computer Science' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(api.usersApi.save).toHaveBeenCalledWith({ id: undefined, name: 'Gina Green', email: 'gina@campus.test', userCode: 'G1', role: 'faculty', departmentId: '1' }));
    expect(await screen.findByText(/User created/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add user' })).not.toBeInTheDocument());
    expect(api.usersApi.list).toHaveBeenCalledTimes(2);
  });

  it('a 409 "already exists" from save is shown in the dialog and the dialog stays open', async () => {
    api.usersApi.save.mockRejectedValue(new ApiError(409, 'A user with this email already exists.', 'conflict'));
    const dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Full name'), 'Gina Green');
    await userEvent.type(within(dlg).getByLabelText('College email'), 'ann@campus.test');
    await userEvent.type(within(dlg).getByLabelText('User ID / roll number'), 'G1');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create user' }));
    expect(await within(dlg).findByText('A user with this email already exists.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add user' })).toBeInTheDocument();
    expect(screen.queryByText(/User created/)).not.toBeInTheDocument();
    expect(api.usersApi.list).toHaveBeenCalledTimes(1);
  });

  it('editing pre-fills the form and sends the user id', async () => {
    api.usersApi.save.mockResolvedValue(fay);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fay Faculty' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit Fay Faculty' });
    expect(within(dlg).getByLabelText('College email')).toHaveValue('fay@campus.test');
    await userEvent.clear(within(dlg).getByLabelText('Full name'));
    await userEvent.type(within(dlg).getByLabelText('Full name'), 'Fay F. Faculty');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.usersApi.save).toHaveBeenCalledWith({ id: '2', name: 'Fay F. Faculty', email: 'fay@campus.test', userCode: 'U2', role: 'faculty', departmentId: '1' }));
    expect(await screen.findByText('User updated')).toBeInTheDocument();
  });
});

describe('status and password reset', () => {
  it('deactivating asks for confirmation, then calls setStatus(id, "inactive") and reports it', async () => {
    api.usersApi.setStatus.mockResolvedValue({ ...ann, status: 'inactive' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ann Student' }));
    const dlg = await screen.findByRole('dialog', { name: 'Deactivate account?' });
    expect(api.usersApi.setStatus).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.usersApi.setStatus).toHaveBeenCalledWith('1', 'inactive'));
    expect(await screen.findByText('Ann Student is now inactive')).toBeInTheDocument();
    await waitFor(() => expect(api.usersApi.list).toHaveBeenCalledTimes(2));
  });

  it('an inactive user is offered Activate, which calls setStatus(id, "active")', async () => {
    api.usersApi.setStatus.mockResolvedValue({ ...ivy, status: 'active' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Activate Ivy Inactive' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Activate account?' })).getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(api.usersApi.setStatus).toHaveBeenCalledWith('3', 'active'));
  });

  it.each([
    ['last administrator', 'You cannot deactivate the last administrator.'],
    ['your own account', 'You cannot deactivate your own account.'],
  ])('a 409 for "%s" is surfaced in the confirm dialog and nothing is reported as changed', async (_n, message) => {
    api.usersApi.setStatus.mockRejectedValue(new ApiError(409, message, 'conflict'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Ann Student' }));
    const dlg = await screen.findByRole('dialog', { name: 'Deactivate account?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dlg).findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Ann Student is now inactive')).not.toBeInTheDocument();
    expect(api.usersApi.list).toHaveBeenCalledTimes(1);
  });

  it('reset password shows the message returned by the server (never a password)', async () => {
    api.usersApi.resetPassword.mockResolvedValue({ message: 'Reset link sent to ann@campus.test.' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password for Ann Student' }));
    const dlg = await screen.findByRole('dialog', { name: 'Send password reset?' });
    expect(within(dlg).getByText('ann@campus.test')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(api.usersApi.resetPassword).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('Reset link sent to ann@campus.test.')).toBeInTheDocument();
  });

  it('a failed reset keeps the dialog open with the error', async () => {
    api.usersApi.resetPassword.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password for Ann Student' }));
    const dlg = await screen.findByRole('dialog', { name: 'Send password reset?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Send reset link' }));
    expect(await within(dlg).findByText('You do not have permission to do this.')).toBeInTheDocument();
  });
});

describe('bulk import dialog', () => {
  const openImport = async () => { render(); await userEvent.click(await screen.findByRole('button', { name: 'Import students' })); return screen.findByRole('dialog', { name: 'Bulk import students' }); };
  const paste = async (dlg: HTMLElement, text: string) => { await userEvent.click(within(dlg).getByLabelText('Or paste CSV rows')); await userEvent.paste(text); };

  it('cannot be submitted empty', async () => {
    const dlg = await openImport();
    expect(within(dlg).getByRole('button', { name: 'Validate & import' })).toBeDisabled();
    expect(api.usersApi.importStudents).not.toHaveBeenCalled();
  });

  it('parses the pasted CSV (header skipped, quotes honoured) and shows per-row errors from ImportResult', async () => {
    api.usersApi.importStudents.mockResolvedValue({ total: 3, imported: 1, errors: [
      { row: 2, field: 'email', message: 'Email is already registered', value: 'dup@campus.test' },
      { row: 3, field: 'cgpa', message: 'CGPA must be between 0 and 10', value: '' },
    ] });
    const dlg = await openImport();
    await paste(dlg, 'studentCode,name,email,departmentCode,graduationYear,cgpa\n23CSE201,"Lee, Amy",amy@campus.test,CSE,2027,8.1\n23CSE202,Dup One,dup@campus.test,CSE,2027,7\n23CSE203,Bad Cgpa,bad@campus.test,CSE,2027,11');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Validate & import' }));
    await waitFor(() => expect(api.usersApi.importStudents).toHaveBeenCalledWith([
      { studentCode: '23CSE201', name: 'Lee, Amy', email: 'amy@campus.test', departmentCode: 'CSE', graduationYear: '2027', cgpa: '8.1' },
      { studentCode: '23CSE202', name: 'Dup One', email: 'dup@campus.test', departmentCode: 'CSE', graduationYear: '2027', cgpa: '7' },
      { studentCode: '23CSE203', name: 'Bad Cgpa', email: 'bad@campus.test', departmentCode: 'CSE', graduationYear: '2027', cgpa: '11' },
    ]));
    const summary = await within(dlg).findByText(/validation error\(s\) found/);
    expect(summary).toHaveTextContent('Imported 1 of 3 row(s). 2 validation error(s) found.');
    const table = within(dlg).getByRole('table', { name: 'Import validation errors' });
    const first = within(table).getByText('Email is already registered').closest('tr')!;
    expect(within(first).getByText('2')).toBeInTheDocument();
    expect(within(first).getByText('email')).toBeInTheDocument();
    expect(within(first).getByText('dup@campus.test')).toBeInTheDocument();
    expect(within(table).getByText('CGPA must be between 0 and 10').closest('tr')).toHaveTextContent('—'); // empty value
    expect(within(dlg).getByRole('button', { name: 'Download error report' })).toBeInTheDocument();
    // the successfully imported row means the list is refreshed once the dialog is closed
    await userEvent.click(within(dlg).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.usersApi.list).toHaveBeenCalledTimes(2));
  });

  it('a request failure (403) is shown in the dialog and no result is claimed', async () => {
    api.usersApi.importStudents.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const dlg = await openImport();
    await paste(dlg, '23CSE201,Amy,amy@campus.test,CSE,2027,8');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Validate & import' }));
    expect(await within(dlg).findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(within(dlg).queryByText(/Imported \d+ of/)).not.toBeInTheDocument();
  });
});
