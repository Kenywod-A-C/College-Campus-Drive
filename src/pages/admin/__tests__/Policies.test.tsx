// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { PlacementPolicy } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  adminApi: { policies: vi.fn(), savePolicy: vi.fn(), deletePolicy: vi.fn() },
  reportsApi: { filterOptions: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { AdminPolicies } from '../Policies';

const policy = (over: Partial<PlacementPolicy> = {}): PlacementPolicy => ({
  id: 'p1', name: 'Two offer cap', description: 'Students may hold two accepted offers.', kind: 'max_offers', scope: 'college', params: { maxAcceptedOffers: 2 }, enabled: true,
  updatedAt: '2030-01-05T00:00:00Z', updatedBy: 'Admin One', ...over,
});
const p1 = policy();
const p2 = policy({ id: 'p2', name: 'Dream restriction', kind: 'tier_restriction', scope: 'department', scopeValue: '1', params: { allowOnlyHigherTier: true }, enabled: false });
const render = () => renderPage(<AdminPolicies />, { base: '/admin' });
const openAdd = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Add policy' })); return screen.findByRole('dialog', { name: 'Add policy' }); };
const chooseKind = async (dlg: HTMLElement, label: string) => { await userEvent.click(within(dlg).getByLabelText('Policy type')); await userEvent.click(await screen.findByRole('option', { name: label })); };

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('admin'), permissions: ['policies.manage'] });
  api.reportsApi.filterOptions.mockResolvedValue({ departments: [{ value: '1', label: 'CSE', name: 'Computer Science' }], graduationYears: [{ value: '2027', label: '2027' }], companies: [], jobs: [] });
  api.adminApi.policies.mockResolvedValue([p1, p2]);
  api.adminApi.savePolicy.mockResolvedValue(p1);
});

describe('admin policies list', () => {
  it('groups policies by kind and shows scope, enabled state and parameters', async () => {
    render();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Maximum offer rule' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dream / Super Dream restriction' })).toBeInTheDocument();
    const cap = screen.getByRole('heading', { name: 'Two offer cap' }).closest('.MuiCard-root') as HTMLElement;
    expect(within(cap).getByText('Whole college')).toBeInTheDocument();
    expect(within(cap).getByText('Enabled')).toBeInTheDocument();
    expect(within(cap).getByText('max accepted offers: 2')).toBeInTheDocument();
    const dream = screen.getByRole('heading', { name: 'Dream restriction' }).closest('.MuiCard-root') as HTMLElement;
    expect(within(dream).getByText('Disabled')).toBeInTheDocument();
    await waitFor(() => expect(within(dream).getByText('Department: CSE')).toBeInTheDocument()); // scope value resolved via filter options
  });

  it('shows an empty state when no policy exists', async () => {
    api.adminApi.policies.mockResolvedValue([]);
    render();
    expect(await screen.findByText('No policies configured')).toBeInTheDocument();
  });

  it('403 renders permission-denied; 501 renders not-available without Retry; 500 Retry reloads', async () => {
    api.adminApi.policies.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const a = render();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    a.unmount();
    api.adminApi.policies.mockRejectedValueOnce(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    const b = render();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    b.unmount();
    api.adminApi.policies.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Two offer cap' })).toBeInTheDocument();
  });
});

