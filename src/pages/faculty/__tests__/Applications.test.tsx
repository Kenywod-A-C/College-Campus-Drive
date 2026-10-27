// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { Application, ApplicationStatus } from '@/types';
import type { ApplicationView } from '@/types/views';
import { company, job, pageOf } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  applicationsApi: { listAll: vi.fn(), updateStage: vi.fn(), exportCsv: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyApplications } from '../Applications';

const view = (id: string, name: string, status: ApplicationStatus = 'applied', state: 'eligible' | 'not_eligible' = 'eligible'): ApplicationView => ({
  application: {
    id, studentId: `s${id}`, jobId: '11', status, appliedAt: '2030-01-02T00:00:00Z', updatedAt: '2030-01-03T00:00:00Z', history: [],
    eligibilitySnapshot: { state, checks: [], summary: state === 'eligible' ? 'Meets all criteria' : 'CGPA below minimum', evaluatedAt: '2030-01-02T00:00:00Z' },
  } as Application,
  job: job(), company: company(),
  student: { id: `s${id}`, userId: `u${id}`, studentCode: `23CSE0${id}`, name, email: `${name}@campus.test`, departmentId: '1', degree: 'B.E.', currentYear: 4, graduationYear: 2027,
    academic: { cgpa: 8.5, cgpaVerified: true, activeArrears: 0, arrearHistory: 0 }, skills: [], interests: [], preferredRoles: [], profileCompletion: 80, placementStatus: 'unplaced' },
});

const as = (...permissions: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions });

beforeEach(() => {
  vi.clearAllMocks();
  as('applications.review', 'reports.view');
  api.reportsApi.filterOptions.mockResolvedValue({ departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [], companies: [{ value: '3', label: 'Zoho' }], jobs: [] });
  api.applicationsApi.listAll.mockResolvedValue(pageOf([view('1', 'Ann Alpha'), view('2', 'Bob Beta', 'shortlisted')]));
});

const selectRow = async (name: string) => userEvent.click(within((await screen.findByText(name)).closest('tr')!).getByRole('checkbox', { name: 'Select row' }));

