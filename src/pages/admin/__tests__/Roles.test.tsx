// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  adminApi: { roles: vi.fn(), setPermission: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { AdminRoles } from '../Roles';

const roles = () => ({
  permissions: [
    { key: 'students.view', module: 'Students', label: 'View student records', description: 'See placement profiles.' },
    { key: 'roles.manage', module: 'Administration', label: 'Manage roles', description: 'Change what each role can do.' },
  ],
  matrix: { admin: ['students.view', 'roles.manage'], faculty: ['students.view'], student: [] },
  userCounts: { admin: 2, faculty: 14, student: 480 },
});
const render = () => renderPage(<AdminRoles />, { base: '/admin' });

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('admin'), permissions: ['roles.manage'] });
  api.adminApi.roles.mockResolvedValue(roles());
});

describe('admin roles & permissions', () => {
  it('shows a skeleton, then the matrix and user counts from adminApi.roles()', async () => {
    let resolve!: (v: unknown) => void;
    api.adminApi.roles.mockReturnValue(new Promise((r) => { resolve = r; }));
    render();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    resolve(roles());
    const table = await screen.findByRole('table', { name: 'Role permission matrix' });
    expect(within(table).getByText('View student records')).toBeInTheDocument();
    expect(within(table).getByText('Administration')).toBeInTheDocument(); // module group heading
    expect(screen.getByText('480')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    // granted permissions are on, the missing one is off
    expect(within(table).getByRole('switch', { name: 'Revoke View student records for faculty' })).toBeChecked();
    expect(within(table).getByRole('switch', { name: 'Grant Manage roles for faculty' })).not.toBeChecked();
    expect(within(table).getByRole('switch', { name: 'Revoke Manage roles for admin' })).toBeChecked();
    expect(within(table).getAllByText('Own records only')).toHaveLength(2); // students cannot be granted staff permissions
  });

  it('granting asks for confirmation, then calls setPermission(role, perm, true) and reloads', async () => {
    api.adminApi.setPermission.mockResolvedValue(['students.view', 'roles.manage']);
    api.adminApi.roles.mockResolvedValueOnce(roles()).mockResolvedValue({ ...roles(), matrix: { ...roles().matrix, faculty: ['students.view', 'roles.manage'] } });
    render();
    await userEvent.click(await screen.findByRole('switch', { name: 'Grant Manage roles for faculty' }));
    const dlg = await screen.findByRole('dialog', { name: 'Grant permission?' });
    expect(within(dlg).getByText('Manage roles')).toBeInTheDocument();
    expect(api.adminApi.setPermission).not.toHaveBeenCalled(); // nothing changes before confirming
    await userEvent.click(within(dlg).getByRole('button', { name: 'Grant' }));
    await waitFor(() => expect(api.adminApi.setPermission).toHaveBeenCalledWith('faculty', 'roles.manage', true));
    expect(await screen.findByText('Granted “Manage roles” to faculty')).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Revoke Manage roles for faculty' })).toBeChecked(); // reflects the reloaded server state
  });

  it('revoking sends enabled=false for that role only', async () => {
    api.adminApi.setPermission.mockResolvedValue([]);
    render();
    await userEvent.click(await screen.findByRole('switch', { name: 'Revoke View student records for faculty' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Revoke permission?' })).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.adminApi.setPermission).toHaveBeenCalledWith('faculty', 'students.view', false));
    expect(api.adminApi.setPermission).toHaveBeenCalledTimes(1);
  });

  it('cancelling the confirmation makes no request and leaves the matrix unchanged', async () => {
    render();
    const toggle = await screen.findByRole('switch', { name: 'Revoke View student records for faculty' });
    await userEvent.click(toggle);
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.adminApi.setPermission).not.toHaveBeenCalled();
    expect(toggle).toBeChecked();
  });

  it('a 409 is shown in the dialog, no success toast, and the matrix is not reloaded or changed', async () => {
    api.adminApi.setPermission.mockRejectedValue(new ApiError(409, 'Cannot revoke roles.manage from the administrator role: at least one role must keep it.', 'conflict'));
    render();
    const toggle = await screen.findByRole('switch', { name: 'Revoke Manage roles for admin' });
    await userEvent.click(toggle);
    const dlg = await screen.findByRole('dialog', { name: 'Revoke permission?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revoke' }));
    expect(await within(dlg).findByText(/at least one role must keep it/)).toBeInTheDocument();
    expect(screen.queryByText(/Revoked/)).not.toBeInTheDocument();
    expect(api.adminApi.roles).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'Revoke Manage roles for admin' })).toBeChecked(); // still granted
  });

  it('403 renders permission-denied and no matrix', async () => {
    api.adminApi.roles.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    render();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Role permission matrix' })).not.toBeInTheDocument();
  });

  it('501 renders not-available without Retry; 500 offers Retry which reloads', async () => {
    api.adminApi.roles.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    const a = render();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    a.unmount();
    api.adminApi.roles.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Role permission matrix' })).toBeInTheDocument();
  });
});
