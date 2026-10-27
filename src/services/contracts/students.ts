import type { ApplicationStatus, Page, Student } from '@/types';
import type { JobView, StudentDetail, StudentQuery, StudentRow } from '@/types/views';

export type ProfilePatch = Partial<Pick<Student, 'phone' | 'skills' | 'interests' | 'preferredRoles' | 'portfolioUrl' | 'resumeFile' | 'degree' | 'currentYear'>> & { cgpa?: number; activeArrears?: number; arrearHistory?: number };

export interface StudentDashboard {
  student: Student;
  metrics: { eligibleJobs: number; activeApplications: number; offers: number; upcoming: number };
  events: { id: string; title: string; sub: string; at: string; kind: 'interview' | 'drive' }[];
  deadlines: JobView[];
  recommended: JobView[];
  activity: { at: string; status: ApplicationStatus; text: string; note?: string; applicationId: string }[];
}

/** Student self-service. The server only ever returns the caller's own record. */
export interface StudentSelfService {
  getProfile(): Promise<Student>;
  updateProfile(patch: ProfilePatch): Promise<Student>;
  dashboard(): Promise<StudentDashboard>;
}

/**
 * Staff-facing student directory (permissions: students.view to read, students.edit to verify).
 * The server masks contact data and writes detail views to the audit log.
 */
export interface StudentDirectoryService {
  list(q?: StudentQuery): Promise<Page<StudentRow>>;
  get(id: string): Promise<StudentDetail>;
  /** Confirms the student's CGPA; pass a value to correct it. */
  verifyCgpa(id: string, cgpa?: number): Promise<StudentRow>;
}
