// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import { company, job, jobView, pageOf } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  jobsApi: { list: vi.fn(), get: vi.fn(), save: vi.fn(), setStatus: vi.fn(), archive: vi.fn(), drive: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyJobs } from '../Jobs';
import { actionsFor } from '../parts/JobActions';

const ALL = ['jobs.create', 'drives.publish', 'applications.review'] as const;
const as = (...permissions: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions });
const can = (...perms: string[]) => (p: string) => perms.includes(p);

beforeEach(() => {
  vi.clearAllMocks();
  as(...ALL);
  api.reportsApi.filterOptions.mockResolvedValue({ departments: [], graduationYears: [], companies: [{ value: '3', label: 'Zoho' }], jobs: [] });
  api.jobsApi.list.mockResolvedValue(pageOf([jobView({ id: '11', title: 'Software Developer' }, { applicantCount: 4 })]));
});

describe('which lifecycle actions are offered (mirrors the server state machine)', () => {
  const j = (status: string, archivedAt?: string) => job({ status: status as never, archivedAt });
  it.each([
    ['draft', undefined, ['publish', 'cancel', 'archive']],
    ['published', undefined, ['close', 'unpublish', 'cancel']],
    ['closed', undefined, ['reopen', 'archive']],
    ['cancelled', undefined, ['archive']],
    ['closed', '2030-01-01T00:00:00Z', ['unarchive']], // archived jobs can only be restored
  ])('%s (archivedAt=%s) -> %j', (status, archivedAt, expected) => {
    expect(actionsFor(j(status, archivedAt), can('drives.publish'))).toEqual(expected);
  });
  it('without drives.publish no lifecycle action is offered at all', () => {
    for (const s of ['draft', 'published', 'closed', 'cancelled']) expect(actionsFor(j(s), can('jobs.create'))).toEqual([]);
  });
});

describe('jobs list', () => {
  it('shows jobs from the API with status, applicants and an Archived marker', async () => {
    api.jobsApi.list.mockResolvedValue(pageOf([jobView({ title: 'Live role' }, { applicantCount: 4 }), jobView({ id: '12', title: 'Old role', status: 'closed', archivedAt: '2030-01-05T00:00:00Z' })]));
    renderPage(<FacultyJobs />);
    expect(await screen.findByText('Live role')).toBeInTheDocument();
    const old = screen.getByText('Old role').closest('tr')!;
    expect(within(old).getByText('Closed')).toBeInTheDocument();
    expect(within(old).getByText('Archived')).toBeInTheDocument();
    expect(within(screen.getByText('Live role').closest('tr')!).queryByText('Archived')).not.toBeInTheDocument();
  });

  it('asks the server to include / show only archived jobs', async () => {
    renderPage(<FacultyJobs />);
    await screen.findByText('Software Developer');
    expect(api.jobsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ archived: expect.anything() })); // hidden by default
    await userEvent.click(screen.getByLabelText('Archived'));
    await userEvent.click(await screen.findByRole('option', { name: 'Archived only' }));
    await waitFor(() => expect(api.jobsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ archived: 'only', page: 1 })));
  });

  it('filters by status tab on the server', async () => {
    renderPage(<FacultyJobs />);
    await screen.findByText('Software Developer');
    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    await waitFor(() => expect(api.jobsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' })));
  });

  it('empty, 403 and 501 states', async () => {
    api.jobsApi.list.mockResolvedValueOnce(pageOf([]));
    const { unmount } = renderPage(<FacultyJobs />);
    expect(await screen.findByText('No jobs match')).toBeInTheDocument();
    unmount();
    api.jobsApi.list.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to view this.', 'forbidden'));
    const second = renderPage(<FacultyJobs />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    second.unmount();
    api.jobsApi.list.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    renderPage(<FacultyJobs />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
  });

  it('"New job" is only offered with jobs.create', async () => {
    as('drives.publish');
    renderPage(<FacultyJobs />);
    await screen.findByText('Software Developer');
    expect(screen.queryByRole('link', { name: /New job/ })).not.toBeInTheDocument();
  });
});

describe('lifecycle actions from the row menu', () => {
  const openMenu = async () => { await screen.findByText('Software Developer'); await userEvent.click(screen.getByRole('button', { name: 'Actions for Software Developer' })); };

  it('unpublish asks for confirmation, calls setStatus(draft) and refreshes the list', async () => {
    api.jobsApi.setStatus.mockResolvedValue(job({ status: 'draft' }));
    renderPage(<FacultyJobs />);
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unpublish' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/nobody has applied/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(api.jobsApi.setStatus).toHaveBeenCalledWith('11', 'draft', undefined));
    expect(await screen.findByText(/moved back to draft/)).toBeInTheDocument();
    await waitFor(() => expect(api.jobsApi.list).toHaveBeenCalledTimes(2));
  });

  it('a server refusal (409) is shown in the dialog and is never reported as success', async () => {
    api.jobsApi.setStatus.mockRejectedValue(new ApiError(409, 'This job already has 2 application(s), so it cannot be unpublished. Close it instead.', 'conflict'));
    renderPage(<FacultyJobs />);
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unpublish' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unpublish' }));
    expect(await within(screen.getByRole('dialog')).findByText(/Close it instead/)).toBeInTheDocument();
    expect(screen.queryByText(/moved back to draft/)).not.toBeInTheDocument();
    expect(api.jobsApi.list).toHaveBeenCalledTimes(1);
  });

  it('cancelling requires a reason before anything is sent', async () => {
    api.jobsApi.setStatus.mockResolvedValue(job({ status: 'cancelled' }));
    renderPage(<FacultyJobs />);
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel job' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel job' }));
    expect(await within(dlg).findByText('Reason for cancelling is required.')).toBeInTheDocument();
    expect(api.jobsApi.setStatus).not.toHaveBeenCalled();
    await userEvent.type(within(dlg).getByLabelText('Reason for cancelling'), 'Company froze hiring');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel job' }));
    await waitFor(() => expect(api.jobsApi.setStatus).toHaveBeenCalledWith('11', 'cancelled', 'Company froze hiring'));
  });

  it('archive and restore use the archive endpoint, not a status change', async () => {
    api.jobsApi.list.mockResolvedValue(pageOf([jobView({ status: 'closed' })]));
    api.jobsApi.archive.mockResolvedValue(job({ status: 'closed', archivedAt: '2030-01-05T00:00:00Z' }));
    renderPage(<FacultyJobs />);
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.jobsApi.archive).toHaveBeenCalledWith('11', true));
    expect(api.jobsApi.setStatus).not.toHaveBeenCalled();
  });

  it('a 403 from the server (permission revoked after the page loaded) is surfaced', async () => {
    api.jobsApi.setStatus.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderPage(<FacultyJobs />);
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Close applications' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close applications' }));
    expect(await within(screen.getByRole('dialog')).findByText('You do not have permission to do this.')).toBeInTheDocument();
  });

  it('without drives.publish the menu offers no lifecycle actions, only view/edit', async () => {
    as('jobs.create');
    renderPage(<FacultyJobs />);
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Edit job' })).toBeInTheDocument();
    for (const name of ['Unpublish', 'Close applications', 'Cancel job', 'Archive']) expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument();
  });

  it('archived jobs cannot be edited, only restored', async () => {
    api.jobsApi.list.mockResolvedValue(pageOf([jobView({ status: 'closed', archivedAt: '2030-01-05T00:00:00Z' })]));
    renderPage(<FacultyJobs />);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Edit job' })).not.toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'Restore' })).toBeInTheDocument();
  });
});

void company;