describe('policy dialog', () => {
  it('requires a name and a whole-number parameter, and a department/batch for a scoped policy', async () => {
    render();
    const dlg = await openAdd();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    expect(await within(dlg).findByText('Name is required')).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText('Policy name'), 'Cap');
    await userEvent.clear(within(dlg).getByLabelText('Maximum accepted offers'));
    await userEvent.type(within(dlg).getByLabelText('Maximum accepted offers'), '0');
    await userEvent.click(within(dlg).getByLabelText('Applies to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Department' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    expect(await within(dlg).findByText('Enter a whole number of at least 1')).toBeInTheDocument();
    expect(within(dlg).getByText('Choose a department')).toBeInTheDocument();
    expect(api.adminApi.savePolicy).not.toHaveBeenCalled();
  });

  it('creates a max_offers policy with the right payload (college scope sends no scopeValue)', async () => {
    render();
    const dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Policy name'), '  Three offer cap ');
    await userEvent.type(within(dlg).getByLabelText('Description'), 'Cap at three');
    await userEvent.clear(within(dlg).getByLabelText('Maximum accepted offers'));
    await userEvent.type(within(dlg).getByLabelText('Maximum accepted offers'), '3');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(api.adminApi.savePolicy).toHaveBeenCalledWith({ id: undefined, name: 'Three offer cap', description: 'Cap at three', kind: 'max_offers', scope: 'college', scopeValue: undefined, params: { maxAcceptedOffers: 3 }, enabled: true }));
    expect(await screen.findByText('Policy created')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add policy' })).not.toBeInTheDocument());
    expect(api.adminApi.policies).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Application restriction', 'Maximum active applications per student', '5', { maxActiveApplications: 5 }, 'application_limit'],
    ['Accepted-offer rule', 'Acceptance window (days)', '21', { acceptanceWindowDays: 21 }, 'accepted_offer'],
  ] as const)('%s sends only its own parameter', async (kindLabel, field, value, params, kind) => {
    render();
    const dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Policy name'), 'P');
    await chooseKind(dlg, kindLabel);
    expect(within(dlg).queryByLabelText('Maximum accepted offers')).not.toBeInTheDocument();
    await userEvent.clear(within(dlg).getByLabelText(field));
    await userEvent.type(within(dlg).getByLabelText(field), value);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(api.adminApi.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ kind, params, scope: 'college', enabled: true })));
  });

  it('tier restriction (department scope) and exception approval send boolean params and the scope value', async () => {
    render();
    let dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Policy name'), 'Tier');
    await chooseKind(dlg, 'Dream / Super Dream restriction');
    await userEvent.click(within(dlg).getByLabelText('After accepting an offer, allow applications to a higher company tier only')); // untick the default
    await userEvent.click(within(dlg).getByLabelText('Applies to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Department' }));
    await userEvent.click(within(dlg).getByRole('combobox', { name: /^Department/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'CSE — Computer Science' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(api.adminApi.savePolicy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'tier_restriction', scope: 'department', scopeValue: '1', params: { allowOnlyHigherTier: false } })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add policy' })).not.toBeInTheDocument());

    dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Policy name'), 'Exceptions');
    await chooseKind(dlg, 'Exception approval');
    await userEvent.click(within(dlg).getByLabelText('Require a written reason'));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(api.adminApi.savePolicy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'exception_approval', params: { requireReason: false, requireApprover: true } })));
  });

  it.each([
    [422, 'Maximum accepted offers must be at most 10.', 'validation_error'],
    [409, 'A policy with this name already exists.', 'conflict'],
  ])('a %i error from savePolicy is shown in the dialog, which stays open', async (status, message, code) => {
    api.adminApi.savePolicy.mockRejectedValue(new ApiError(status, message, code));
    render();
    const dlg = await openAdd();
    await userEvent.type(within(dlg).getByLabelText('Policy name'), 'Dup');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    expect(await within(dlg).findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add policy' })).toBeInTheDocument();
    expect(screen.queryByText('Policy created')).not.toBeInTheDocument();
    expect(api.adminApi.policies).toHaveBeenCalledTimes(1);
  });

  it('editing keeps the policy type locked and sends the id with the existing parameters', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Two offer cap' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit policy' });
    expect(within(dlg).getByLabelText('Policy name')).toHaveValue('Two offer cap');
    expect(within(dlg).getByLabelText('Maximum accepted offers')).toHaveValue(2);
    expect(within(dlg).getByLabelText('Policy type')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(api.adminApi.savePolicy).toHaveBeenCalledWith({ id: 'p1', name: 'Two offer cap', description: 'Students may hold two accepted offers.', kind: 'max_offers', scope: 'college', scopeValue: undefined, params: { maxAcceptedOffers: 2 }, enabled: true }));
    expect(await screen.findByText('Policy updated')).toBeInTheDocument();
  });
});

describe('enable / disable and delete', () => {
  it('toggling confirms, then saves the same policy with enabled flipped (no server-owned fields)', async () => {
    render();
    await userEvent.click(await screen.findByRole('switch', { name: 'Disable Two offer cap' }));
    const dlg = await screen.findByRole('dialog', { name: 'Disable policy?' });
    expect(api.adminApi.savePolicy).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(api.adminApi.savePolicy).toHaveBeenCalledTimes(1));
    const sent = api.adminApi.savePolicy.mock.calls[0][0];
    expect(sent).toEqual({ id: 'p1', name: 'Two offer cap', description: 'Students may hold two accepted offers.', kind: 'max_offers', scope: 'college', params: { maxAcceptedOffers: 2 }, enabled: false });
    expect(sent).not.toHaveProperty('updatedAt');
    expect(sent).not.toHaveProperty('updatedBy');
    expect(await screen.findByText('Two offer cap disabled')).toBeInTheDocument();
  });

  it('a refused toggle (409) is shown in the confirm dialog and no success is claimed', async () => {
    api.adminApi.savePolicy.mockRejectedValue(new ApiError(409, 'Policy was changed by someone else.', 'conflict'));
    render();
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable Dream restriction' }));
    const dlg = await screen.findByRole('dialog', { name: 'Enable policy?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Enable' }));
    expect(await within(dlg).findByText('Policy was changed by someone else.')).toBeInTheDocument();
    expect(screen.queryByText('Dream restriction enabled')).not.toBeInTheDocument();
  });

  it('deleting requires a reason, which is passed to deletePolicy(id, reason)', async () => {
    api.adminApi.deletePolicy.mockResolvedValue({ ok: true });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Two offer cap' }));
    const dlg = await screen.findByRole('dialog', { name: 'Delete policy?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete policy' }));
    expect(await within(dlg).findByText('Reason for deleting is required.')).toBeInTheDocument();
    expect(api.adminApi.deletePolicy).not.toHaveBeenCalled();
    await userEvent.type(within(dlg).getByLabelText('Reason for deleting'), 'Superseded by new rules');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete policy' }));
    await waitFor(() => expect(api.adminApi.deletePolicy).toHaveBeenCalledWith('p1', 'Superseded by new rules'));
    expect(await screen.findByText('Policy deleted')).toBeInTheDocument();
    await waitFor(() => expect(api.adminApi.policies).toHaveBeenCalledTimes(2));
  });

  it('a failed delete shows the server message in the dialog and does not reload', async () => {
    api.adminApi.deletePolicy.mockRejectedValue(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Two offer cap' }));
    const dlg = await screen.findByRole('dialog', { name: 'Delete policy?' });
    await userEvent.type(within(dlg).getByLabelText('Reason for deleting'), 'No longer needed');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete policy' }));
    expect(await within(dlg).findByText('This feature is not available on the server yet.')).toBeInTheDocument();
    expect(screen.queryByText('Policy deleted')).not.toBeInTheDocument();
    expect(api.adminApi.policies).toHaveBeenCalledTimes(1);
  });
});
