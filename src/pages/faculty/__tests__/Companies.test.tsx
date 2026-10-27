// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import { company, pageOf } from '@/test/fixtures';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  companiesApi: { list: vi.fn(), get: vi.fn(), save: vi.fn(), archive: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { FacultyCompanies } from '../Companies';

const row = (over = {}) => ({ company: company(over), jobCount: 3, activeJobs: 1, offers: 2 });
const list = (rows: ReturnType<typeof row>[]) => ({ ...pageOf(rows), industries: ['SaaS'] });
const as = (...p: string[]) => api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: p });

beforeEach(() => {
  vi.clearAllMocks();
  as('companies.manage', 'jobs.create');
  api.companiesApi.list.mockResolvedValue(list([row()]));
});

describe('company directory', () => {
  it('lists companies with job counts and offers things to manage', async () => {
    renderPage(<FacultyCompanies />);
    expect(await screen.findByText('Zoho')).toBeInTheDocument();
    expect(screen.getByText('1 active / 3')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Archive Zoho' })).toBeInTheDocument();
  });

  it('archiving needs confirmation, calls the API, and reloads', async () => {
    api.companiesApi.archive.mockResolvedValue(company({ archivedAt: '2030-01-01T00:00:00Z' }));
    renderPage(<FacultyCompanies />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Zoho' }));
    const dlg = await screen.findByRole('dialog');
    expect(api.companiesApi.archive).not.toHaveBeenCalled();
    expect(within(dlg).getByText(/hidden from the default lists/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.companiesApi.archive).toHaveBeenCalledWith('3', true));
    expect(await screen.findByText('Zoho archived')).toBeInTheDocument();
    await waitFor(() => expect(api.companiesApi.list).toHaveBeenCalledTimes(2));
  });

  it('a company with published jobs is refused by the server and the message is shown (no false success)', async () => {
    api.companiesApi.archive.mockRejectedValue(new ApiError(409, 'Zoho has 1 published job(s). Close or cancel them before archiving the company.', 'conflict'));
    renderPage(<FacultyCompanies />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Zoho' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }));
    expect(await within(screen.getByRole('dialog')).findByText(/has 1 published job/)).toBeInTheDocument();
    expect(screen.queryByText('Zoho archived')).not.toBeInTheDocument();
  });

  it('archived companies are marked, cannot be edited, and can be restored', async () => {
    api.companiesApi.list.mockResolvedValue(list([row({ archivedAt: '2030-01-01T00:00:00Z' })]));
    api.companiesApi.archive.mockResolvedValue(company());
    renderPage(<FacultyCompanies />);
    expect(within((await screen.findByText('Zoho')).closest('tr')!).getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Zoho' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore Zoho' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(api.companiesApi.archive).toHaveBeenCalledWith('3', false));
  });

  it('requests archived companies from the server only when asked', async () => {
    renderPage(<FacultyCompanies />);
    await screen.findByText('Zoho');
    expect(api.companiesApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ archived: expect.anything() }));
    await userEvent.click(screen.getByLabelText('Archived'));
    await userEvent.click(await screen.findByRole('option', { name: 'Include archived' }));
    await waitFor(() => expect(api.companiesApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ archived: 'include' })));
  });

  it('without companies.manage there are no edit or archive controls', async () => {
    as('jobs.create');
    renderPage(<FacultyCompanies />);
    await screen.findByText('Zoho');
    expect(screen.queryByRole('button', { name: /Archive Zoho|Edit Zoho|Add company/ })).not.toBeInTheDocument();
  });

  it('403 and 501 are shown honestly', async () => {
    api.companiesApi.list.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to view this.', 'forbidden'));
    const first = renderPage(<FacultyCompanies />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    first.unmount();
    api.companiesApi.list.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    renderPage(<FacultyCompanies />);
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
  });
});
