import type { DocumentRecord, Interview, Job, JobStatus, Page } from '@/types';
import type { JobQuery, JobView } from '@/types/views';

/** Create/edit payload. `status` may only be 'draft' or 'published'; every other status change goes through setStatus(). */
export interface JobInput {
  id?: string;
  companyId: string; title: string; domain: string; location: string; type: Job['type']; description: string; responsibilities: string[]; skills: string[];
  eligibility: Job['eligibility']; rounds: Job['rounds']; ctcLpa?: number; stipendPerMonth?: number; openDate: string; deadline: string; driveDate?: string; status: 'draft' | 'published';
}

export interface JobDriveDetail {
  view: JobView;
  eligibleStudents: number;
  counts: { applied: number; shortlisted: number; interview: number; selected: number; offers: number; rejected: number };
  interviews: Interview[];
  documents: DocumentRecord[];
}

export interface JobService {
  list(q?: JobQuery): Promise<Page<JobView>>;
  get(id: string): Promise<JobView>;
  toggleSave(id: string): Promise<{ saved: boolean }>;
  /** Permissions: jobs.create (publishing in the same request also needs drives.publish). */
  save(input: JobInput): Promise<Job>;
  /** publish / unpublish ('draft') / close / reopen ('published') / cancel (reason required). Permission: drives.publish. */
  setStatus(id: string, status: JobStatus, reason?: string): Promise<Job>;
  /** Soft archive (draft/closed/cancelled jobs only). Permission: drives.publish. */
  archive(id: string, archived: boolean): Promise<Job>;
  drive(id: string): Promise<JobDriveDetail>;
}
