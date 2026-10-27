// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { Application, InterviewStatus } from '@/types';
import type { ApplicationView } from '@/types/views';
import type { InterviewView } from '@/services/contracts/interviews';
import { company, job, jobView, pageOf } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  interviewsApi: { list: vi.fn(), save: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
  applicationsApi: { listAll: vi.fn() },
  jobsApi: { list: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyInterviews } from '../Interviews';

const interview = (id: string, status: InterviewStatus = 'scheduled', over: Partial<InterviewView['interview']> = {}): InterviewView => ({
  interview: { id, jobId: '11', applicationIds: ['1'], round: `Technical ${id}`, at: '2030-03-05T10:00:00Z', durationMins: 45, location: 'Room 5', status, notified: false, ...over },
  job: job(), company: company(),
  candidates: [{ applicationId: '1', name: 'Ann Alpha', studentCode: '23CSE001', status: 'shortlisted' }],
});
const candidate = (id: string, name: string, status: Application['status'] = 'shortlisted'): ApplicationView => ({
  application: { id, studentId: `s${id}`, jobId: '11', status, appliedAt: '2030-01-02T00:00:00Z', updatedAt: '2030-01-03T00:00:00Z', history: [], eligibilitySnapshot: { state: 'eligible', checks: [], summary: '', evaluatedAt: '2030-01-02T00:00:00Z' } } as Application,
  job: job(), company: company(),
  student: { id: `s${id}`, userId: `u${id}`, studentCode: `23CSE00${id}`, name, email: `${name}@campus.test`, departmentId: '1', degree: 'B.E.', currentYear: 4, graduationYear: 2027,
    academic: { cgpa: 8.5, cgpaVerified: true, activeArrears: 0, arrearHistory: 0 }, skills: [], interests: [], preferredRoles: [], profileCompletion: 80, placementStatus: 'unplaced' },
});

const as = (...permissions: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions });
const openList = async () => { renderPage(<FacultyInterviews />); await userEvent.click(await screen.findByRole('tab', { name: 'Schedule list' })); };
const openDetail = async (round = 'Technical 1') => { await openList(); await userEvent.click(await screen.findByText(round)); return screen.findByRole('dialog', { name: new RegExp(round) }); };

beforeEach(() => {
  vi.clearAllMocks();
  as('applications.review');
  api.interviewsApi.list.mockResolvedValue([interview('1'), interview('2', 'completed', { notified: true, location: 'https://meet.example.com/abc' })]);
  api.applicationsApi.listAll.mockImplementation(async (q: { status?: string }) => pageOf(q.status === 'selected' ? [candidate('5', 'Sel Student', 'selected')] : q.status === 'offer_received' ? [] : [candidate('1', 'Ann Alpha'), candidate('2', 'Bob Beta', 'interview'), candidate('3', 'Cat Applied', 'applied')]));
  api.jobsApi.list.mockResolvedValue(pageOf([jobView({ id: '11', title: 'Software Developer', rounds: [{ id: 'r1', name: 'Technical', mode: 'Online' }] })]));
});

