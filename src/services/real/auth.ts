import type { User } from '@/types';
import type { AuthPayload, AuthService, ChangePasswordRequest, LoginRequest, LoginResponse, OnboardingData, ResetPasswordRequest } from '../contracts/auth';
import { getAccessToken, http, refreshSession, setAccessToken } from '../http';

const strip = ({ user, permissions }: LoginResponse): AuthPayload => ({ user, permissions });

export const authService: AuthService = {
  async login(identifier, password, remember) {
    const body: LoginRequest = { identifier, password, remember };
    const res = await http.post<LoginResponse>('/auth/login', body, false);
    setAccessToken(res.accessToken);
    return strip(res);
  },
  /** Restores a session after a page load: silent refresh via the httpOnly cookie, then GET /auth/me. */
  async me() {
    if (!getAccessToken() && !(await refreshSession())) return null;
    try { return await http.get<AuthPayload>('/auth/me'); } catch { return null; }
  },
  async logout() {
    try { await http.post<{ ok: boolean }>('/auth/logout'); } finally { setAccessToken(null); }
  },
  forgotPassword: (email) => http.post<{ message: string }>('/auth/forgot-password', { email }, false),
  async resetPassword(token, password) {
    const body: ResetPasswordRequest = { token, password };
    await http.post<{ ok: boolean }>('/auth/reset-password', body, false);
  },
  changePassword(currentPassword, newPassword) {
    const body: ChangePasswordRequest = { currentPassword, newPassword };
    return http.post<{ ok: boolean }>('/auth/change-password', body);
  },
  completeOnboarding: (data: OnboardingData) => http.post<User>('/student/onboarding', data),
};
