// Domain types. These mirror the SQLAlchemy models / REST payloads of the Flask backend.
// All IDs are stable string IDs, all timestamps are ISO-8601 strings.

export type Role = 'admin' | 'faculty' | 'student';
export type ISODate = string;

export type Permission =
  | 'students.view'
  | 'students.edit'
  | 'companies.manage'
  | 'jobs.create'
  | 'drives.publish'
  | 'applications.review'
  | 'offers.manage'
  | 'documents.upload'
  | 'reports.view'
  | 'users.manage'
  | 'roles.manage'
  | 'policies.manage'
  | 'audit.view';

export interface User {
  id: string;
  userCode: string; // college user id / roll number
  name: string;
  email: string;
  role: Role;
  departmentId?: string;
  status: 'active' | 'inactive' | 'invited';
  createdAt: ISODate;
  lastLoginAt?: ISODate;
  onboardingComplete?: boolean; // students only
}

export interface Department {
  id: string;
  code: string;
  name: string;
  headName: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  degree: 'B.E.' | 'B.Tech' | 'M.E.' | 'M.Tech' | 'MBA' | 'MCA';
  departmentId: string;
  durationYears: number;
}

export interface AcademicRecord {
  cgpa?: number;
  cgpaVerified: boolean; // set by faculty/admin only
  activeArrears: number;
  arrearHistory: number;
}

export interface Student {
  id: string;
  userId: string;
  studentCode: string;
  name: string;
  email: string;
  phone?: string;
  departmentId: string;
  degree: string;
  currentYear: number;
  graduationYear: number;
  academic: AcademicRecord;
  skills: string[];
  interests: string[];
  preferredRoles: string[];
  resumeFile?: string;
  portfolioUrl?: string;
  profileCompletion: number;
  placementStatus: 'unplaced' | 'in_process' | 'placed' | 'opted_out';
}

export interface Company {
  id: string;
  name: string;
  website: string;
  industry: string;
  description: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  tier: 'regular' | 'dream' | 'super_dream';
  color: string; // brand colour used for the placeholder logo tile
  createdAt: ISODate;
  archivedAt?: ISODate; // set when archived: hidden from default lists, history kept
}

export type JobStatus = 'draft' | 'published' | 'closed' | 'cancelled';
export type JobType = 'Full-time' | 'Internship' | 'Internship + PPO';

export interface JobEligibilityRule {
  minCgpa: number;
  maxActiveArrears: number;
  maxArrearHistory?: number;
  departmentIds: string[];
  graduationYears: number[];
  requiredSkills: string[]; // informational; skill match is not a hard rule
}

export interface HiringRound {
  id: string;
  name: string;
  mode: 'Online' | 'On-campus' | 'Virtual';
  date?: ISODate;
  location?: string;
}

export interface Job {
  id: string;
  companyId: string;
  title: string;
  domain: string;
  location: string;
  type: JobType;
  description: string;
  responsibilities: string[];
  skills: string[];
  eligibility: JobEligibilityRule;
  rounds: HiringRound[];
  ctcLpa?: number; // annual package in lakhs per annum
  stipendPerMonth?: number;
  openDate: ISODate;
  deadline: ISODate;
  driveDate?: ISODate;
  status: JobStatus;
  publishedAt?: ISODate;
  archivedAt?: ISODate;
  createdBy: string;
  updatedAt: ISODate;
}

export type EligibilityState = 'eligible' | 'not_eligible' | 'profile_incomplete' | 'needs_verification';

export interface EligibilityCheck {
  key: string;
  label: string;
  passed: boolean | null; // null = cannot be determined
  detail: string;
}

export interface EligibilityResult {
  state: EligibilityState;
  checks: EligibilityCheck[];
  summary: string;
  evaluatedAt: ISODate;
  exceptionGranted?: { reason: string; approvedBy: string };
}

export type ApplicationStatus =
  | 'applied'
  | 'shortlisted'
  | 'interview'
  | 'selected'
  | 'offer_received'
  | 'rejected'
  | 'withdrawn';

export interface ApplicationStatusEntry {
  status: ApplicationStatus;
  at: ISODate;
  note?: string;
  by: string;
}

export interface Application {
  id: string;
  studentId: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: ISODate;
  updatedAt: ISODate;
  history: ApplicationStatusEntry[];
  eligibilitySnapshot: EligibilityResult;
  currentRound?: string;
}

export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export interface Interview {
  id: string;
  jobId: string;
  applicationIds: string[];
  round: string;
  at: ISODate;
  durationMins: number;
  location: string; // room or meeting link
  status: InterviewStatus;
  notified: boolean;
}

