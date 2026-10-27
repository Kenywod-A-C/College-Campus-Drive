import { ApiError, type Company, type Role, type Student, type User } from '@/types';
import type { StudentDetail, StudentQuery, StudentRow, JobView } from '@/types/views';
import { applications, audit, companies, computeCompletion, day, departments, deptName, evalFor, interviews, jobs, offers, students, uid, users } from '@/mock/db';
import { call, includesCI, notFound, paginate, requireAny, requirePerm, requireStudent, type Session } from './client';
import { appView, offerView, savedJobs } from './jobs';
import type { CompanyInput } from '../contracts/companies';
import type { ProfilePatch } from '../contracts/students';
import type { ImportResult, ImportRow, UserInput } from '../contracts/users';

const mask = (s: Student, session: Session): Student => {
  // Sensitive personal data (phone) is only visible to admins and to the student themself.
  if (session.role === 'admin' || session.studentId === s.id) return s;
  return { ...s, phone: s.phone ? s.phone.replace(/\d(?=\d{2})/g, '•') : undefined };
};
const row = (s: Student, session: Session): StudentRow => ({
  ...mask(s, session),
  applicationCount: applications.filter((a) => a.studentId === s.id).length,
  offerCount: offers.filter((o) => o.studentId === s.id).length,
});

// ------------------------------------------------------------------ Companies

