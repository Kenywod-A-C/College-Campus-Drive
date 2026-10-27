import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageSkeleton } from '@/components/feedback';
import { StudentLayout } from '@/layouts/StudentLayout';
import { FacultyLayout } from '@/layouts/FacultyLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { ForbiddenPage } from '@/pages/auth/Forbidden';
import { HomeRedirect, PublicOnly, RequirePerm, RequireRole } from './guards';

// Pages are code-split by route group.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = <T extends object>(f: () => Promise<T>, name: keyof T) => lazy(async () => ({ default: (await f())[name] as ComponentType<any> }));

const LoginPage = L(() => import('@/pages/auth/Login'), 'LoginPage');
const ForgotPasswordPage = L(() => import('@/pages/auth/ForgotPassword'), 'ForgotPasswordPage');
const ResetPasswordPage = L(() => import('@/pages/auth/ResetPassword'), 'ResetPasswordPage');
const OnboardingPage = L(() => import('@/pages/auth/Onboarding'), 'OnboardingPage');
const NotFoundPage = L(() => import('@/pages/auth/NotFound'), 'NotFoundPage');

const StudentDashboard = L(() => import('@/pages/student/Dashboard'), 'StudentDashboard');
const StudentProfile = L(() => import('@/pages/student/Profile'), 'StudentProfile');
const StudentJobs = L(() => import('@/pages/student/Jobs'), 'StudentJobs');
const StudentJobDetail = L(() => import('@/pages/student/JobDetail'), 'StudentJobDetail');
const StudentApplications = L(() => import('@/pages/student/Applications'), 'StudentApplications');
const StudentApplicationDetail = L(() => import('@/pages/student/ApplicationDetail'), 'StudentApplicationDetail');
const StudentOffers = L(() => import('@/pages/student/Offers'), 'StudentOffers');
const StudentReminders = L(() => import('@/pages/student/Reminders'), 'StudentReminders');

const FacultyDashboard = L(() => import('@/pages/faculty/Dashboard'), 'FacultyDashboard');
const FacultyCompanies = L(() => import('@/pages/faculty/Companies'), 'FacultyCompanies');
const FacultyCompanyDetail = L(() => import('@/pages/faculty/CompanyDetail'), 'FacultyCompanyDetail');
const FacultyJobs = L(() => import('@/pages/faculty/Jobs'), 'FacultyJobs');
const FacultyJobForm = L(() => import('@/pages/faculty/JobForm'), 'FacultyJobForm');
const FacultyJobDetail = L(() => import('@/pages/faculty/JobDetail'), 'FacultyJobDetail');
const FacultyDrives = L(() => import('@/pages/faculty/Drives'), 'FacultyDrives');
const FacultyStudents = L(() => import('@/pages/faculty/Students'), 'FacultyStudents');
const FacultyStudentDetail = L(() => import('@/pages/faculty/StudentDetail'), 'FacultyStudentDetail');
const FacultyApplications = L(() => import('@/pages/faculty/Applications'), 'FacultyApplications');
const FacultyInterviews = L(() => import('@/pages/faculty/Interviews'), 'FacultyInterviews');
const FacultyOffers = L(() => import('@/pages/faculty/Offers'), 'FacultyOffers');
const PlacementReports = L(() => import('@/pages/faculty/Reports'), 'PlacementReports');

const AdminDashboard = L(() => import('@/pages/admin/Dashboard'), 'AdminDashboard');
const AdminUsers = L(() => import('@/pages/admin/Users'), 'AdminUsers');
const AdminRoles = L(() => import('@/pages/admin/Roles'), 'AdminRoles');
const AdminStudentsFaculty = L(() => import('@/pages/admin/StudentsFaculty'), 'AdminStudentsFaculty');
const AdminCompaniesJobs = L(() => import('@/pages/admin/CompaniesJobs'), 'AdminCompaniesJobs');
const AdminPolicies = L(() => import('@/pages/admin/Policies'), 'AdminPolicies');
const AdminDepartments = L(() => import('@/pages/admin/Departments'), 'AdminDepartments');
const AdminAuditLogs = L(() => import('@/pages/admin/AuditLogs'), 'AdminAuditLogs');
const AdminSettings = L(() => import('@/pages/admin/SystemSettings'), 'AdminSettings');

