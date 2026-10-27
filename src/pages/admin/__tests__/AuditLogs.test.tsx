// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { AuditLog } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  adminApi: { auditLogs: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { AdminAuditLogs } from '../AuditLogs';

const log = (id: string, over: Partial<AuditLog> = {}): AuditLog => ({ id, actor: 'Admin One', actorRole: 'admin', action: 'policy.update', resource: `policy:${id}`, at: '2030-01-05T10:30:00Z', result: 'success', ...over });
const result = (items: AuditLog[], over: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, pageSize: 12, actions: ['policy.update', 'user.deactivate'], ...over });
const render = () => renderPage(<AdminAuditLogs />, { base: '/admin' });

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('admin'), permissions: ['audit.view'] });
  api.adminApi.auditLogs.mockResolvedValue(result([
    log('1'),
    log('2', { actor: 'Fay Faculty', actorRole: 'faculty', action: 'offer.create', resource: 'offer:7', result: 'denied', reason: 'Missing offers.manage' }),
    log('3', { action: 'user.deactivate', resource: 'user:5', result: 'failed' }),
  ]));
});

describe('admin audit logs', () => {
  it('shows a skeleton, then log entries with actor, action, record, result and reason', async () => {
    let resolve!: (v: unknown) => void;
    api.adminApi.auditLogs.mockReturnValue(new Promise((r) => { resolve = r; }));
    render();
    expect(screen.getByLabelText('Loading table')).toBeInTheDocument();
    resolve(result([log('1'), log('2', { actor: 'Fay Faculty', actorRole: 'faculty', action: 'offer.create', resource: 'offer:7', result: 'denied', reason: 'Missing offers.manage' })]));
    const denied = (await screen.findByText('offer.create')).closest('tr')!;
    expect(within(denied).getByText('Fay Faculty')).toBeInTheDocument();
    expect(within(denied).getByText('faculty')).toBeInTheDocument();
    expect(within(denied).getByText('offer:7')).toBeInTheDocument();
    expect(within(denied).getByText('Denied')).toBeInTheDocument();
    expect(within(denied).getByText('Missing offers.manage')).toBeInTheDocument();
    const ok = screen.getByText('policy.update').closest('tr')!;
    expect(within(ok).getByText('Success')).toBeInTheDocument();
    expect(within(ok).getByText('—')).toBeInTheDocument(); // no reason recorded
    expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'all', page: 1, action: '' }));
  });

  it('passes actor, record, action and result filters to the server', async () => {
    render();
    await screen.findByText('offer.create');
    await userEvent.click(screen.getByLabelText('Action type'));
    await userEvent.click(await screen.findByRole('option', { name: 'user.deactivate' })); // options come from the server response
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'user.deactivate', page: 1 })));
    await userEvent.click(screen.getByLabelText('Result'));
    await userEvent.click(await screen.findByRole('option', { name: 'Denied' }));
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'denied', action: 'user.deactivate' })));
    await userEvent.type(screen.getByLabelText('Filter by user'), 'fay');
    await userEvent.type(screen.getByLabelText('Filter by record'), 'offer:7');
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'fay', resource: 'offer:7', result: 'denied', action: 'user.deactivate' })), { timeout: 2000 });
  });

  it('passes the date range to the server and omits empty dates', async () => {
    render();
    await screen.findByText('offer.create');
    expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: undefined, to: undefined }));
    await userEvent.type(screen.getByLabelText('From'), '2030-01-01');
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2030-01-01', to: undefined })));
    await userEvent.type(screen.getByLabelText('To'), '2030-01-31');
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2030-01-01', to: '2030-01-31', page: 1 })));
  });

  it('pagination is server-side: page 2 refetches and shows that page only; changing a filter returns to page 1', async () => {
    api.adminApi.auditLogs.mockImplementation(async (q: { page?: number }) => q.page === 2
      ? result([log('13', { action: 'role.update', resource: 'role:faculty' })], { total: 13, page: 2 })
      : result(Array.from({ length: 12 }, (_, i) => log(String(i + 1), { resource: `policy:${i + 1}` })), { total: 13 }));
    render();
    await screen.findByText('policy:1');
    expect(screen.getByText(/Showing 1–12 of 13/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /page 2/i }));
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    expect(await screen.findByText('role:faculty')).toBeInTheDocument();
    expect(screen.queryByText('policy:1')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 13–13 of 13/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Result'));
    await userEvent.click(await screen.findByRole('option', { name: 'Failed' }));
    await waitFor(() => expect(api.adminApi.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'failed', page: 1 })));
  });

  it('empty result shows the empty state', async () => {
    api.adminApi.auditLogs.mockResolvedValue(result([]));
    render();
    expect(await screen.findByText('No matching log entries')).toBeInTheDocument();
  });

  it('403 renders permission-denied with no entries', async () => {
    api.adminApi.auditLogs.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    render();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByText('policy.update')).not.toBeInTheDocument();
  });

  it('501 is "Not available yet" without Retry; 500 shows Retry which re-queries', async () => {
    api.adminApi.auditLogs.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    const a = render();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    a.unmount();
    api.adminApi.auditLogs.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('offer.create')).toBeInTheDocument();
  });
});
