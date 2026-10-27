// Small builders for page tests.
import type { Company, Job } from '@/types';
import type { JobView } from '@/types/views';

export const company = (over: Partial<Company> = {}): Company => ({
  id: '3', name: 'Zoho', website: 'https://zoho.example.com', industry: 'SaaS', description: '', contactName: 'Anjali', contactEmail: 'hr@zoho.example.com', tier: 'dream', color: '#b91c1c',
  createdAt: new Date().toISOString(), ...over,
});

export const job = (over: Partial<Job> = {}): Job => ({
  id: '11', companyId: '3', title: 'Software Developer', domain: 'Software', location: 'Chennai', type: 'Full-time', description: 'desc', responsibilities: ['Code'], skills: ['Go'],
  eligibility: { minCgpa: 7, maxActiveArrears: 0, departmentIds: ['1'], graduationYears: [2027], requiredSkills: [] }, rounds: [], ctcLpa: 8,
  openDate: '2030-01-01T00:00:00Z', deadline: '2030-02-01T00:00:00Z', status: 'published', createdBy: '1', updatedAt: '2030-01-01T00:00:00Z', ...over,
});

export const jobView = (over: Partial<Job> = {}, extra: Partial<JobView> = {}): JobView => ({ job: job(over), company: company(), eligibleDepartments: ['CSE'], applicantCount: 0, ...extra });

export const pageOf = <T,>(items: T[], total = items.length, pageSize = 10) => ({ items, total, page: 1, pageSize });