export const companiesApi = {
  /** GET /companies */
  list: (q: { q?: string; industry?: string; tier?: string; archived?: 'exclude' | 'include' | 'only'; page?: number; pageSize?: number } = {}) => call('GET', '/companies', (s) => {
    requireAny(s, 'companies.manage', 'jobs.create', 'applications.review', 'students.view');
    let rows = companies.filter((c) => (q.archived === 'only' ? !!c.archivedAt : q.archived === 'include' ? true : !c.archivedAt)).map((c) => ({ company: c, jobCount: jobs.filter((j) => j.companyId === c.id).length, activeJobs: jobs.filter((j) => j.companyId === c.id && j.status === 'published').length, offers: offers.filter((o) => o.companyId === c.id).length }));
    if (q.q) rows = rows.filter((r) => includesCI(r.company.name, q.q!) || includesCI(r.company.industry, q.q!));
    if (q.industry) rows = rows.filter((r) => r.company.industry === q.industry);
    if (q.tier) rows = rows.filter((r) => r.company.tier === q.tier);
    return { ...paginate(rows, q.page, q.pageSize ?? 10), industries: [...new Set(companies.map((c) => c.industry))] };
  }),
  /** GET /companies/:id — one master record, many jobs and drives. */
  get: (id: string) => call('GET', `/companies/${id}`, (s) => {
    requireAny(s, 'companies.manage', 'jobs.create', 'applications.review', 'students.view');
    const c = companies.find((x) => x.id === id) ?? notFound('Company');
    const cj = jobs.filter((j) => j.companyId === id).map((j) => ({
      job: j, applicants: applications.filter((a) => a.jobId === j.id).length,
      selected: applications.filter((a) => a.jobId === j.id && (a.status === 'selected' || a.status === 'offer_received')).length,
      offers: offers.filter((o) => o.jobId === j.id).length,
    }));
    return { company: c, jobs: cj, interviews: interviews.filter((i) => cj.some((x) => x.job.id === i.jobId)).length };
  }),
  /** POST /companies/:id/archive */
  archive: (id: string, archived: boolean) => call('POST', `/companies/${id}/archive`, (s) => {
    requirePerm(s, 'companies.manage', 'company');
    const c = companies.find((x) => x.id === id) ?? notFound('Company');
    const live = jobs.filter((j) => j.companyId === id && j.status === 'published').length;
    if (archived && live) throw new ApiError(409, `${c.name} has ${live} published job(s). Close or cancel them before archiving the company.`);
    c.archivedAt = archived ? new Date().toISOString() : undefined;
    audit(s.user.name, s.role, archived ? 'company.archive' : 'company.unarchive', `Company ${c.name}`);
    return c;
  }),
  /** POST /companies, PUT /companies/:id */
  save: (input: CompanyInput) => call('POST', input.id ? `/companies/${input.id}` : '/companies', (s) => {
    requirePerm(s, 'companies.manage', 'company');
    if (!input.name.trim()) throw new ApiError(422, 'Company name is required.');
    if (!/^https?:\/\//.test(input.website)) throw new ApiError(422, 'Website must start with http:// or https://');
    if (companies.some((c) => c.name.toLowerCase() === input.name.trim().toLowerCase() && c.id !== input.id)) throw new ApiError(409, 'A company with this name already exists. Add a new job to it instead of duplicating the record.');
    const ex = input.id ? companies.find((c) => c.id === input.id) : undefined;
    if (ex) { Object.assign(ex, input, { color: input.color ?? ex.color }); audit(s.user.name, s.role, 'company.update', `Company ${ex.name}`); return ex; }
    const c: Company = { ...input, id: uid('co'), color: input.color ?? '#2563eb', createdAt: new Date().toISOString() };
    companies.push(c);
    audit(s.user.name, s.role, 'company.create', `Company ${c.name}`);
    return c;
  }),
};

// ------------------------------------------------------------------ Student directory (faculty/admin)
export const studentsApi = {
  /** GET /students */
  list: (q: StudentQuery = {}) => call('GET', '/students', (s) => {
    requirePerm(s, 'students.view', 'student directory');
    let rows = students.map((st) => row(st, s));
    if (q.q) rows = rows.filter((r) => includesCI(r.name, q.q!) || includesCI(r.studentCode, q.q!) || includesCI(r.email, q.q!));
    if (q.dept) rows = rows.filter((r) => r.departmentId === q.dept);
    if (q.year) rows = rows.filter((r) => r.graduationYear === q.year);
    if (q.minCgpa != null) rows = rows.filter((r) => (r.academic.cgpa ?? 0) >= q.minCgpa!);
    if (q.skill) rows = rows.filter((r) => r.skills.some((k) => includesCI(k, q.skill!)));
    if (q.placement) rows = rows.filter((r) => r.placementStatus === q.placement);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(rows, q.page, q.pageSize ?? 10);
  }),
  /** GET /students/:id */
  get: (id: string) => call('GET', `/students/${id}`, (s): StudentDetail => {
    requirePerm(s, 'students.view', `student ${id}`);
    const st = students.find((x) => x.id === id) ?? notFound('Student');
    return {
      student: row(st, s),
      applications: applications.filter((a) => a.studentId === id).map((a) => appView(a, s)),
      offers: offers.filter((o) => o.studentId === id).map((o) => offerView(o, s)),
    };
  }),
  /** POST /students/:id/verify-cgpa — only staff with students.edit. */
  verifyCgpa: (id: string, cgpa?: number) => call('POST', `/students/${id}/verify-cgpa`, (s) => {
    requirePerm(s, 'students.edit', 'student academic record');
    const st = students.find((x) => x.id === id) ?? notFound('Student');
    if (st.academic.cgpa == null && cgpa == null) throw new ApiError(422, 'Student has not entered a CGPA.');
    if (cgpa != null) { if (cgpa < 0 || cgpa > 10) throw new ApiError(422, 'CGPA must be between 0 and 10.'); st.academic.cgpa = cgpa; }
    st.academic.cgpaVerified = true;
    st.profileCompletion = computeCompletion(st);
    audit(s.user.name, s.role, 'student.verify_cgpa', `Student ${st.studentCode}`);
    return row(st, s);
  }),
};

// ------------------------------------------------------------------ Student self-service
const FORBIDDEN_SELF = ['id', 'userId', 'role', 'placementStatus', 'departmentId', 'studentCode', 'graduationYear', 'profileCompletion', 'email'];

export const studentApi = {
  /** GET /student/profile */
  getProfile: () => call('GET', '/student/profile', (s) => requireStudent(s)),
  /** PATCH /student/profile — whitelist only. Self-reported academics reset verification. */
  updateProfile: (patch: ProfilePatch) => call('PATCH', '/student/profile', (s) => {
    const st = requireStudent(s);
    const bad = Object.keys(patch).filter((k) => FORBIDDEN_SELF.includes(k));
    if (bad.length) {
      audit(st.name, s.role, 'student.update', `Profile fields ${bad.join(', ')}`, 'denied', 'Controlled fields');
      throw new ApiError(403, `${bad.join(', ')} can only be changed by the placement cell.`);
    }
    if (patch.cgpa != null && (patch.cgpa < 0 || patch.cgpa > 10)) throw new ApiError(422, 'CGPA must be between 0 and 10.');
    const { cgpa, activeArrears, arrearHistory, ...rest } = patch;
    Object.assign(st, rest);
    if (cgpa !== undefined || activeArrears !== undefined || arrearHistory !== undefined) {
      const changed = (cgpa !== undefined && cgpa !== st.academic.cgpa) || (activeArrears !== undefined && activeArrears !== st.academic.activeArrears);
      st.academic = { cgpa: cgpa ?? st.academic.cgpa, activeArrears: activeArrears ?? st.academic.activeArrears, arrearHistory: arrearHistory ?? st.academic.arrearHistory, cgpaVerified: changed ? false : st.academic.cgpaVerified };
    }
    st.profileCompletion = computeCompletion(st);
    audit(st.name, s.role, 'student.update', `Own profile ${st.studentCode}`);
    return st;
  }),
  /** GET /student/dashboard */
  dashboard: () => call('GET', '/student/dashboard', (s) => {
    const st = requireStudent(s);
    const published = jobs.filter((j) => j.status === 'published');
    const views: JobView[] = published.map((j) => {
      const app = applications.find((a) => a.studentId === st.id && a.jobId === j.id && a.status !== 'withdrawn');
      const overlap = j.skills.filter((k) => st.skills.some((x) => x.toLowerCase() === k.toLowerCase())).length;
      const eligibility = evalFor(st, j);
      return { job: j, company: companies.find((c) => c.id === j.companyId)!, eligibleDepartments: j.eligibility.departmentIds.map(deptName), eligibility, applicationId: app?.id, applicationStatus: app?.status, saved: (savedJobs[st.id] ?? []).includes(j.id), relevance: overlap * 2 + (eligibility.state === 'eligible' ? 3 : 0) };
    });
    const mine = applications.filter((a) => a.studentId === st.id);
    const myIds = new Set(mine.map((a) => a.id));
    const ints = interviews.filter((i) => i.status === 'scheduled' && new Date(i.at) > new Date() && i.applicationIds.some((id) => myIds.has(id)));
    const events = [
      ...ints.map((i) => ({ id: i.id, title: `${i.round} — ${jobs.find((j) => j.id === i.jobId)!.title}`, sub: companies.find((c) => c.id === jobs.find((j) => j.id === i.jobId)!.companyId)!.name, at: i.at, kind: 'interview' as const })),
      ...mine.filter((a) => !['rejected', 'withdrawn'].includes(a.status)).map((a) => jobs.find((j) => j.id === a.jobId)!).filter((j) => j.driveDate && new Date(j.driveDate) > new Date()).map((j) => ({ id: `d_${j.id}`, title: `${j.title} placement drive`, sub: companies.find((c) => c.id === j.companyId)!.name, at: j.driveDate!, kind: 'drive' as const })),
    ].sort((a, b) => +new Date(a.at) - +new Date(b.at)).slice(0, 5);
    return {
      student: st,
      metrics: {
        eligibleJobs: views.filter((v) => v.eligibility!.state === 'eligible').length,
        activeApplications: mine.filter((a) => ['applied', 'shortlisted', 'interview', 'selected'].includes(a.status)).length,
        offers: offers.filter((o) => o.studentId === st.id).length,
        upcoming: events.length,
      },
      events,
      deadlines: views.filter((v) => !v.applicationId && v.eligibility!.state !== 'not_eligible').sort((a, b) => +new Date(a.job.deadline) - +new Date(b.job.deadline)).slice(0, 4),
      recommended: views.filter((v) => v.eligibility!.state === 'eligible' && !v.applicationId).sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 3),
      activity: mine.flatMap((a) => a.history.map((h) => ({ at: h.at, status: h.status, text: `${jobs.find((j) => j.id === a.jobId)!.title} · ${companies.find((c) => c.id === jobs.find((j) => j.id === a.jobId)!.companyId)!.name}`, note: h.note, applicationId: a.id }))).sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 6),
    };
  }),
};

