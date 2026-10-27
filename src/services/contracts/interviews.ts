import type { ApplicationStatus, Company, Interview, Job } from '@/types';

export interface InterviewInput { jobId: string; applicationIds: string[]; round: string; at: string; durationMins: number; location: string }
export interface InterviewView { interview: Interview; job: Job; company: Company; candidates: { applicationId: string; name: string; studentCode: string; status: ApplicationStatus }[] }

/** Permission: applications.review. */
export interface InterviewService {
  list(): Promise<InterviewView[]>;
  save(input: InterviewInput & { id?: string }): Promise<InterviewView>;
  setStatus(id: string, status: Interview['status']): Promise<InterviewView>;
  /** In-app notifications only; e-mail delivery is not implemented. */
  notify(id: string): Promise<{ notified: number }>;
}
