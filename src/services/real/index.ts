// Real HTTP implementation of the public API surface (see docs/API_CONVENTIONS.md).
// The surface is typed from the mock API (type-only import: erased at build time), so every page-visible method exists.
// Methods the backend does not provide yet reject with 501 'not_implemented'.
import type { Surface } from '../surface';
import { withStubs } from './notImplemented';
import { authService } from './auth';
import { studentDirectoryService, studentService } from './students';
import { jobService } from './jobs';
import { applicationService } from './applications';
import { offerService } from './offers';
import { interviewService } from './interviews';
import { userService } from './users';
import { adminConfigService } from './admin';
import { notificationService, reminderService } from './notifications';
import { companyService } from './companies';
import { assistantService } from './assistant';
import { adminDashboardService, facultyDashboardService, placementReportService, referenceService } from './dashboards';

export const authApi = withStubs<Surface['authApi'], typeof authService>(authService, {});
export const studentApi = withStubs<Surface['studentApi'], typeof studentService>(studentService, {});
export const jobsApi = withStubs<Surface['jobsApi'], typeof jobService>(jobService, {});
export const applicationsApi = withStubs<Surface['applicationsApi'], typeof applicationService>(applicationService, {});
export const offersApi = withStubs<Surface['offersApi'], typeof offerService>(offerService, {});
export const notificationsApi = withStubs<Surface['notificationsApi'], typeof notificationService>(notificationService, {});
export const remindersApi = withStubs<Surface['remindersApi'], typeof reminderService>(reminderService, {});
export const companiesApi = withStubs<Surface['companiesApi'], typeof companyService>(companyService, {});
export const reportsApi = withStubs<Surface['reportsApi'], typeof facultyDashboardService & typeof referenceService & typeof placementReportService>({ ...facultyDashboardService, ...referenceService, ...placementReportService }, {});
// Still mock-only on the server: system settings (no table yet) and documents. They keep answering 501.
export const adminApi = withStubs<Surface['adminApi'], typeof adminDashboardService & typeof adminConfigService>({ ...adminDashboardService, ...adminConfigService }, { settings: true, saveSettings: true });
export const interviewsApi = withStubs<Surface['interviewsApi'], typeof interviewService>(interviewService, {});
export const studentsApi = withStubs<Surface['studentsApi'], typeof studentDirectoryService>(studentDirectoryService, {});
export const usersApi = withStubs<Surface['usersApi'], typeof userService>(userService, {});
export const documentsApi = withStubs<Surface['documentsApi'], {}>({}, { list: true, get: true, upload: true, replace: true, reprocess: true, remove: true });
export const assistantApi = withStubs<Surface['assistantApi'], typeof assistantService>(assistantService, {});
