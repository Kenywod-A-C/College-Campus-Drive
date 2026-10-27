// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { Application, OfferStatus } from '@/types';
import type { ApplicationView, OfferView } from '@/types/views';
import type { OfferList } from '@/services/contracts/offers';
import { company, job } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  offersApi: { listAll: vi.fn(), create: vi.fn(), setStatus: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyOffers } from '../Offers';

const student = (id: string, name: string) => ({
  id, userId: `u${id}`, studentCode: `23CSE0${id}`, name, email: `${name}@campus.test`, departmentId: '1', degree: 'B.E.', currentYear: 4, graduationYear: 2027,
  academic: { cgpa: 8.5, cgpaVerified: true, activeArrears: 0, arrearHistory: 0 }, skills: [], interests: [], preferredRoles: [], profileCompletion: 80, placementStatus: 'unplaced' as const,
});
const offer = (id: string, name: string, status: OfferStatus = 'received', ctcLpa = 12): OfferView => ({
  offer: { id, studentId: id, jobId: '11', applicationId: `a${id}`, companyId: '3', ctcLpa, offeredAt: '2030-01-05T00:00:00Z', acceptBy: '2030-01-20T00:00:00Z', status, policyChecks: [{ label: 'Max offers', passed: true, detail: 'ok' }] },
  job: job(), company: company(), student: student(id, name),
});
const selected = (id: string, name: string): ApplicationView => ({
  application: { id: `a${id}`, studentId: id, jobId: '11', status: 'selected', appliedAt: '2030-01-02T00:00:00Z', updatedAt: '2030-01-03T00:00:00Z', history: [], eligibilitySnapshot: { state: 'eligible', checks: [], summary: '', evaluatedAt: '2030-01-02T00:00:00Z' } } as Application,
  job: job({ ctcLpa: 8 }), company: company(), student: student(id, name),
});
const list = (over: Partial<OfferList> = {}): OfferList => ({
  rows: [offer('1', 'Ann Alpha'), offer('2', 'Bob Beta', 'pending')], total: 2, page: 1, pageSize: 10,
  byDept: [{ dept: 'CSE', offers: 40, placed: 25, students: 100 }], byCompany: [{ company: 'Zoho', offers: 40, accepted: 30 }],
  totals: { offers: 57, accepted: 31, placed: 25 }, selectedWithoutOffer: [selected('9', 'Cara Gamma')], ...over,
});

