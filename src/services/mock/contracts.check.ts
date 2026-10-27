// Compile-time proof that the mock implementation satisfies the same contracts as the real HTTP services.
import type * as M from './index';
import type {
  AdminConfigService, AssistantService, AdminDashboardService, ApplicationService, AuthService, CompanyService, FacultyDashboardService, InterviewService, JobService,
  NotificationService, OfferService, PlacementReportService, ReferenceService, ReminderService, StudentDirectoryService, StudentSelfService, UserService,
} from '../contracts';

type Satisfies<Impl extends Contract, Contract> = Impl;
export type MockContractChecks = [
  Satisfies<typeof M.authApi, AuthService>,
  Satisfies<typeof M.studentApi, StudentSelfService>,
  Satisfies<typeof M.companiesApi, CompanyService>,
  Satisfies<typeof M.jobsApi, JobService>,
  Satisfies<typeof M.applicationsApi, ApplicationService>,
  Satisfies<typeof M.offersApi, OfferService>,
  Satisfies<typeof M.notificationsApi, NotificationService>,
  Satisfies<typeof M.remindersApi, ReminderService>,
  Satisfies<typeof M.reportsApi, ReferenceService & FacultyDashboardService & PlacementReportService>,
  Satisfies<typeof M.adminApi, AdminDashboardService & AdminConfigService>,
  Satisfies<typeof M.interviewsApi, InterviewService>,
  Satisfies<typeof M.usersApi, UserService>,
  Satisfies<typeof M.studentsApi, StudentDirectoryService>,
  Satisfies<typeof M.assistantApi, AssistantService>,
];
