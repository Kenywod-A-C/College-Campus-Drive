import type { ApplicationStatus, Page } from '@/types';
import type { ApplicationDetail, ApplicationQuery, ApplicationView } from '@/types/views';

export interface StageException { reason: string; approvedBy: string }
/** Bulk stage changes are per row: valid rows are applied, the rest come back with a reason. */
export interface StageResult { updated: string[]; failed: { id: string; reason: string }[] }

export interface ApplicationService {
  /** Eligibility and the deadline are re-validated on the server at submission time. */
  apply(jobId: string): Promise<ApplicationView>;
  listMine(q?: ApplicationQuery): Promise<Page<ApplicationView>>;
  get(id: string): Promise<ApplicationDetail>;
  withdraw(id: string): Promise<ApplicationView>;
  /** Permission: applications.review. Server-side pagination and filtering. */
  listAll(q?: ApplicationQuery): Promise<Page<ApplicationView>>;
  /** Permission: applications.review. Forward-only stage changes; advancing a non-eligible applicant needs a recorded exception. */
  updateStage(ids: string[], status: ApplicationStatus, note?: string, exception?: StageException): Promise<StageResult>;
  /** Permissions: reports.view + applications.review. Returns CSV text; the export is audited. */
  exportCsv(q?: ApplicationQuery): Promise<string>;
}
