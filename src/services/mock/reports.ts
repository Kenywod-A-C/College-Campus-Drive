import type { Application, ApplicationStatus } from '@/types';
import type { ReportData, ReportFilters } from '@/types/views';
import { academicYears, applications, auditLogs, companies, departments, deptName, evalFor, interviews, jobs, offers, students } from '@/mock/db';
import { call, requirePerm, requireAny } from './client';
import { appView } from './jobs';
import type { DashboardFilters } from '../contracts/reference';

const STAGES: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected', 'offer_received'];
const sOf = (id: string) => students.find((s) => s.id === id)!;
const jOf = (id: string) => jobs.find((j) => j.id === id)!;
const label = (st: string) => st.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
const monthKey = (iso: string) => new Date(iso).toLocaleString('en-IN', { month: 'short', year: '2-digit' });


function scope(f: ReportFilters & DashboardFilters) {
  const gy = f.graduationYear ?? (f.academicYear ? Number(f.academicYear) : undefined);
  const sts = students.filter((s) => (!f.dept || s.departmentId === f.dept) && (!gy || s.graduationYear === gy));
  const ids = new Set(sts.map((s) => s.id));
  const since = f.days ? Date.now() - f.days * 86400000 : 0;
  const apps = applications.filter((a) => ids.has(a.studentId) && (!f.companyId || jOf(a.jobId).companyId === f.companyId) && (!f.jobId || a.jobId === f.jobId) && (!f.appStatus || f.appStatus === 'all' || a.status === f.appStatus) && +new Date(a.appliedAt) >= since);
  const offs = offers.filter((o) => ids.has(o.studentId) && (!f.companyId || o.companyId === f.companyId) && (!f.jobId || o.jobId === f.jobId) && (!f.offerStatus || f.offerStatus === 'all' || o.status === f.offerStatus));
  return { sts, apps, offs };
}
const eligibleFor = (sts: typeof students) => sts.filter((s) => jobs.some((j) => j.status === 'published' && evalFor(s, j).state === 'eligible'));

