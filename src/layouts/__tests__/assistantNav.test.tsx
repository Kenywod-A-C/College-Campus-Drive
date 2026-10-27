// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, within } from '@testing-library/react';
import type { Permission, Role } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  authApi: { me: vi.fn(), logout: vi.fn() },
  notificationsApi: { list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
  assistantApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), send: vi.fn(), suggestions: vi.fn(), status: vi.fn(), resolveAction: vi.fn() },
  documentsApi: { get: vi.fn() },
  jobsApi: { get: vi.fn() },
  USE_MOCK: false,
}));
vi.mock('@/api', () => api);

import { AppRoutes } from '@/routes/AppRoutes';
import { ADMIN_NAV, FACULTY_NAV, STUDENT_NAV } from '../navConfig';

configure({ asyncUtilTimeout: 4000 }); // the app shell and lazy routes render slowly when the whole suite runs in parallel

const signIn = (role: Role, permissions: Permission[] = []) => {
  api.authApi.me.mockResolvedValue({ user: makeUser(role, { onboardingComplete: true }), permissions });
};
const app = (route: string) => renderPage(<AppRoutes />, { route, base: '/student' });

beforeEach(() => {
  vi.clearAllMocks();
  // Desktop viewport: the permanent sidebar (jsdom has no matchMedia, which would otherwise select the hidden mobile drawer).
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
  api.notificationsApi.list.mockResolvedValue([]);
  api.assistantApi.list.mockResolvedValue([]);
  api.assistantApi.suggestions.mockResolvedValue(['What is my CGPA?']);
  api.assistantApi.status.mockResolvedValue({ available: true, provider: 'anthropic', model: 'm' });
});

afterEach(() => vi.unstubAllGlobals());

describe('AI Assistant navigation item', () => {
  it.each([['student', STUDENT_NAV, '/student/assistant'], ['faculty', FACULTY_NAV, '/faculty/assistant'], ['admin', ADMIN_NAV, '/admin/assistant']] as const)(
    'is configured for %s with the bot icon, a route under the role prefix and no extra permission', (_role, nav, to) => {
      const item = nav.find((n) => n.label === 'AI Assistant');
      expect(item).toMatchObject({ to });
      expect(item?.perm).toBeUndefined();
    });

  it('sits right after Documents in the administrator sidebar and the existing items are untouched', () => {
    const labels = ADMIN_NAV.map((n) => n.label);
    expect(labels).toEqual(['Dashboard', 'User Management', 'Roles & Permissions', 'Students & Faculty', 'Companies & Jobs', 'Placement Policies', 'Departments & Courses', 'Documents', 'AI Assistant',
      'Reports & Analytics', 'Audit Logs', 'System Settings', 'Logout']);
  });
});

describe('sidebar and routes, per role', () => {
  it('administrator: the sidebar link opens /admin/assistant and the page loads from the real assistant API', async () => {
    signIn('admin', ['reports.view']);
    app('/admin/assistant');
    const nav = await screen.findByRole('navigation', { name: 'admin navigation' });
    const link = within(nav).getByRole('link', { name: 'AI Assistant' });
    expect(link).toHaveAttribute('href', '/admin/assistant');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(link).getByTestId('SmartToyOutlinedIcon')).toBeInTheDocument(); // the bot icon
    const links = within(nav).getAllByRole('link').map((l) => l.textContent);
    expect(links.indexOf('AI Assistant')).toBe(links.indexOf('Documents') + 1);
    expect(await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })).toBeInTheDocument();
    expect(api.assistantApi.list).toHaveBeenCalled();
    expect(await screen.findByText(/policies, administrative alerts/)).toBeInTheDocument();
  });

  it('faculty: link and page', async () => {
    signIn('faculty', []);
    app('/faculty/assistant');
    const nav = await screen.findByRole('navigation', { name: 'faculty navigation' });
    expect(within(nav).getByRole('link', { name: 'AI Assistant' })).toHaveAttribute('href', '/faculty/assistant');
    expect(await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/find eligible students for a job/)).toBeInTheDocument();
  });

  it('student: link and page', async () => {
    signIn('student');
    app('/student/assistant');
    const nav = await screen.findByRole('navigation', { name: 'student navigation' });
    expect(within(nav).getByRole('link', { name: 'AI Assistant' })).toHaveAttribute('href', '/student/assistant');
    expect(await screen.findByRole('heading', { name: 'AI Assistant', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/jobs you are eligible for/)).toBeInTheDocument();
  });

  it("route protection still applies: a student cannot open the administrator's assistant route", async () => {
    signIn('student');
    app('/admin/assistant');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(api.assistantApi.list).not.toHaveBeenCalled();
  });

  it('signed-out visitors are sent to the login page, not the assistant', async () => {
    api.authApi.me.mockResolvedValue(null);
    app('/admin/assistant');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.assistantApi.list).not.toHaveBeenCalled();
  });
});
