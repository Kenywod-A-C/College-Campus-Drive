import type { Company, Job, Page } from '@/types';

export interface CompanyInput { id?: string; name: string; website: string; industry: string; description: string; contactName: string; contactEmail: string; contactPhone?: string; tier: Company['tier']; color?: string }
export interface CompanyQuery { q?: string; industry?: string; tier?: string; archived?: 'exclude' | 'include' | 'only'; page?: number; pageSize?: number }
export interface CompanyRow { company: Company; jobCount: number; activeJobs: number; offers: number }
export interface CompanyDetailDto { company: Company; jobs: { job: Job; applicants: number; selected: number; offers: number }[]; interviews: number }

export interface CompanyService {
  list(q?: CompanyQuery): Promise<Page<CompanyRow> & { industries: string[] }>;
  get(id: string): Promise<CompanyDetailDto>;
  save(input: CompanyInput): Promise<Company>;
  /** Permission: companies.manage. A company with published jobs cannot be archived. */
  archive(id: string, archived: boolean): Promise<Company>;
}