export const reportsApi = {
  /** GET /faculty/dashboard */
  facultyDashboard: (f: DashboardFilters = {}) => call('GET', '/faculty/dashboard', (s) => {
    requireAny(s, 'reports.view', 'applications.review', 'students.view');
    const { sts, apps, offs } = scope(f);
    const now = Date.now();
    const inScopeJobs = jobs.filter((j) => !f.companyId || j.companyId === f.companyId);
    const jv = (j: typeof jobs[number]) => ({ job: j, company: companies.find((c) => c.id === j.companyId)!, eligibleDepartments: j.eligibility.departmentIds.map(deptName), applicantCount: applications.filter((a) => a.jobId === j.id).length });
    return {
      metrics: {
        totalCompanies: f.companyId ? 1 : companies.length,
        activeJobs: inScopeJobs.filter((j) => j.status === 'published').length,
        totalApplications: apps.length,
        eligibleStudents: eligibleFor(sts).length,
        shortlisted: apps.filter((a) => a.status === 'shortlisted').length,
        selected: apps.filter((a) => a.status === 'selected' || a.status === 'offer_received').length,
        offers: offs.length,
      },
      deptChart: departments.filter((d) => !f.dept || d.id === f.dept).map((d) => {
        const ds = sts.filter((x) => x.departmentId === d.id);
        const placed = new Set(offs.filter((o) => o.status === 'accepted' && sOf(o.studentId).departmentId === d.id).map((o) => o.studentId)).size;
        return { dept: d.code, placed, notPlaced: Math.max(ds.length - placed, 0), students: ds.length };
      }),
      statusDist: [...STAGES, 'rejected' as const, 'withdrawn' as const].map((st) => ({ status: label(st), count: apps.filter((a) => a.status === st).length })),
      upcomingDrives: inScopeJobs.filter((j) => j.status === 'published' && j.driveDate && +new Date(j.driveDate) > now).sort((a, b) => +new Date(a.driveDate!) - +new Date(b.driveDate!)).slice(0, 5).map(jv),
      nearingDeadline: inScopeJobs.filter((j) => j.status === 'published' && +new Date(j.deadline) > now && +new Date(j.deadline) - now < 6 * 86400000).sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline)).map(jv),
      upcomingInterviews: interviews.filter((i) => i.status === 'scheduled' && +new Date(i.at) > now).sort((a, b) => +new Date(a.at) - +new Date(b.at)).slice(0, 5).map((i) => ({ interview: i, job: jOf(i.jobId), company: companies.find((c) => c.id === jOf(i.jobId).companyId)! })),
      recentApplications: [...apps].sort((a, b) => +new Date(b.appliedAt) - +new Date(a.appliedAt)).slice(0, 6).map((a) => appView(a, s)),
      activity: apps.flatMap((a) => a.history.map((h) => ({ at: h.at, status: h.status, student: sOf(a.studentId).name, job: jOf(a.jobId).title, company: companies.find((c) => c.id === jOf(a.jobId).companyId)!.name }))).filter((x) => x.status !== 'applied').sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 6),
      graduationYears: [...new Set(students.map((x) => x.graduationYear))].sort(),
    };
  }),

  /** GET /reports/placement */
  placement: (f: ReportFilters = {}) => call('GET', '/reports/placement', (s): ReportData => {
    requirePerm(s, 'reports.view', 'placement report');
    const { sts, apps, offs } = scope(f);
    const placedIds = new Set(offs.filter((o) => o.status === 'accepted').map((o) => o.studentId));
    const reached = (stage: ApplicationStatus) => apps.filter((a) => a.history.some((h) => h.status === stage)).length;
    const months: Record<string, { month: string; applications: number; offers: number; t: number }> = {};
    const bump = (iso: string, k: 'applications' | 'offers') => { const m = monthKey(iso); months[m] ??= { month: m, applications: 0, offers: 0, t: +new Date(iso) }; months[m][k]++; months[m].t = Math.min(months[m].t, +new Date(iso)); };
    apps.forEach((a) => bump(a.appliedAt, 'applications'));
    offs.forEach((o) => bump(o.offeredAt, 'offers'));
    const eligible = eligibleFor(sts);
    const appliedIds = new Set(apps.map((a) => a.studentId));
    return {
      kpis: { totalStudents: sts.length, eligibleStudents: eligible.length, appliedStudents: appliedIds.size, uniqueStudentsPlaced: placedIds.size, totalOffers: offs.length, acceptedOffers: offs.filter((o) => o.status === 'accepted').length, placementPct: sts.length ? Math.round((placedIds.size / sts.length) * 1000) / 10 : 0 },
      offersByDept: departments.filter((d) => !f.dept || d.id === f.dept).map((d) => ({ dept: d.code, offers: offs.filter((o) => sOf(o.studentId).departmentId === d.id).length, accepted: offs.filter((o) => o.status === 'accepted' && sOf(o.studentId).departmentId === d.id).length, placedStudents: [...placedIds].filter((id) => sOf(id).departmentId === d.id).length, students: sts.filter((x) => x.departmentId === d.id).length })),
      companyOffers: companies.map((c) => ({ company: c.name, offers: offs.filter((o) => o.companyId === c.id).length, accepted: offs.filter((o) => o.companyId === c.id && o.status === 'accepted').length })).filter((c) => c.offers),
      eligibleVsApplied: departments.filter((d) => !f.dept || d.id === f.dept).map((d) => ({ dept: d.code, eligible: eligible.filter((x) => x.departmentId === d.id).length, applied: [...appliedIds].filter((id) => sOf(id).departmentId === d.id).length })),
      funnel: [
        { stage: 'Eligible students', count: eligible.length },
        { stage: 'Applied', count: apps.length },
        { stage: 'Shortlisted', count: reached('shortlisted') },
        { stage: 'Interviewed', count: reached('interview') },
        { stage: 'Selected', count: reached('selected') },
        { stage: 'Offers', count: offs.length },
      ],
      monthly: Object.values(months).sort((a, b) => a.t - b.t).map(({ t, ...m }) => m),
      statusDist: [...STAGES, 'rejected' as const, 'withdrawn' as const].map((st) => ({ status: label(st), count: apps.filter((a: Application) => a.status === st).length })),
    };
  }),

  /** GET /reports/placement/export.csv */
  exportPlacementCsv: (f: ReportFilters = {}) => call('GET', '/reports/placement/export.csv', (s) => {
    requirePerm(s, 'reports.view', 'placement export');
    const { offs } = scope(f);
    const head = 'Student ID,Name,Department,Company,Job,Package (LPA),Offer status,Offer date';
    const rows = offs.map((o) => { const st = sOf(o.studentId); return [st.studentCode, st.name, deptName(st.departmentId), companies.find((c) => c.id === o.companyId)!.name, jOf(o.jobId).title, o.ctcLpa, o.status, o.offeredAt.slice(0, 10)].map((v) => `"${v}"`).join(','); });
    return [head, ...rows].join('\n');
  }),

  /** GET /reference/academic-years */
  filterOptions: () => call('GET', '/reference/filters', () => ({
    graduationYears: academicYears.map((a) => ({ value: String(a.graduationYear), label: `${a.label} (batch ${a.graduationYear})` })),
    departments: departments.map((d) => ({ value: d.id, label: d.code, name: d.name })),
    companies: companies.map((c) => ({ value: c.id, label: c.name })),
    jobs: jobs.map((j) => ({ value: j.id, label: `${companies.find((c) => c.id === j.companyId)!.name} — ${j.title}`, companyId: j.companyId })),
  })),
};
void auditLogs;
