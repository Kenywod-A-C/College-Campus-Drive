// View models returned by the REST API (joined/denormalised for the UI).
import type {
  Application, ApplicationStatus, Company, EligibilityResult, Interview, Job, JobStatus, Offer, OfferStatus, Student, AppNotification, Page,
} from './index';

export interface JobView {
  job: Job;
  company: Company;
  eligibility?: EligibilityResult; // present for student callers
  saved?: boolean;
  applicationId?: string;
  applicationStatus?: ApplicationStatus;
  applicantCount?: number;
  relevance?: number;
  eligibleDepartments: string[]; // department codes, resolved server-side
}

export interface JobQuery {
  q?: string;
  dept?: string;
  minCgpa?: number;
  location?: string;
  type?: string;
  deadlineDays?: number;
  tab?: 'all' | 'eligible' | 'not_eligible' | 'saved' | 'applied';
  sort?: 'deadline' | 'relevance' | 'recent';
  status?: JobStatus | 'all';
  companyId?: string;
  /** Staff only. Archived jobs are hidden unless requested. */
  archived?: 'exclude' | 'include' | 'only';
  page?: number;
  pageSize?: number;
}

export interface ApplicationView {
  application: Application;
  job: Job;
  company: Company;
  student?: Student; // faculty/admin callers only
  nextAction?: string;
}

export interface ApplicationDetail extends ApplicationView {
  interviews: Interview[];
  notifications: AppNotification[];
  offer?: Offer;
}

export interface ApplicationQuery {
  q?: string;
  status?: ApplicationStatus | 'all';
  companyId?: string;
  jobId?: string;
  dept?: string;
  eligibility?: string;
  sort?: 'recent' | 'cgpa' | 'name';
  page?: number;
  pageSize?: number;
}

export interface OfferView {
  offer: Offer;
  job: Job;
  company: Company;
  student?: Student;
}

export interface StudentQuery {
  q?: string;
  dept?: string;
  year?: number;
  minCgpa?: number;
  skill?: string;
  placement?: string;
  page?: number;
  pageSize?: number;
}

export interface StudentRow extends Student {
  applicationCount: number;
  offerCount: number;
}

export interface StudentDetail {
  student: StudentRow;
  applications: ApplicationView[];
  offers: OfferView[];
}

export interface ReportFilters {
  academicYear?: string; // graduation year
  dept?: string;
  companyId?: string;
  jobId?: string;
  appStatus?: ApplicationStatus | 'all';
  offerStatus?: OfferStatus | 'all';
}

export interface ReportData {
  kpis: { eligibleStudents: number; appliedStudents: number; uniqueStudentsPlaced: number; totalOffers: number; acceptedOffers: number; placementPct: number; totalStudents: number };
  offersByDept: { dept: string; offers: number; accepted: number; placedStudents: number; students: number }[];
  companyOffers: { company: string; offers: number; accepted: number }[];
  eligibleVsApplied: { dept: string; eligible: number; applied: number }[];
  funnel: { stage: string; count: number }[];
  monthly: { month: string; applications: number; offers: number }[];
  statusDist: { status: string; count: number }[];
}

export type { Page };
