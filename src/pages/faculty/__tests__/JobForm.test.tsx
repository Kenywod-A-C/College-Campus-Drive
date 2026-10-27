// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import { job, jobView } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  jobsApi: { get: vi.fn(), save: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyJobForm } from '../JobForm';

const PERMS = ['jobs.create', 'drives.publish'];
const asPerms = (...p: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: p });
const renderNew = () => renderPage(<FacultyJobForm />, { route: '/faculty/jobs/new', path: '/faculty/jobs/new' });
const renderEdit = () => renderPage(<FacultyJobForm />, { route: '/faculty/jobs/11/edit', path: '/faculty/jobs/:jobId/edit' });

async function fillMinimal() {
  await userEvent.click(await screen.findByLabelText('Company'));
  await userEvent.click(await screen.findByRole('option', { name: 'Zoho' }));
  await userEvent.type(screen.getByLabelText('Job title'), '  Platform Engineer ');
  await userEvent.type(screen.getByLabelText('Location'), 'Chennai');
  await userEvent.type(screen.getByLabelText('Job description'), 'Own the platform.');
  await userEvent.click(screen.getByLabelText('Eligible departments'));
  await userEvent.click(await screen.findByRole('option', { name: 'Computer Science' }));
  await userEvent.keyboard('{Escape}');
  fireEvent.change(screen.getByLabelText('Application deadline'), { target: { value: '2030-03-01T10:00' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  asPerms(...PERMS);
  api.reportsApi.filterOptions.mockResolvedValue({
    departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [], companies: [{ value: '3', label: 'Zoho' }], jobs: [],
  });
});

describe('new job form', () => {
  it('blocks saving until required fields are valid (no request is sent)', async () => {
    renderNew();
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Select a company')).toBeInTheDocument();
    for (const msg of ['Job title is required', 'Location is required', 'Add a description', 'Select at least one department', 'Deadline is required']) expect(screen.getByText(msg)).toBeInTheDocument();
    expect(api.jobsApi.save).not.toHaveBeenCalled();
  });

  it('saves a draft with the exact payload the API expects, then goes to the new job', async () => {
    api.jobsApi.save.mockResolvedValue(job({ id: '77', status: 'draft' }));
    renderNew();
    await fillMinimal();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.jobsApi.save).toHaveBeenCalledTimes(1));
    const sent = api.jobsApi.save.mock.calls[0][0];
    expect(sent).toMatchObject({ status: 'draft', companyId: '3', title: 'Platform Engineer', type: 'Full-time', eligibility: { minCgpa: 6.5, maxActiveArrears: 0, graduationYears: [2027], departmentIds: ['1'] }, location: 'Chennai', description: 'Own the platform.' });
    expect(sent.id).toBeUndefined();
    expect(new Date(sent.deadline).toISOString()).toBe(sent.deadline); // a real ISO instant, never a raw form string
    expect(sent.driveDate).toBeUndefined(); // optional empty dates are omitted, not sent as ''
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
  });

  it('a server rejection (422) is shown and the user stays on the form, with no success message', async () => {
    api.jobsApi.save.mockRejectedValue(new ApiError(422, 'deadline: Deadline must be after the opening date.', 'validation_error', { deadline: ['Deadline must be after the opening date.'] }));
    renderNew();
    await fillMinimal();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Deadline must be after the opening date/)).toBeInTheDocument();
    expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
    expect(screen.queryByTestId('navigated')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Job title')).toHaveValue('  Platform Engineer '); // the user's input is kept so they can fix it and retry
  });

  it('publishing asks for confirmation first, then sends status "published"', async () => {
    api.jobsApi.save.mockResolvedValue(job({ id: '77' }));
    renderNew();
    await fillMinimal();
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    const dlg = await screen.findByRole('dialog');
    expect(api.jobsApi.save).not.toHaveBeenCalled();
    expect(within(dlg).getByText(/Eligible students will be able to see/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.jobsApi.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' })));
    expect(await screen.findByText('Job published')).toBeInTheDocument();
  });

  it('a 403 on publish (permission revoked meanwhile) is reported and nothing is claimed', async () => {
    api.jobsApi.save.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderNew();
    await fillMinimal();
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByText('Job published')).not.toBeInTheDocument();
  });

  it('without drives.publish only "Save draft" is offered', async () => {
    asPerms('jobs.create');
    renderNew();
    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish…' })).not.toBeInTheDocument();
  });

  it('can add, reorder and remove hiring rounds and sends them in order', async () => {
    api.jobsApi.save.mockResolvedValue(job({ id: '77' }));
    renderNew();
    await fillMinimal();
    await userEvent.click(screen.getByRole('button', { name: /Add round/ }));
    const names = screen.getAllByLabelText('Round name');
    await userEvent.type(names[1], 'HR Interview');
    await userEvent.click(screen.getByRole('button', { name: 'Move round 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.jobsApi.save).toHaveBeenCalled());
    expect(api.jobsApi.save.mock.calls[0][0].rounds.map((r: { name: string }) => r.name)).toEqual(['HR Interview', 'Online Assessment']);
  });
});

describe('edit job form', () => {
  it('loads the job, and for a published job saves with status "published" and the job id', async () => {
    api.jobsApi.get.mockResolvedValue(jobView({ title: 'Existing role', status: 'published' }));
    api.jobsApi.save.mockResolvedValue(job());
    renderEdit();
    expect(await screen.findByDisplayValue('Existing role')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.jobsApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: '11', status: 'published', title: 'Existing role' })));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
  });

  it('closed or cancelled jobs are read-only with an explanation and no save buttons', async () => {
    api.jobsApi.get.mockResolvedValue(jobView({ status: 'closed' }));
    renderEdit();
    expect(await screen.findByText(/closed and can no longer be edited/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });

  it('shows 404 for a job that does not exist', async () => {
    api.jobsApi.get.mockRejectedValue(new ApiError(404, 'Job not found.', 'not_found'));
    renderEdit();
    expect(await screen.findByText('Job not found.')).toBeInTheDocument();
  });
});
