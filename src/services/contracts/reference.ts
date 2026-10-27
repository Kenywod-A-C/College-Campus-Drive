import type { ApplicationStatus, AuditLog, Company, Interview, Job } from '@/types';
import type { ApplicationView, ReportData, ReportFilters } from '@/types/views';

export interface ReferenceFilters {
  graduationYears: { value: string; label: string }[];
  departments: { value: string; label: string; name: string }[];
  companies: { value: string; label: string }[];
  jobs: { value: string; label: string; companyId: string }[];
}
export interface DashboardFilters { dept?: string; graduationYear?: number; companyId?: string; days?: number }

interface DriveRow { job: Job; company: Company; eligibleDepartments: string[]; applicantCount: number }
export interface FacultyDashboard {
  metrics: { totalCompanies: number; activeJobs: number; totalApplications: number; eligibleStudents: number; shortlisted: number; selected: number; offers: number };
  deptChart: { dept: string; placed: number; notPlaced: number; students: number }[];
  statusDist: { status: string; count: number }[];
  upcomingDrives: DriveRow[];
  nearingDeadline: DriveRow[];
  upcomingInterviews: { interview: Interview; job: Job; company: Company }[];
  recentApplications: ApplicationView[];
  activity: { at: string; status: ApplicationStatus; student: string; job: string; company: string }[];
  graduationYears: number[];
}
export interface AdminDashboard {
  metrics: { totalUsers: number; activeStudents: number; facultyAccounts: number; companies: number; activeJobs: number; applications: number; offers: number };
  placement: { totalStudents: number; placed: number; pct: number; accepted: number; offers: number };
  activity: AuditLog[];
  alerts: { level: 'error' | 'warning' | 'info'; text: string; link: string }[];
}

export interface ReferenceService { filterOptions(): Promise<ReferenceFilters> }
export interface FacultyDashboardService { facultyDashboard(f?: DashboardFilters): Promise<FacultyDashboard> }
export interface AdminDashboardService { dashboard(): Promise<AdminDashboard> }
/** Permission: reports.view. Aggregates only; the CSV lists offers and is audited. */
export interface PlacementReportService {
  placement(f?: ReportFilters): Promise<ReportData>;
  exportPlacementCsv(f?: ReportFilters): Promise<string>;
}