const as = (...permissions: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions });
const openCreateDialog = async () => {
  await userEvent.click(await screen.findByRole('tab', { name: /Selected, awaiting offer/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Create offer' }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  vi.clearAllMocks();
  as('offers.manage');
  api.reportsApi.filterOptions.mockResolvedValue({ departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [], companies: [{ value: '3', label: 'Zoho' }], jobs: [] });
  api.offersApi.listAll.mockResolvedValue(list());
});

describe('faculty offers page', () => {
  it('renders the rows of the server page and requests page 1 with pageSize 10', async () => {
    renderPage(<FacultyOffers />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bob Beta')).toBeInTheDocument();
    expect(screen.getAllByText('₹12 LPA')).toHaveLength(2);
    expect(api.offersApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 10, status: 'all', q: '' }));
    expect(screen.getByText(/Showing 1–2 of 2/)).toBeInTheDocument();
  });

  it('empty page shows the empty state', async () => {
    api.offersApi.listAll.mockResolvedValue(list({ rows: [], total: 0 }));
    renderPage(<FacultyOffers />);
    expect(await screen.findByText('No offers match')).toBeInTheDocument();
  });

  it('pagination is server-side: page 2 refetches with page 2 and shows the rows the server returns', async () => {
    api.offersApi.listAll.mockImplementation(async (q: { page?: number }) => q.page === 2
      ? list({ rows: [offer('11', 'Dev Delta')], total: 11, page: 2 })
      : list({ rows: Array.from({ length: 10 }, (_, i) => offer(String(i + 1), `Student ${i + 1}`)), total: 11, page: 1 }));
    renderPage(<FacultyOffers />);
    await screen.findByText('Student 1');
    expect(screen.getByText(/Showing 1–10 of 11/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /page 2/i }));
    await waitFor(() => expect(api.offersApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 10 })));
    expect(await screen.findByText('Dev Delta')).toBeInTheDocument();
    expect(screen.queryByText('Student 1')).not.toBeInTheDocument();
  });

  it('search and status filter go to the server and reset to page 1', async () => {
    renderPage(<FacultyOffers />);
    await screen.findByText('Ann Alpha');
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Accepted' }));
    await waitFor(() => expect(api.offersApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'accepted', page: 1, pageSize: 10 })));
    await userEvent.type(screen.getByLabelText('Search student, ID or company'), 'zoho');
    await waitFor(() => expect(api.offersApi.listAll).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'zoho', status: 'accepted' })), { timeout: 2000 });
  });

  it('Summaries show college-wide totals from the server, not counts of the visible rows', async () => {
    renderPage(<FacultyOffers />);
    await screen.findByText('Ann Alpha');
    await userEvent.click(screen.getByRole('tab', { name: 'Summaries' }));
    const total = screen.getByText('Total offers').closest('div')!.parentElement!;
    expect(within(total).getByText('57')).toBeInTheDocument(); // totals.offers, while only 2 rows are loaded
    expect(screen.getByText('Accepted offers').closest('div')!.parentElement!).toHaveTextContent('31');
    expect(screen.getByText('Unique students placed').closest('div')!.parentElement!).toHaveTextContent('25');
    const row = screen.getByRole('cell', { name: 'CSE' }).closest('tr')!; // department summary uses byDept
    expect(within(row).getByText('25%')).toBeInTheDocument();
    expect(within(row).getByText('40')).toBeInTheDocument();
  });

  it('"Selected, awaiting offer" lists selectedWithoutOffer and Create offer opens the dialog defaulting to the advertised package', async () => {
    renderPage(<FacultyOffers />);
    await screen.findByText('Ann Alpha');
    expect(screen.getByRole('tab', { name: 'Selected, awaiting offer (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Selected, awaiting offer/ }));
    const row = (await screen.findByText('Cara Gamma')).closest('tr')!;
    expect(within(row).getByText('₹8 LPA')).toBeInTheDocument();
    expect(screen.queryByText('Ann Alpha')).not.toBeInTheDocument(); // offer records are on the other tab
    await userEvent.click(within(row).getByRole('button', { name: 'Create offer' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Create official offer/)).toBeInTheDocument();
    expect(within(dlg).getByLabelText('Package (LPA)')).toHaveValue(8);
  });

  it('create success calls offersApi.create(applicationId, ctc, acceptBy) and shows the policy checks', async () => {
    api.offersApi.create.mockResolvedValue({ ...offer('9', 'Cara Gamma', 'pending', 10), offer: { ...offer('9', 'Cara Gamma').offer, policyChecks: [{ label: 'Max offers', passed: true, detail: 'Within limit of 2' }, { label: 'Tier rule', passed: false, detail: 'Lower tier than accepted offer' }] } });
    renderPage(<FacultyOffers />);
    const dlg = await openCreateDialog();
    await userEvent.tripleClick(within(dlg).getByLabelText('Package (LPA)')); // select the default and replace it
    await userEvent.keyboard('10');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create offer' }));
    await waitFor(() => expect(api.offersApi.create).toHaveBeenCalledTimes(1));
    const [appId, ctc, acceptBy] = api.offersApi.create.mock.calls[0];
    expect(appId).toBe('a9');
    expect(ctc).toBe(10);
    expect(acceptBy).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO timestamp
    expect(await within(dlg).findByText('Offer created')).toBeInTheDocument();
    expect(within(dlg).getByText(/Within limit of 2/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Lower tier than accepted offer/)).toBeInTheDocument();
    await waitFor(() => expect(api.offersApi.listAll).toHaveBeenCalledTimes(2)); // list refreshed
  });

  it('create is blocked for a non-positive package (no API call)', async () => {
    renderPage(<FacultyOffers />);
    const dlg = await openCreateDialog();
    await userEvent.tripleClick(within(dlg).getByLabelText('Package (LPA)'));
    await userEvent.keyboard('0');
    expect(within(dlg).getByLabelText('Package (LPA)')).toHaveValue(0);
    expect(within(dlg).getByRole('button', { name: 'Create offer' })).toBeDisabled();
    expect(api.offersApi.create).not.toHaveBeenCalled();
  });

  it('clearing the package field leaves it empty so a new value can be typed', async () => {
    renderPage(<FacultyOffers />);
    const dlg = await openCreateDialog();
    await userEvent.clear(within(dlg).getByLabelText('Package (LPA)'));
    expect(within(dlg).getByLabelText('Package (LPA)')).toHaveValue(null);
    expect(within(dlg).getByRole('button', { name: 'Create offer' })).toBeDisabled();
  });

  it('a 409 policy failure is shown inside the dialog; no success state, no list refresh', async () => {
    api.offersApi.create.mockRejectedValue(new ApiError(409, 'Policy check failed: student already holds the maximum number of accepted offers.', 'conflict'));
    renderPage(<FacultyOffers />);
    const dlg = await openCreateDialog();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create offer' }));
    expect(await within(dlg).findByText('Policy check failed: student already holds the maximum number of accepted offers.')).toBeInTheDocument();
    expect(screen.queryByText('Offer created')).not.toBeInTheDocument(); // neither the dialog's success title nor a success toast
    expect(within(dlg).getByRole('button', { name: 'Create offer' })).toBeEnabled(); // can retry/adjust
    expect(api.offersApi.listAll).toHaveBeenCalledTimes(1);
  });

  it('status menu calls offersApi.setStatus; an offer with no further transitions has a disabled menu', async () => {
    api.offersApi.listAll.mockResolvedValue(list({ rows: [offer('1', 'Ann Alpha', 'received'), offer('3', 'Eve Epsilon', 'declined')] }));
    api.offersApi.setStatus.mockResolvedValue(offer('1', 'Ann Alpha', 'accepted'));
    renderPage(<FacultyOffers />);
    await screen.findByText('Ann Alpha');
    expect(screen.getByRole('button', { name: 'Update offer status for Eve Epsilon' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Update offer status for Ann Alpha' }));
    expect(await screen.findAllByRole('menuitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark accepted' }));
    const dlg = await screen.findByRole('dialog', { name: 'Mark offer as accepted?' });
    expect(within(dlg).queryByLabelText('Reason for withdrawal')).not.toBeInTheDocument(); // reason only for withdrawals
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.offersApi.setStatus).toHaveBeenCalledWith('1', 'accepted', undefined));
    expect(await screen.findByText('Offer accepted')).toBeInTheDocument();
    await waitFor(() => expect(api.offersApi.listAll).toHaveBeenCalledTimes(2));
  });

  it('withdrawing requires a reason, which is sent to setStatus', async () => {
    api.offersApi.setStatus.mockResolvedValue(offer('1', 'Ann Alpha', 'withdrawn'));
    renderPage(<FacultyOffers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update offer status for Ann Alpha' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark withdrawn' }));
    const dlg = await screen.findByRole('dialog', { name: 'Mark offer as withdrawn?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    expect(await within(dlg).findByText('Reason for withdrawal is required.')).toBeInTheDocument();
    expect(api.offersApi.setStatus).not.toHaveBeenCalled();
    await userEvent.type(within(dlg).getByLabelText('Reason for withdrawal'), 'Candidate joined elsewhere');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.offersApi.setStatus).toHaveBeenCalledWith('1', 'withdrawn', 'Candidate joined elsewhere'));
  });

  it('a refused status change is shown in the dialog and the list is not refreshed', async () => {
    api.offersApi.setStatus.mockRejectedValue(new ApiError(409, 'Policy check failed: maximum accepted offers reached.', 'conflict'));
    renderPage(<FacultyOffers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update offer status for Ann Alpha' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark accepted' }));
    const dlg = await screen.findByRole('dialog', { name: 'Mark offer as accepted?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    expect(await within(dlg).findByText('Policy check failed: maximum accepted offers reached.')).toBeInTheDocument();
    expect(screen.queryByText('Offer accepted')).not.toBeInTheDocument();
    expect(api.offersApi.listAll).toHaveBeenCalledTimes(1);
  });

  it('without offers.manage there are no row actions and no Create offer button', async () => {
    as('students.view');
    renderPage(<FacultyOffers />);
    await screen.findByText('Ann Alpha');
    expect(screen.queryByRole('button', { name: /Update offer status/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Selected, awaiting offer/ }));
    expect(await screen.findByText('Cara Gamma')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create offer' })).not.toBeInTheDocument();
  });

  it('403 on the list renders permission-denied; 501 renders not-available; 500 offers Retry', async () => {
    api.offersApi.listAll.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const first = renderPage(<FacultyOffers />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByText('Ann Alpha')).not.toBeInTheDocument();
    first.unmount();

    api.offersApi.listAll.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    const second = renderPage(<FacultyOffers />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    second.unmount();

    api.offersApi.listAll.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    renderPage(<FacultyOffers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
  });
});