describe('faculty applications page', () => {
  it('shows a skeleton while loading, then the applicants', async () => {
    let resolve!: (v: unknown) => void;
    api.applicationsApi.listAll.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage(<FacultyApplications />);
    expect(screen.getByLabelText('Loading table')).toBeInTheDocument();
    resolve(pageOf([view('1', 'Ann Alpha'), view('2', 'Bob Beta', 'shortlisted')], 2));
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bob Beta')).toBeInTheDocument();
    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
    expect(screen.getAllByText('8.50')).toHaveLength(2);
    expect(screen.queryByLabelText('Loading table')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    api.applicationsApi.listAll.mockResolvedValue(pageOf([]));
    renderPage(<FacultyApplications />);
    expect(await screen.findByText('No applications match')).toBeInTheDocument();
  });

  it('sends the search text and filters to the server (server-side filtering)', async () => {
    renderPage(<FacultyApplications />);
    await screen.findByText('Ann Alpha');
    expect(api.applicationsApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all', page: 1, sort: 'recent' }));
    await userEvent.click(screen.getByLabelText('Stage'));
    await userEvent.click(await screen.findByRole('option', { name: 'Shortlisted' }));
    await waitFor(() => expect(api.applicationsApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'shortlisted', page: 1 })));
    await userEvent.click(screen.getByLabelText('Company'));
    await userEvent.click(await screen.findByRole('option', { name: 'Zoho' }));
    await waitFor(() => expect(api.applicationsApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'shortlisted', companyId: '3' })));
    await userEvent.click(screen.getByLabelText('Eligibility'));
    await userEvent.click(await screen.findByRole('option', { name: 'Not eligible' }));
    await waitFor(() => expect(api.applicationsApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ eligibility: 'not_eligible' })));
    await userEvent.type(screen.getByLabelText('Search student, ID, company or job'), 'ann');
    await waitFor(() => expect(api.applicationsApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ann', status: 'shortlisted', companyId: '3', eligibility: 'not_eligible' })), { timeout: 2000 });
  });

  it('bulk action calls updateStage(ids, status, undefined, undefined) after confirmation and reports success', async () => {
    api.applicationsApi.updateStage.mockResolvedValue({ updated: ['1', '2'], failed: [] });
    renderPage(<FacultyApplications />);
    await selectRow('Ann Alpha');
    await selectRow('Bob Beta');
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Shortlist' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Shortlist 2 applicant(s)?')).toBeInTheDocument();
    expect(api.applicationsApi.updateStage).not.toHaveBeenCalled(); // nothing happens before confirming
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.applicationsApi.updateStage).toHaveBeenCalledWith(['1', '2'], 'shortlisted', undefined, undefined));
    expect(await screen.findByText('2 application(s) moved to Shortlisted')).toBeInTheDocument();
    await waitFor(() => expect(api.applicationsApi.listAll).toHaveBeenCalledTimes(2)); // refreshed
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument(); // moved rows are deselected
  });

  it('a partial failure lists each reason in a "not moved" dialog and keeps failed rows selected', async () => {
    api.applicationsApi.updateStage.mockResolvedValue({ updated: ['1'], failed: [{ id: '2', reason: 'Bob Beta: stage cannot move backwards' }] });
    renderPage(<FacultyApplications />);
    await selectRow('Ann Alpha');
    await selectRow('Bob Beta');
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Mark selected' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    const outcome = await screen.findByRole('dialog', { name: '1 moved, 1 not moved' });
    expect(within(outcome).getByText('Bob Beta: stage cannot move backwards')).toBeInTheDocument();
    expect(within(outcome).queryByRole('button', { name: /Request exception/ })).not.toBeInTheDocument(); // not an eligibility failure
    expect(screen.queryByText(/application\(s\) moved to/)).not.toBeInTheDocument(); // no false success toast
    await userEvent.click(within(outcome).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '1 moved, 1 not moved' })).not.toBeInTheDocument());
    expect(screen.getByText('1 selected')).toBeInTheDocument(); // only the moved row was deselected
  });

  it('an "exception" failure leads to the request-exception form, which enforces reason >= 10 and approver >= 3 chars before sending', async () => {
    api.applicationsApi.updateStage
      .mockResolvedValueOnce({ updated: [], failed: [{ id: '1', reason: 'Not eligible: an approved exception is required.' }] })
      .mockResolvedValueOnce({ updated: ['1'], failed: [] });
    renderPage(<FacultyApplications />);
    await selectRow('Ann Alpha');
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Move to interview' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    const outcome = await screen.findByRole('dialog', { name: '1 not moved' });
    await userEvent.click(within(outcome).getByRole('button', { name: /Request exception/ }));

    const form = await screen.findByRole('dialog', { name: 'Record eligibility exception' });
    const submit = within(form).getByRole('button', { name: 'Record exception & move' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/Reason for exception/), 'too short');            // 9 chars
    await userEvent.type(within(form).getByLabelText(/Approved by/), 'Dr. Rao');
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/Reason for exception/), '!');                    // 10 chars
    expect(submit).toBeEnabled();
    await userEvent.clear(within(form).getByLabelText(/Approved by/));
    await userEvent.type(within(form).getByLabelText(/Approved by/), 'Dr');                             // 2 chars
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/Approved by/), 'R');
    expect(submit).toBeEnabled();
    expect(api.applicationsApi.updateStage).toHaveBeenCalledTimes(1);

    await userEvent.click(submit);
    await waitFor(() => expect(api.applicationsApi.updateStage).toHaveBeenLastCalledWith(['1'], 'interview', undefined, { reason: 'too short!', approvedBy: 'DrR' }));
    expect(await screen.findByText('1 application(s) moved to Interview')).toBeInTheDocument();
  });

  it('403 on the list renders permission-denied; no applicant data', async () => {
    api.applicationsApi.listAll.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderPage(<FacultyApplications />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByText('Ann Alpha')).not.toBeInTheDocument();
  });

  it('501 renders "Not available yet" without Retry', async () => {
    api.applicationsApi.listAll.mockRejectedValue(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    renderPage(<FacultyApplications />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a 500 offers Retry which re-calls the API', async () => {
    api.applicationsApi.listAll.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error')).mockResolvedValue(pageOf([view('1', 'Ann Alpha')]));
    renderPage(<FacultyApplications />);
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    expect(api.applicationsApi.listAll).toHaveBeenCalledTimes(2);
  });

  it('a 401 on the list signs the user out (session expired) instead of showing data', async () => {
    api.applicationsApi.listAll.mockRejectedValue(new ApiError(401, 'Your session has expired.', 'unauthorized'));
    api.authApi.logout.mockResolvedValue(undefined);
    renderPage(<FacultyApplications />);
    await waitFor(() => expect(api.authApi.logout).toHaveBeenCalled());
    expect(screen.queryByText('Ann Alpha')).not.toBeInTheDocument();
  });

  it('Export CSV is hidden from users without reports.view', async () => {
    as('applications.review');
    renderPage(<FacultyApplications />);
    await screen.findByText('Ann Alpha');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  it('a failing export shows an error toast; a successful one a success toast', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    api.applicationsApi.exportCsv.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden')).mockResolvedValueOnce('a,b\n1,2');
    renderPage(<FacultyApplications />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled(); // no file is produced on failure
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Export downloaded')).toBeInTheDocument();
    expect(api.applicationsApi.exportCsv).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
