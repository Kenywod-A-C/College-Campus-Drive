// Public API surface used by every page via '@/api'.
// USE_MOCK (VITE_USE_MOCK=true) → in-browser mock backend, loaded lazily. Otherwise → real HTTP services.
import { lazyMock } from './lazyMock';
import * as real from './real';
import type { Surface } from './surface';

const loadMock = () => import('./mock');
// The mock satisfies the contract types (compile-time proof: mock/contracts.check.ts), hence the cast.
// `__USE_MOCK__` is a compile-time literal: in a real build this branch (and the whole mock backend) is removed from the bundle.
const pick = <K extends keyof Surface>(name: K, impl: Surface[K]): Surface[K] =>
  __USE_MOCK__ ? lazyMock(() => loadMock().then((m) => m[name as keyof typeof m] as unknown as Surface[K] & object)) : impl;

export const authApi = pick('authApi', real.authApi);
export const studentApi = pick('studentApi', real.studentApi);
export const jobsApi = pick('jobsApi', real.jobsApi);
export const applicationsApi = pick('applicationsApi', real.applicationsApi);
export const offersApi = pick('offersApi', real.offersApi);
export const interviewsApi = pick('interviewsApi', real.interviewsApi);
export const companiesApi = pick('companiesApi', real.companiesApi);
export const studentsApi = pick('studentsApi', real.studentsApi);
export const usersApi = pick('usersApi', real.usersApi);
export const documentsApi = pick('documentsApi', real.documentsApi);
export const remindersApi = pick('remindersApi', real.remindersApi);
export const notificationsApi = pick('notificationsApi', real.notificationsApi);
export const reportsApi = pick('reportsApi', real.reportsApi);
export const adminApi = pick('adminApi', real.adminApi);
export const assistantApi = pick('assistantApi', real.assistantApi);

// Demo-only constants (tiny module, no mock database). Referenced only when USE_MOCK is true.
export { DEMO_ACCOUNTS, DEMO_PASSWORD } from './mock/demo';
export { USE_MOCK, API_BASE_URL } from './config';

// Types shared by pages
export * from './contracts';
export type { UploadInput } from './mock/content';
