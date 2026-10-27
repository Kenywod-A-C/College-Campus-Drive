// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  adminApi: { settings: vi.fn(), saveSettings: vi.fn() },
  authApi: { me: vi.fn(), logout: vi.fn() },
}));
vi.mock('@/api', () => api);

import { AdminSettings } from '../SystemSettings';

const settings = () => ({
  collegeName: 'Campus College', collegeEmail: 'placements@campus.test', academicYear: '2026-27', placementSeason: 'Autumn 2026', notifyEmailEnabled: false, notifyDigestHour: 8, sessionTimeoutMins: 60, maintenanceBanner: false,
  aiProvider: { configured: true, model: 'campus-model-1', ragIndexed: 12, ragFailed: 3 },
});
const render = () => renderPage(<AdminSettings />, { base: '/admin' });

beforeEach(() => {
  vi.clearAllMocks();
  api.authApi.me.mockResolvedValue({ user: makeUser('admin'), permissions: [] });
  api.adminApi.settings.mockResolvedValue(settings());
});

describe('admin system settings', () => {
  it('501 from adminApi.settings renders the honest "Not available yet" state: no form, no Retry', async () => {
    api.adminApi.settings.mockRejectedValue(new ApiError(501, 'This feature is not available on the server yet.', 'not_implemented'));
    render();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.getByText('This feature is not available on the server yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('College name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('403 renders permission-denied; a 500 offers Retry', async () => {
    api.adminApi.settings.mockRejectedValueOnce(new ApiError(403, 'You do not have permission to do this.', 'forbidden'));
    const a = render();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    a.unmount();
    api.adminApi.settings.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem. Please try again shortly.', 'server_error'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('College name')).toHaveValue('Campus College');
  });

  it('shows the loaded settings and AI provider status (never keys)', async () => {
    render();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(await screen.findByLabelText('College name')).toHaveValue('Campus College');
    expect(screen.getByLabelText('Placement office email')).toHaveValue('placements@campus.test');
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('campus-model-1')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled(); // nothing changed yet
  });

  it('validates the session timeout and sends numbers when saving valid settings', async () => {
    api.adminApi.saveSettings.mockResolvedValue(settings());
    render();
    const timeout = await screen.findByLabelText('Session timeout (minutes)');
    await userEvent.clear(timeout);
    await userEvent.type(timeout, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Enter 5–1440 minutes')).toBeInTheDocument();
    expect(api.adminApi.saveSettings).not.toHaveBeenCalled();
    await userEvent.clear(timeout);
    await userEvent.type(timeout, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.adminApi.saveSettings).toHaveBeenCalledWith({ ...settings(), aiProvider: undefined, sessionTimeoutMins: 30, notifyDigestHour: 8 }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('a save error (422) is shown on the form and no success is claimed', async () => {
    api.adminApi.saveSettings.mockRejectedValue(new ApiError(422, 'Academic year must be the current or next year.', 'validation_error'));
    render();
    const name = await screen.findByLabelText('College name');
    await userEvent.type(name, ' Autonomous');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Academic year must be the current or next year.')).toBeInTheDocument();
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument();
  });
});