// ------------------------------------------------------------------ Admin user management

export const usersApi = {
  /** GET /users */
  list: (q: { q?: string; role?: Role | 'all'; status?: string; dept?: string; page?: number; pageSize?: number } = {}) => call('GET', '/users', (s) => {
    requirePerm(s, 'users.manage', 'users');
    let rows = [...users];
    if (q.role && q.role !== 'all') rows = rows.filter((u) => u.role === q.role);
    if (q.status && q.status !== 'all') rows = rows.filter((u) => u.status === q.status);
    if (q.dept) rows = rows.filter((u) => u.departmentId === q.dept);
    if (q.q) rows = rows.filter((u) => includesCI(u.name, q.q!) || includesCI(u.email, q.q!) || includesCI(u.userCode, q.q!));
    return paginate(rows, q.page, q.pageSize ?? 10);
  }),
  /** POST /users — roles are assigned only here, by an authorised administrator. Never returns a password. */
  save: (input: UserInput) => call('POST', input.id ? `/users/${input.id}` : '/users', (s) => {
    requirePerm(s, 'users.manage', 'user');
    if (!input.name.trim() || !/^\S+@\S+\.\S+$/.test(input.email)) throw new ApiError(422, 'Name and a valid email are required.');
    if (users.some((u) => u.email.toLowerCase() === input.email.toLowerCase() && u.id !== input.id)) throw new ApiError(409, 'A user with this email already exists.');
    if (users.some((u) => u.userCode.toLowerCase() === input.userCode.toLowerCase() && u.id !== input.id)) throw new ApiError(409, 'This user ID is already in use.');
    const ex = input.id ? users.find((u) => u.id === input.id) : undefined;
    if (ex) {
      if (ex.id === s.user.id && input.role !== ex.role) throw new ApiError(409, 'You cannot change your own role.');
      const roleChanged = ex.role !== input.role;
      Object.assign(ex, input);
      audit(s.user.name, s.role, roleChanged ? 'user.role_change' : 'user.update', `User ${ex.name}`, 'success', roleChanged ? `Role set to ${input.role}` : undefined);
      return ex;
    }
    const u: User = { id: uid('u'), name: input.name, email: input.email, userCode: input.userCode, role: input.role, departmentId: input.departmentId, status: 'invited', createdAt: new Date().toISOString() };
    users.push(u);
    audit(s.user.name, s.role, 'user.create', `User ${u.name} (${u.role})`);
    return u;
  }),
  /** POST /users/:id/status */
  setStatus: (id: string, status: 'active' | 'inactive') => call('POST', `/users/${id}/status`, (s) => {
    requirePerm(s, 'users.manage', 'user');
    const u = users.find((x) => x.id === id) ?? notFound('User');
    if (u.id === s.user.id) throw new ApiError(409, 'You cannot deactivate your own account.');
    u.status = status;
    audit(s.user.name, s.role, status === 'active' ? 'user.activate' : 'user.deactivate', `User ${u.name}`);
    return u;
  }),
  /** POST /users/:id/reset-password — triggers an emailed one-time link; no password is ever shown. */
  resetPassword: (id: string) => call('POST', `/users/${id}/reset-password`, (s) => {
    requirePerm(s, 'users.manage', 'user');
    const u = users.find((x) => x.id === id) ?? notFound('User');
    audit(s.user.name, s.role, 'user.reset_password', `User ${u.name}`);
    return { message: `A password reset link would be emailed to ${u.email}. (Demo: no email is sent.)` };
  }),
  /** POST /users/import — validates every row; valid rows are imported, errors are returned for download. */
  importStudents: (rows: ImportRow[]) => call('POST', '/users/import', (s): ImportResult => {
    requirePerm(s, 'users.manage', 'student import');
    const errors: ImportResult['errors'] = [];
    let imported = 0;
    const seen = new Set<string>();
    rows.forEach((r, idx) => {
      const n = idx + 2; // header is row 1
      const err = (field: string, message: string, value = '') => errors.push({ row: n, field, message, value });
      const dept = departments.find((d) => d.code.toLowerCase() === r.departmentCode?.trim().toLowerCase());
      const before = errors.length;
      if (!r.studentCode?.trim()) err('studentCode', 'Student ID is required');
      else if (users.some((u) => u.userCode.toLowerCase() === r.studentCode.toLowerCase()) || seen.has(r.studentCode.toLowerCase())) err('studentCode', 'Duplicate student ID', r.studentCode);
      if (!r.name?.trim()) err('name', 'Name is required');
      if (!/^\S+@\S+\.\S+$/.test(r.email ?? '')) err('email', 'Invalid email address', r.email);
      else if (users.some((u) => u.email.toLowerCase() === r.email.toLowerCase())) err('email', 'Email already registered', r.email);
      if (!dept) err('departmentCode', 'Unknown department code', r.departmentCode);
      if (!/^20\d{2}$/.test(r.graduationYear ?? '')) err('graduationYear', 'Graduation year must be a 4-digit year', r.graduationYear);
      if (r.cgpa && !(Number(r.cgpa) >= 0 && Number(r.cgpa) <= 10)) err('cgpa', 'CGPA must be between 0 and 10', r.cgpa);
      if (errors.length > before) return;
      seen.add(r.studentCode.toLowerCase());
      const sid = uid('s'); const uidv = uid('u');
      const st: Student = {
        id: sid, userId: uidv, studentCode: r.studentCode, name: r.name, email: r.email, departmentId: dept!.id, degree: 'B.E.', currentYear: 4, graduationYear: Number(r.graduationYear),
        academic: { cgpa: r.cgpa ? Number(r.cgpa) : undefined, cgpaVerified: false, activeArrears: 0, arrearHistory: 0 }, skills: [], interests: [], preferredRoles: [], profileCompletion: 0, placementStatus: 'unplaced',
      };
      st.profileCompletion = computeCompletion(st);
      students.push(st);
      users.push({ id: uidv, userCode: r.studentCode, name: r.name, email: r.email, role: 'student', departmentId: dept!.id, status: 'invited', createdAt: new Date().toISOString(), onboardingComplete: false });
      imported++;
    });
    audit(s.user.name, s.role, 'user.import', `Student import (${imported}/${rows.length} rows)`, errors.length ? 'success' : 'success', errors.length ? `${errors.length} validation error(s)` : undefined);
    return { total: rows.length, imported, errors };
  }),
};
void day; void deptName;
