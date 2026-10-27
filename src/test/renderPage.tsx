// Test harness for page-level tests: real theme, router, toasts and AuthProvider. Each test fakes '@/api' (vi.hoisted + vi.mock)
// and sets what `authApi.me` returns, so permission-dependent UI can be exercised.
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { render } from '@testing-library/react';
import type { Role, User } from '@/types';
import { theme } from '@/theme/theme';
import { ToastProvider } from '@/components/Toast';
import { AuthProvider } from '@/auth/AuthContext';
import { BaseContext, type Base } from '@/layouts/useBase';

export const makeUser = (role: Role = 'faculty', over: Partial<User> = {}): User => ({
  id: '1', userCode: 'FAC101', name: 'Dr. Priya Raman', email: 'faculty@campus.test', role, status: 'active', createdAt: new Date().toISOString(), ...over,
});

/** Renders `ui` at `route` (matched by `path`) inside the providers the real app uses. */
export function renderPage(ui: ReactElement, { route = '/', path = '*', base = '/faculty' as Base } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <BaseContext.Provider value={base}>
              <Routes>
                <Route path={path} element={ui} />
                <Route path="*" element={<div data-testid="navigated">navigated</div>} />
              </Routes>
            </BaseContext.Provider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}
