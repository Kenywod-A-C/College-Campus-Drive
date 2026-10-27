// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { ReportData } from '@/types/views';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  reportsApi: { placement: vi.fn(), exportPlacementCsv: vi.fn(), filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { PlacementReports } from '../Reports';

const report = (over: Partial<ReportData['kpis']> = {}): ReportData => ({
  kpis: { eligibleStudents: 300, appliedStudents: 210, uniqueStudentsPlaced: 62, totalOffers: 91, acceptedOffers: 77, placementPct: 62, totalStudents: 100, ...over },
  offersByDept: [{ dept: 'CSE', offers: 40, accepted: 30, placedStudents: 25, students: 100 }],
  companyOffers: [{ company: 'Zoho', offers: 40, accepted: 30 }],
  eligibleVsApplied: [{ dept: 'CSE', eligible: 80, applied: 60 }],
  funnel: [{ stage: 'Applied', count: 210 }, { stage: 'Selected', count: 70 }],
  monthly: [{ month: 'Jan', applications: 50, offers: 10 }],
  statusDist: [{ status: 'applied', count: 133 }, { status: 'rejected', count: 44 }],
});
const as = (...permissions: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions });
const spyDownload = () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  return click;
};

beforeEach(() => {
  vi.clearAllMocks();
  as('reports.view');
  api.reportsApi.filterOptions.mockResolvedValue({
    departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [{ value: '2027', label: 'Batch 2027' }],
    companies: [{ value: '3', label: 'Zoho' }], jobs: [{ value: '11', label: 'Software Developer', companyId: '3' }],
  });
  api.reportsApi.placement.mockResolvedValue(report());
});

describe('placement reports page', () => {
  it('shows a skeleton, then the KPIs and status distribution from reportsApi.placement', async () => {
    let resolve!: (v: unknown) => void;
    api.reportsApi.placement.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage(<PlacementReports />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    resolve(report());
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(screen.getByText('62 of 100 students')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();      // total offers
    expect(screen.getByText('77')).toBeInTheDocument();      // accepted offers
    expect(screen.getByText('300 / 210')).toBeInTheDocument(); // eligible / applied
    expect(screen.getByText('133')).toBeInTheDocument();    // status distribution
    expect(screen.getByText('rejected')).toBeInTheDocument();
    expect(api.reportsApi.placement).toHaveBeenLastCalledWith({});
  });

  it('passes the chosen filters through to the server, and "Clear filters" resets them', async () => {
    renderPage(<PlacementReports />);
    await screen.findByText('62%');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Department'));
    await userEvent.click(await screen.findByRole('option', { name: 'CSE' }));
    await waitFor(() => expect(api.reportsApi.placement).toHaveBeenLastCalledWith({ dept: '1' }));
    await userEvent.click(screen.getByLabelText('Company'));
    await userEvent.click(await screen.findByRole('option', { name: 'Zoho' }));
    await waitFor(() => expect(api.reportsApi.placement).toHaveBeenLastCalledWith({ dept: '1', companyId: '3', jobId: undefined }));
    await userEvent.click(screen.getByLabelText('Offer status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Accepted' }));
    await waitFor(() => expect(api.reportsApi.placement).toHaveBeenLastCalledWith(expect.objectContaining({ dept: '1', companyId: '3', offerStatus: 'accepted' })));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(api.reportsApi.placement).toHaveBeenLastCalledWith({}));
  });

  it('Export CSV calls exportPlacementCsv with the active filters and reports success', async () => {
    const click = spyDownload();
    api.reportsApi.exportPlacementCsv.mockResolvedValue('company,offers\nZoho,40');
    renderPage(<PlacementReports />);
    await screen.findByText('62%');
    await userEvent.click(screen.getByLabelText('Department'));
    await userEvent.click(await screen.findByRole('option', { name: 'CSE' }));
    await waitFor(() => expect(api.reportsApi.placement).toHaveBeenLastCalledWith({ dept: '1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export offers CSV' }));
    await waitFor(() => expect(api.reportsApi.exportPlacementCsv).toHaveBeenCalledWith({ dept: '1' }));
    expect(await screen.findByText('Export downloaded')).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('a failing export shows an error toast and downloads nothing', async () => {
    const click = spyDownload();
    api.reportsApi.exportPlacementCsv.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderPage(<PlacementReports />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export offers CSV' }));
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByText('Export downloaded')).not.toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('users without reports.view are not offered the export', async () => {
    as('students.view');
    renderPage(<PlacementReports />);
    await screen.findByText('62%');
    expect(screen.queryByRole('button', { name: 'Export offers CSV' })).not.toBeInTheDocument();
  });

  it('403 renders permission-denied and no KPIs', async () => {
    api.reportsApi.placement.mockRejectedValue(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    renderPage(<PlacementReports />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByText('62%')).not.toBeInTheDocument();
  });

  it('501 renders "Not available yet" without Retry', async () => {
    api.reportsApi.placement.mockRejectedValue(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    renderPage(<PlacementReports />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a 500 offers Retry which re-queries and then shows the data', async () => {
    api.reportsApi.placement.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    renderPage(<PlacementReports />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(api.reportsApi.placement).toHaveBeenCalledTimes(2);
  });
});
