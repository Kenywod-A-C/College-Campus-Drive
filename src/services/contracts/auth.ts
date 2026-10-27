import type { Permission, Student, User } from '@/types';

export interface AuthPayload { user: User; permissions: Permission[] }
export interface LoginRequest { identifier: string; password: string; remember: boolean }
/** POST /auth/login and POST /auth/refresh. `accessToken` is kept in memory by the HTTP client, never persisted. */
export interface LoginResponse extends AuthPayload { accessToken: string; expiresIn: number }
export interface ChangePasswordRequest { currentPassword: string; newPassword: string }
export interface ResetPasswordRequest { token: string; password: string }
export type OnboardingData = Partial<Student> & { cgpa?: number; activeArrears?: number; arrearHistory?: number };

export interface AuthService {
  login(identifier: string, password: string, remember: boolean): Promise<AuthPayload>;
  me(): Promise<AuthPayload | null>;
  logout(): Promise<void>;
  forgotPassword(email: string): Promise<{ message: string }>;
  resetPassword(token: string, password: string): Promise<void>;
  changePassword(current: string, next: string): Promise<{ ok: boolean }>;
  completeOnboarding(data: OnboardingData): Promise<User>;
}