const AssistantPage = L(() => import('@/pages/shared/Assistant'), 'AssistantPage');
const DocumentsPage = L(() => import('@/pages/shared/Documents'), 'DocumentsPage');
const SettingsPage = L(() => import('@/pages/shared/Settings'), 'SettingsPage');
const NotificationsPage = L(() => import('@/pages/shared/Notifications'), 'NotificationsPage');

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;

export function AppRoutes() {
  return (
    <S>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
        <Route path="/forbidden" element={<ForbiddenPage />} />

        {/* ---------------- Student ---------------- */}
        <Route path="/student" element={<RequireRole role="student" />}>
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route element={<StudentLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<StudentDashboard />} />
            <Route path="profile" element={<StudentProfile />} />
            <Route path="jobs" element={<StudentJobs />} />
            <Route path="jobs/:jobId" element={<StudentJobDetail />} />
            <Route path="applications" element={<StudentApplications />} />
            <Route path="applications/:applicationId" element={<StudentApplicationDetail />} />
            <Route path="offers" element={<StudentOffers />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="reminders" element={<StudentReminders />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        {/* ---------------- Faculty / Placement officer ---------------- */}
        <Route path="/faculty" element={<RequireRole role="faculty" />}>
          <Route element={<FacultyLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<FacultyDashboard />} />
            <Route path="companies" element={<RequirePerm perm="companies.manage"><FacultyCompanies /></RequirePerm>} />
            <Route path="companies/:companyId" element={<RequirePerm perm="companies.manage"><FacultyCompanyDetail /></RequirePerm>} />
            <Route path="jobs" element={<RequirePerm perm="jobs.create"><FacultyJobs /></RequirePerm>} />
            <Route path="jobs/new" element={<RequirePerm perm="jobs.create"><FacultyJobForm /></RequirePerm>} />
            <Route path="jobs/:jobId" element={<RequirePerm perm="jobs.create"><FacultyJobDetail /></RequirePerm>} />
            <Route path="jobs/:jobId/edit" element={<RequirePerm perm="jobs.create"><FacultyJobForm /></RequirePerm>} />
            <Route path="drives" element={<RequirePerm perm="jobs.create"><FacultyDrives /></RequirePerm>} />
            <Route path="students" element={<RequirePerm perm="students.view"><FacultyStudents /></RequirePerm>} />
            <Route path="students/:studentId" element={<RequirePerm perm="students.view"><FacultyStudentDetail /></RequirePerm>} />
            <Route path="applications" element={<RequirePerm perm="applications.review"><FacultyApplications /></RequirePerm>} />
            <Route path="interviews" element={<RequirePerm perm="applications.review"><FacultyInterviews /></RequirePerm>} />
            <Route path="offers" element={<RequirePerm perm="offers.manage"><FacultyOffers /></RequirePerm>} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="reports" element={<RequirePerm perm="reports.view"><PlacementReports /></RequirePerm>} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        {/* ---------------- Admin ---------------- */}
        <Route path="/admin" element={<RequireRole role="admin" />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="users" element={<RequirePerm perm="users.manage"><AdminUsers /></RequirePerm>} />
            <Route path="roles" element={<RequirePerm perm="roles.manage"><AdminRoles /></RequirePerm>} />
            <Route path="students" element={<RequirePerm perm="students.view"><AdminStudentsFaculty /></RequirePerm>} />
            <Route path="faculty" element={<RequirePerm perm="students.view"><AdminStudentsFaculty initialTab="faculty" /></RequirePerm>} />
            <Route path="students/:studentId" element={<RequirePerm perm="students.view"><FacultyStudentDetail /></RequirePerm>} />
            <Route path="companies" element={<AdminCompaniesJobs />} />
            <Route path="companies/:companyId" element={<FacultyCompanyDetail />} />
            <Route path="jobs" element={<AdminCompaniesJobs initialTab="jobs" />} />
            <Route path="jobs/new" element={<FacultyJobForm />} />
            <Route path="jobs/:jobId" element={<FacultyJobDetail />} />
            <Route path="jobs/:jobId/edit" element={<FacultyJobForm />} />
            <Route path="policies" element={<RequirePerm perm="policies.manage"><AdminPolicies /></RequirePerm>} />
            <Route path="departments" element={<AdminDepartments />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="reports" element={<RequirePerm perm="reports.view"><PlacementReports /></RequirePerm>} />
            <Route path="audit-logs" element={<RequirePerm perm="audit.view"><AdminAuditLogs /></RequirePerm>} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </S>
  );
}
