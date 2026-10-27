import { ApiError, type Student } from '@/types';
import type { AuthPayload } from '../contracts/auth';
import { DEMO_PASSWORD } from './demo';
import { audit, computeCompletion, students, users } from '@/mock/db';
import { call, clearToken, sleep, storeToken, sessionFor, requireStudent } from './client';
import { rolePermissions } from '@/mock/db';

export const authApi = {
  /** POST /auth/login */
  async login(identifier: string, password: string, remember: boolean): Promise<AuthPayload> {
    await sleep(500);
    const id = identifier.trim().toLowerCase();
    const user = users.find((u) => u.email.toLowerCase() === id || u.userCode.toLowerCase() === id);
    if (!user || password !== DEMO_PASSWORD) {
      audit('unknown', 'system', 'auth.login', `Session (${identifier})`, 'denied', 'Invalid credentials');
      throw new ApiError(401, 'Incorrect email/ID or password.');
    }
    if (user.status !== 'active') throw new ApiError(403, 'This account is not active. Contact the placement office.');
    user.lastLoginAt = new Date().toISOString();
    storeToken(user.id, remember);
    audit(user.name, user.role, 'auth.login', 'Session', 'success');
    return { user: structuredClone(user), permissions: [...rolePermissions[user.role]] };
  },
  /** GET /auth/me */
  async me(): Promise<AuthPayload | null> {
    await sleep(80);
    const raw = (() => { try { return sessionStorage.getItem('ca_session') ?? localStorage.getItem('ca_session'); } catch { return null; } })();
    const s = sessionFor(raw);
    return s ? { user: structuredClone(s.user), permissions: [...s.permissions] } : null;
  },
  /** POST /auth/logout */
  async logout(): Promise<void> {
    await sleep(80);
    clearToken();
  },
  /** POST /auth/forgot-password — always returns the same message to avoid account enumeration. */
  async forgotPassword(_email: string): Promise<{ message: string }> {
    await sleep(500);
    return { message: 'If an account exists for that address, a reset link has been sent. (Demo: no email is actually sent.)' };
  },
  /** POST /auth/reset-password */
  async resetPassword(token: string, _password: string): Promise<void> {
    await sleep(500);
    if (!token) throw new ApiError(400, 'This reset link is invalid or has expired. Request a new one.');
  },
  /** POST /auth/change-password */
  changePassword: (current: string, next: string) => call('POST', '/auth/change-password', (s) => {
    if (current !== DEMO_PASSWORD) throw new ApiError(400, 'Current password is incorrect.');
    if (next.length < 8) throw new ApiError(400, 'New password must be at least 8 characters.');
    audit(s.user.name, s.role, 'auth.password_change', 'Own account');
    return { ok: true };
  }),
  /** POST /student/onboarding */
  completeOnboarding: (data: Partial<Student> & { cgpa?: number; activeArrears?: number; arrearHistory?: number }) => call('POST', '/student/onboarding', (s) => {
    const st = requireStudent(s);
    st.studentCode = data.studentCode ?? st.studentCode;
    st.departmentId = data.departmentId ?? st.departmentId;
    st.degree = data.degree ?? st.degree;
    st.currentYear = data.currentYear ?? st.currentYear;
    st.graduationYear = data.graduationYear ?? st.graduationYear;
    st.skills = data.skills ?? st.skills;
    st.interests = data.interests ?? st.interests;
    st.preferredRoles = data.preferredRoles ?? st.preferredRoles;
    st.resumeFile = data.resumeFile ?? st.resumeFile;
    st.portfolioUrl = data.portfolioUrl || undefined;
    // Self-reported academics are stored UNVERIFIED until the placement cell verifies them.
    st.academic = { cgpa: data.cgpa, cgpaVerified: false, activeArrears: data.activeArrears ?? 0, arrearHistory: data.arrearHistory ?? 0 };
    st.profileCompletion = computeCompletion(st);
    s.user.onboardingComplete = true;
    audit(s.user.name, s.role, 'student.onboarding', `Student ${st.studentCode}`);
    return structuredClone(s.user);
  }),
};