describe('faculty interviews page', () => {
  it('renders the schedule list with status, location, link and notification state', async () => {
    await openList();
    const first = (await screen.findByText('Technical 1')).closest('tr')!;
    expect(within(first).getByText('Room 5')).toBeInTheDocument();
    expect(within(first).getByText('Scheduled')).toBeInTheDocument();
    expect(within(first).getByText('Not notified')).toBeInTheDocument();
    const second = screen.getByText('Technical 2').closest('tr')!;
    expect(within(second).getByRole('link', { name: 'Meeting link' })).toHaveAttribute('href', 'https://meet.example.com/abc');
    expect(within(second).getByText('Notified')).toBeInTheDocument();
  });

  it('empty schedule shows the empty state; the Selection results tab lists selected applicants', async () => {
    api.interviewsApi.list.mockResolvedValue([]);
    await openList();
    expect(await screen.findByText('No interviews scheduled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Selection results' }));
    expect(await screen.findByText('Sel Student')).toBeInTheDocument();
    expect(api.applicationsApi.listAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'selected' }));
  });

  it('scheduling validates required fields client-side (no API call) and lists every problem', async () => {
    renderPage(<FacultyInterviews />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule interview' }));
    const dlg = await screen.findByRole('dialog', { name: 'Schedule interview round' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Select a job')).toBeInTheDocument();
    expect(within(dlg).getByText('Round name is required')).toBeInTheDocument();
    expect(within(dlg).getByText('Room or meeting link is required')).toBeInTheDocument();
    expect(within(dlg).getByText('Select at least one candidate')).toBeInTheDocument();
    expect(api.interviewsApi.save).not.toHaveBeenCalled();
  });

  const fillForm = async (dlg: HTMLElement) => {
    await userEvent.click(within(dlg).getByLabelText('Job'));
    await userEvent.click(await screen.findByRole('option', { name: 'Zoho — Software Developer' }));
    await userEvent.type(within(dlg).getByLabelText('Round'), 'Technical');
    await userEvent.type(within(dlg).getByLabelText('Location or meeting link'), 'Room 5');
    await userEvent.click(within(dlg).getByLabelText('Candidates (shortlisted / interviewing)'));
    await userEvent.click(await screen.findByRole('option', { name: 'Ann Alpha (23CSE001)' }));
  };

  it('only shortlisted / interviewing applicants are offered as candidates, and save sends the right payload', async () => {
    api.interviewsApi.save.mockResolvedValue(interview('9'));
    renderPage(<FacultyInterviews />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule interview' }));
    const dlg = await screen.findByRole('dialog', { name: 'Schedule interview round' });
    await fillForm(dlg);
    expect(api.applicationsApi.listAll).toHaveBeenCalledWith(expect.objectContaining({ jobId: '11' }));
    expect(screen.getByRole('option', { name: 'Bob Beta (23CSE002)' })).toBeInTheDocument(); // interviewing
    expect(screen.queryByRole('option', { name: /Cat Applied/ })).not.toBeInTheDocument();   // merely applied
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.interviewsApi.save).toHaveBeenCalledTimes(1));
    const sent = api.interviewsApi.save.mock.calls[0][0];
    expect(sent).toMatchObject({ id: undefined, jobId: '11', round: 'Technical', durationMins: 45, location: 'Room 5', applicationIds: ['1'] });
    expect(sent.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await screen.findByText('Interview scheduled')).toBeInTheDocument();
    await waitFor(() => expect(api.interviewsApi.list).toHaveBeenCalledTimes(2)); // schedule refreshed
  });

  it('a duration under 5 minutes is rejected before any request', async () => {
    renderPage(<FacultyInterviews />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule interview' }));
    const dlg = await screen.findByRole('dialog', { name: 'Schedule interview round' });
    await fillForm(dlg);
    await userEvent.keyboard('{Escape}');
    await userEvent.tripleClick(within(dlg).getByLabelText('Duration (min)'));
    await userEvent.keyboard('3');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('At least 5 minutes')).toBeInTheDocument();
    expect(api.interviewsApi.save).not.toHaveBeenCalled();
  });

  it('a 409 time clash from save is shown in the dialog, which stays open; nothing is reported as scheduled', async () => {
    api.interviewsApi.save.mockRejectedValue(new ApiError(409, 'Time clash: Ann Alpha already has an interview at that time.', 'conflict'));
    renderPage(<FacultyInterviews />);
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule interview' }));
    const dlg = await screen.findByRole('dialog', { name: 'Schedule interview round' });
    await fillForm(dlg);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Time clash: Ann Alpha already has an interview at that time.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Schedule interview round' })).toBeInTheDocument();
    expect(screen.queryByText('Interview scheduled')).not.toBeInTheDocument();
    expect(api.interviewsApi.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Mark completed', 'completed', 'Marked completed'],
    ['No-show', 'no_show', 'Marked no show'],
    ['Cancel round', 'cancelled', 'Marked cancelled'],
  ] as const)('"%s" calls interviewsApi.setStatus(id, "%s") and refreshes', async (button, status, toast) => {
    api.interviewsApi.setStatus.mockResolvedValue(interview('1', status));
    const dlg = await openDetail();
    await userEvent.click(within(dlg).getByRole('button', { name: button }));
    await waitFor(() => expect(api.interviewsApi.setStatus).toHaveBeenCalledWith('1', status));
    expect(await screen.findByText(toast)).toBeInTheDocument();
    await waitFor(() => expect(api.interviewsApi.list).toHaveBeenCalledTimes(2));
  });

  it('Notify students calls interviewsApi.notify(id)', async () => {
    api.interviewsApi.notify.mockResolvedValue({ notified: 1 });
    const dlg = await openDetail();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Notify students' }));
    await waitFor(() => expect(api.interviewsApi.notify).toHaveBeenCalledWith('1'));
    expect(await screen.findByText(/Students notified in-app/)).toBeInTheDocument();
  });

  it('a refused status change shows an error toast and does not claim success', async () => {
    api.interviewsApi.setStatus.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const dlg = await openDetail();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Mark completed' }));
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByText('Marked completed')).not.toBeInTheDocument();
    expect(api.interviewsApi.list).toHaveBeenCalledTimes(1);
  });

  it('without applications.review there is no Schedule button and a finished round offers no actions', async () => {
    as('students.view');
    const dlg = await openDetail('Technical 2');
    expect(within(dlg).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: /Mark completed|No-show|Cancel round|Notify|Re-notify/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule interview' })).not.toBeInTheDocument();
  });

  it('403 renders permission-denied; 501 renders not-available (no Retry); 500 offers Retry', async () => {
    api.interviewsApi.list.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const a = renderPage(<FacultyInterviews />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    a.unmount();

    api.interviewsApi.list.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    const b = renderPage(<FacultyInterviews />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    b.unmount();

    api.interviewsApi.list.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    renderPage(<FacultyInterviews />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.interviewsApi.list).toHaveBeenCalledTimes(4)); // 403 + 501 + failed load + retry
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
