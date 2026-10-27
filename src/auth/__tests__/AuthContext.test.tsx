// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { makeUser } from '@/test/renderPage';

const api = vi.hoisted(() => ({ authApi: { me: vi.fn(), logout: vi.fn(), login: vi.fn() } }));
vi.mock('@/api', () => api);

import { AuthProvider, useAuth } from '../AuthContext';

function Probe() {
  const { user, loading, can, logout } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : user ? `in:${user.role}` : 'out'}</span>
      <span data-testid="can">{String(can('students.view'))}</span>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

beforeEach(() => { vi.clearAllMocks(); api.authApi.logout.mockResolvedValue(undefined); });

describe('AuthProvider and HTTP 401 handling', () => {
  it('a ca:unauthorized event (refresh failed) signs the user out and drops their permissions', async () => {
    api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: ['students.view'] });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('in:faculty')).toBeInTheDocument();
    expect(screen.getByTestId('can')).toHaveTextContent('true');
    await act(async () => { window.dispatchEvent(new Event('ca:unauthorized')); });
    expect(await screen.findByText('out')).toBeInTheDocument();
    expect(screen.getByTestId('can')).toHaveTextContent('false');
  });

  it('logout clears local state even when the server call fails', async () => {
    api.authApi.me.mockResolvedValue({ user: makeUser('faculty'), permissions: [] });
    api.authApi.logout.mockRejectedValue(new Error('offline'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('in:faculty');
    await act(async () => { screen.getByText('logout').click(); });
    expect(await screen.findByText('out')).toBeInTheDocument();
  });

  it('no session on load means signed out (no crash)', async () => {
    api.authApi.me.mockResolvedValue(null);
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('out')).toBeInTheDocument();
  });
});
