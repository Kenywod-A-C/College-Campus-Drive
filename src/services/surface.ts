// The public API surface seen by pages: the typed contract for every endpoint the backend provides,
// merged with the remaining (mock-only for now) methods. Type-only; erased at build time.
import type {
  AdminConfigService, AssistantService, AdminDashboardService, ApplicationService, AuthService, CompanyService, FacultyDashboardService, InterviewService, JobService,
  NotificationService, OfferService, PlacementReportService, ReferenceService, ReminderService, StudentDirectoryService, StudentSelfService, UserService,
} from './contracts';

type Mock = typeof import('./mock');
type Merge<Contract, MockPart> = Omit<MockPart, keyof Contract> & Contract;

export interface Surface {
  authApi: Merge<AuthService, Mock['authApi']>;
  studentApi: Merge<StudentSelfService, Mock['studentApi']>;
  jobsApi: Merge<JobService, Mock['jobsApi']>;
  applicationsApi: Merge<ApplicationService, Mock['applicationsApi']>;
  offersApi: Merge<OfferService, Mock['offersApi']>;
  companiesApi: Merge<CompanyService, Mock['companiesApi']>;
  notificationsApi: Merge<NotificationService, Mock['notificationsApi']>;
  remindersApi: Merge<ReminderService, Mock['remindersApi']>;
  reportsApi: Merge<ReferenceService & FacultyDashboardService & PlacementReportService, Mock['reportsApi']>;
  adminApi: Merge<AdminDashboardService & AdminConfigService, Mock['adminApi']>;
  studentsApi: Merge<StudentDirectoryService, Mock['studentsApi']>;
  interviewsApi: Merge<InterviewService, Mock['interviewsApi']>;
  usersApi: Merge<UserService, Mock['usersApi']>;
  assistantApi: Merge<AssistantService, Mock['assistantApi']>;
  // Not provided by the backend yet: mock-only (501 in real mode)
  documentsApi: Mock['documentsApi'];
}