export type OfferStatus = 'pending' | 'received' | 'accepted' | 'declined' | 'withdrawn';

export interface Offer {
  id: string;
  studentId: string;
  jobId: string;
  applicationId: string;
  companyId: string;
  ctcLpa: number;
  offeredAt: ISODate;
  acceptBy: ISODate;
  status: OfferStatus;
  policyChecks: { label: string; passed: boolean; detail: string }[];
}

export interface PlacementPolicy {
  id: string;
  name: string;
  description: string;
  kind: 'max_offers' | 'tier_restriction' | 'application_limit' | 'accepted_offer' | 'exception_approval';
  scope: 'college' | 'department' | 'academic_year';
  scopeValue?: string;
  params: Record<string, string | number | boolean>;
  enabled: boolean;
  updatedAt: ISODate;
  updatedBy: string;
}

export type DocumentType = 'resume' | 'certificate' | 'brochure' | 'circular' | 'eligibility';

export interface DocumentRecord {
  id: string;
  title: string;
  type: DocumentType;
  uploadedAt: ISODate;
  uploadedBy: string;
  ownerStudentId?: string;
  companyId?: string;
  jobId?: string;
  access: ('student' | 'faculty' | 'admin')[];
  sizeKb: number;
  processing: 'queued' | 'processing' | 'indexed' | 'failed';
  pages?: number;
  version: number;
  extractedExcerpts?: { page: number; text: string }[];
}

export interface Reminder {
  id: string;
  studentId: string;
  title: string;
  at: ISODate;
  jobId?: string;
  kind: 'drive' | 'deadline' | 'interview' | 'custom';
  done: boolean;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  kind: 'drive' | 'deadline' | 'interview' | 'offer' | 'system' | 'application';
  at: ISODate;
  read: boolean;
  link?: string;
}

export interface NotificationPrefs {
  email: boolean;
  push: boolean;
  driveReminders: boolean;
  deadlineReminders: boolean;
  interviewAlerts: boolean;
  offerUpdates: boolean;
}

export interface AuditLog {
  id: string;
  actor: string;
  actorRole: Role | 'system';
  action: string;
  resource: string;
  at: ISODate;
  result: 'success' | 'denied' | 'failed';
  reason?: string;
}

// ---- AI assistant ----
export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  status: 'ok' | 'denied' | 'error';
}

/** A change proposed by the assistant. It does nothing until its owner confirms; the server then re-validates it. */
export interface PendingAction {
  id: string;
  kind: 'apply' | 'create_reminder' | 'update_stage' | 'user_create' | 'user_update' | 'user_status' | 'student_import' | 'company_save' | 'company_archive' | 'policy_save' | 'policy_delete' | 'verify_cgpa';
  title: string;
  description: string;
  /** Target and relevant facts shown on the confirmation card. */
  details?: { label: string; value: string }[];
  payload?: Record<string, unknown>;
  /** Deactivating an account, archiving a company or deleting a policy: shown with a warning style. */
  destructive?: boolean;
  state: 'awaiting_confirmation' | 'confirmed' | 'cancelled' | 'failed' | 'expired';
  resultMessage?: string;
}

export type ChartType = 'pie' | 'donut' | 'bar' | 'hbar' | 'stacked' | 'line' | 'area';
/** A dataset computed by the server (the model never supplies numbers). `types` are the styles that suit this data. */
export interface ChatChart {
  title: string;
  subtitle?: string;
  type: ChartType;
  types: ChartType[];
  labels: string[];
  series: { name: string; values: number[] }[];
  unit?: string;
}

/** A formatted report built by the server for the chat: KPI tiles plus sections of table and/or chart. */
export interface ChatReport {
  title: string;
  subtitle?: string;
  generatedAt: ISODate;
  kpis: { label: string; value: string }[];
  sections: { heading: string; note?: string; table?: { columns: string[]; rows: (string | number | null)[][] }; chart?: ChatChart }[];
  truncated?: boolean;
}

export interface ChatSource { documentId: string; title: string; page: number; snippet?: string }

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: ISODate;
  jobIds?: string[];
  sources?: ChatSource[];
  charts?: ChatChart[];
  reports?: ChatReport[];
  tools?: ToolCallTrace[];
  action?: PendingAction;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: ISODate;
  messages: ChatMessage[];
}

// ---- API envelopes ----
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class ApiError extends Error {
  status: number;
  /** Machine-readable error code from the API envelope (e.g. 'forbidden', 'validation_error'). */
  code?: string;
  /** Per-field validation messages (422). */
  details?: Record<string, string[]>;
  constructor(status: number, message: string, code?: string, details?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
