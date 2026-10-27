// Jobs, applications, offers and interviews. Business rules live HERE (the "backend"), never in components.
import type { JobInput } from '../contracts/jobs';
import type { InterviewInput, InterviewView } from '../contracts/interviews';
import type { OfferList, OfferListQuery } from '../contracts/offers';
import { ApiError, type Application, type ApplicationStatus, type Interview, type Job, type JobStatus, type Offer, type OfferStatus, type Student } from '@/types';
import type {
  ApplicationDetail, ApplicationQuery, ApplicationView, JobQuery, JobView, OfferView,
} from '@/types/views';
import {
  applications, audit, companies, day, deptName, documents, evalFor, interviews, jobs, notifications, offers, policies, students, uid,
} from '@/mock/db';
import { call, includesCI, notFound, paginate, requireAny, requirePerm, requireRole, requireStudent, type Session } from './client';

export const savedJobs: Record<string, string[]> = { s_1: ['j_fw_sde', 'j_bosch_emb'] };
const company = (id: string) => companies.find((c) => c.id === id)!;
const job = (id: string) => jobs.find((j) => j.id === id) ?? notFound('Job');
const student = (id: string) => students.find((s) => s.id === id) ?? notFound('Student');
const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const isActive = (st: ApplicationStatus) => !['rejected', 'withdrawn', 'offer_received'].includes(st);

function jobView(j: Job, s: Session): JobView {
  const v: JobView = { job: j, company: company(j.companyId), eligibleDepartments: j.eligibility.departmentIds.map(deptName) };
  if (s.role === 'student') {
    const st = student(s.studentId!);
    v.eligibility = evalFor(st, j);
    v.saved = (savedJobs[st.id] ?? []).includes(j.id);
    const app = applications.find((a) => a.studentId === st.id && a.jobId === j.id && a.status !== 'withdrawn');
    v.applicationId = app?.id;
    v.applicationStatus = app?.status;
    const overlap = j.skills.filter((k) => st.skills.some((x) => x.toLowerCase() === k.toLowerCase())).length;
    const roleBoost = st.preferredRoles.some((r) => j.title.toLowerCase().includes(r.split(' ')[0].toLowerCase())) ? 1 : 0;
    v.relevance = overlap * 2 + roleBoost + (v.eligibility.state === 'eligible' ? 3 : 0);
  } else {
    v.applicantCount = applications.filter((a) => a.jobId === j.id).length;
  }
  return v;
}

export function appView(a: Application, s: Session): ApplicationView {
  const j = job(a.jobId);
  const nextInt = interviews.filter((i) => i.applicationIds.includes(a.id) && i.status === 'scheduled' && new Date(i.at) > new Date()).sort((x, y) => +new Date(x.at) - +new Date(y.at))[0];
  const offer = offers.find((o) => o.applicationId === a.id);
  let nextAction: string | undefined;
  if (nextInt) nextAction = `${nextInt.round} · ${fmt(nextInt.at)}`;
  else if (a.status === 'offer_received' && offer?.status === 'received') nextAction = `Respond to offer by ${new Date(offer.acceptBy).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  else if (a.status === 'shortlisted') nextAction = 'Awaiting interview schedule';
  else if (a.status === 'applied') nextAction = 'Awaiting screening';
  else if (a.status === 'selected') nextAction = 'Offer being prepared';
  const v: ApplicationView = { application: a, job: j, company: company(j.companyId), nextAction };
  if (s.role !== 'student') v.student = student(a.studentId);
  return v;
}

export function notify(userId: string, title: string, body: string, kind: 'application' | 'offer' | 'interview' | 'drive' | 'deadline' | 'system', link?: string) {
  notifications.unshift({ id: uid('n'), userId, title, body, kind, at: new Date().toISOString(), read: false, link });
}

// ------------------------------------------------------------------ Jobs
export type { JobInput };

export const jobsApi = {
  /** GET /jobs */
  list: (q: JobQuery = {}) => call('GET', '/jobs', (s) => {
    let rows = jobs.filter((j) => (s.role === 'student' ? j.status === 'published' || (j.status !== 'draft' && applications.some((a) => a.studentId === s.studentId && a.jobId === j.id)) : true));
    if (s.role !== 'student' && q.status && q.status !== 'all') rows = rows.filter((j) => j.status === q.status);
    if (s.role !== 'student') rows = rows.filter((j) => (q.archived === 'only' ? !!j.archivedAt : q.archived === 'include' ? true : !j.archivedAt));
    if (s.role === 'student' && !q.tab) rows = rows.filter((j) => j.status === 'published');
    if (q.companyId) rows = rows.filter((j) => j.companyId === q.companyId);
    if (q.q) rows = rows.filter((j) => [j.title, company(j.companyId).name, j.domain, ...j.skills].some((x) => includesCI(x, q.q!)));
    if (q.dept) rows = rows.filter((j) => j.eligibility.departmentIds.includes(q.dept!));
    if (q.minCgpa != null) rows = rows.filter((j) => j.eligibility.minCgpa <= q.minCgpa!);
    if (q.location) rows = rows.filter((j) => includesCI(j.location, q.location!));
    if (q.type) rows = rows.filter((j) => j.type === q.type);
    if (q.deadlineDays) rows = rows.filter((j) => +new Date(j.deadline) - Date.now() <= q.deadlineDays! * 86400000 && new Date(j.deadline) > new Date());
    let views = rows.map((j) => jobView(j, s));
    if (s.role === 'student') {
      const tab = q.tab ?? 'all';
      if (tab === 'eligible') views = views.filter((v) => v.eligibility!.state === 'eligible' && v.job.status === 'published');
      if (tab === 'not_eligible') views = views.filter((v) => v.eligibility!.state === 'not_eligible' && v.job.status === 'published');
      if (tab === 'saved') views = views.filter((v) => v.saved);
      if (tab === 'applied') views = views.filter((v) => v.applicationId);
      if (tab !== 'applied') views = views.filter((v) => v.job.status === 'published');
    }
    const sort = q.sort ?? 'deadline';
    views.sort((a, b) =>
      sort === 'relevance' ? (b.relevance ?? 0) - (a.relevance ?? 0)
      : sort === 'recent' ? +new Date(b.job.publishedAt ?? b.job.openDate) - +new Date(a.job.publishedAt ?? a.job.openDate)
      : +new Date(a.job.deadline) - +new Date(b.job.deadline));
    return paginate(views, q.page, q.pageSize ?? 9);
  }),

  /** GET /jobs/:id — students can only see published jobs (or ones they applied to). */
  get: (id: string) => call('GET', `/jobs/${id}`, (s) => {
    const j = job(id);
    if (s.role === 'student' && j.status === 'draft') notFound('Job');
    return jobView(j, s);
  }),

  /** POST /jobs/:id/archive */
  archive: (id: string, archived: boolean) => call('POST', `/jobs/${id}/archive`, (s) => {
    requirePerm(s, 'drives.publish', 'job');
    const j = job(id);
    if (archived && j.status === 'published') throw new ApiError(409, 'A published job cannot be archived. Close or cancel it first.');
    j.archivedAt = archived ? new Date().toISOString() : undefined;
    audit(s.user.name, s.role, archived ? 'job.archive' : 'job.unarchive', `Job ${j.title}`);
    return j;
  }),
  /** GET /jobs/:id/drive — drive details for faculty/admin. */
  drive: (id: string) => call('GET', `/jobs/${id}/drive`, (s) => {
    requireAny(s, 'jobs.create', 'drives.publish', 'applications.review');
    const j = job(id);
    const apps = applications.filter((a) => a.jobId === id);
    const by = (st: ApplicationStatus) => apps.filter((a) => a.status === st).length;
    const eligibleStudents = students.filter((st) => {
      const r = evalFor(st, { ...j, status: 'published', deadline: day(1) });
      return r.state !== 'not_eligible';
    }).length;
    return {
      view: jobView(j, s),
      eligibleStudents,
      counts: { applied: apps.length, shortlisted: by('shortlisted'), interview: by('interview'), selected: by('selected'), offers: by('offer_received'), rejected: by('rejected') },
      interviews: interviews.filter((i) => i.jobId === id),
      documents: documents.filter((d) => d.jobId === id || (d.companyId === j.companyId && !d.jobId)),
    };
  }),

  /** POST /jobs/:id/save */
  toggleSave: (id: string) => call('POST', `/jobs/${id}/save`, (s) => {
    const st = requireStudent(s);
    job(id);
    const cur = savedJobs[st.id] ?? [];
    savedJobs[st.id] = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    return { saved: savedJobs[st.id].includes(id) };
  }),

  /** POST /jobs — create draft/published. PUT /jobs/:id — update. */
  save: (input: JobInput) => call('POST', input.id ? `/jobs/${input.id}` : '/jobs', (s) => {
    requirePerm(s, 'jobs.create', 'job');
    if (input.status === 'published') requirePerm(s, 'drives.publish', 'job');
    if (!input.title.trim()) throw new ApiError(422, 'Job title is required.');
    if (!companies.some((c) => c.id === input.companyId)) throw new ApiError(422, 'Select a company.');
    if (new Date(input.deadline) <= new Date(input.openDate)) throw new ApiError(422, 'Deadline must be after the opening date.');
    const existing = input.id ? job(input.id) : undefined;
    if (existing && (existing.status === 'closed' || existing.status === 'cancelled')) throw new ApiError(409, `A ${existing.status} job cannot be edited.`);
    const now = new Date().toISOString();
    const base = { ...input, updatedAt: now };
    let saved: Job;
    if (existing) {
      Object.assign(existing, base, { publishedAt: existing.publishedAt ?? (input.status === 'published' ? now : undefined) });
      saved = existing;
    } else {
      saved = { ...base, id: uid('j'), createdBy: s.user.id, publishedAt: input.status === 'published' ? now : undefined } as Job;
      jobs.unshift(saved);
    }
    audit(s.user.name, s.role, existing ? 'job.update' : 'job.create', `Job ${saved.title} (${company(saved.companyId).name})`);
    if (input.status === 'published' && existing?.status !== 'published') audit(s.user.name, s.role, 'job.publish', `Job ${saved.title}`);
    return saved;
  }),

  /** POST /jobs/:id/status — publish / close / cancel (confirmation + reason handled in UI). */
  setStatus: (id: string, status: JobStatus, reason?: string) => call('POST', `/jobs/${id}/status`, (s) => {
    requirePerm(s, 'drives.publish', 'job');
    const j = job(id);
    const allowed: Record<JobStatus, JobStatus[]> = { draft: ['published', 'cancelled'], published: ['draft', 'closed', 'cancelled'], closed: ['published'], cancelled: [] };
    if (j.archivedAt) throw new ApiError(409, 'This job is archived. Restore it before changing its status.');
    if (status === j.status) return j;
    if (!allowed[j.status].includes(status)) throw new ApiError(409, `A ${j.status} job cannot become ${status}.`);
    if (status === 'draft' && applications.some((a) => a.jobId === id)) throw new ApiError(409, 'This job already has applications, so it cannot be unpublished. Close it instead.');
    if (status === 'cancelled' && !reason?.trim()) throw new ApiError(422, 'A reason is required to cancel a job.');
    if (status === 'published' && new Date(j.deadline) < new Date()) throw new ApiError(422, 'Extend the application deadline before publishing.');
    j.status = status;
    if (status === 'published') j.publishedAt = j.publishedAt ?? new Date().toISOString();
    j.updatedAt = new Date().toISOString();
    if (status === 'cancelled') applications.filter((a) => a.jobId === id && isActive(a.status)).forEach((a) => notify(student(a.studentId).userId, `${company(j.companyId).name} drive cancelled`, `${j.title} has been cancelled. ${reason}`, 'drive'));
    audit(s.user.name, s.role, `job.${status === 'published' ? 'publish' : status === 'draft' ? 'unpublish' : status === 'closed' ? 'close' : 'cancel'}`, `Job ${j.title}`, 'success', reason);
    return j;
  }),
};

// ------------------------------------------------------------------ Applications
export const applicationsApi = {
  /** POST /applications — eligibility and deadline are re-validated server-side at submission time. */
  apply: (jobId: string) => call('POST', '/applications', (s) => {
    const st = requireStudent(s);
    const j = job(jobId);
    if (j.status !== 'published') throw new ApiError(409, `This job is ${j.status} and is not accepting applications.`);
    if (new Date(j.deadline) < new Date()) throw new ApiError(409, 'The application deadline has passed.');
    if (applications.some((a) => a.studentId === st.id && a.jobId === jobId && a.status !== 'withdrawn')) throw new ApiError(409, 'You have already applied to this job.');
    const result = evalFor(st, j);
    if (result.state !== 'eligible') {
      audit(st.name, s.role, 'application.create', `Application ${j.title}`, 'denied', result.summary);
      throw new ApiError(403, result.summary);
    }
    const limit = policies.find((p) => p.kind === 'application_limit' && p.enabled);
    const active = applications.filter((a) => a.studentId === st.id && isActive(a.status)).length;
    if (limit && active >= Number(limit.params.maxActiveApplications)) throw new ApiError(409, `Policy limit reached: at most ${limit.params.maxActiveApplications} active applications.`);
    const now = new Date().toISOString();
    const app: Application = {
      id: uid('app'), studentId: st.id, jobId, status: 'applied', appliedAt: now, updatedAt: now, eligibilitySnapshot: result,
      history: [{ status: 'applied', at: now, by: st.name, note: 'Application submitted' }],
    };
    applications.unshift(app);
    audit(st.name, s.role, 'application.create', `Application ${j.title} (${company(j.companyId).name})`);
    notify(s.user.id, `Application submitted — ${company(j.companyId).name}`, `Your application for ${j.title} was received.`, 'application', '/student/applications');
    return appView(app, s);
  }),

  /** GET /applications/me */
  listMine: (q: ApplicationQuery = {}) => call('GET', '/applications/me', (s) => {
    const st = requireStudent(s);
    let rows = applications.filter((a) => a.studentId === st.id).map((a) => appView(a, s));
    if (q.status && q.status !== 'all') rows = rows.filter((r) => r.application.status === q.status);
    if (q.q) rows = rows.filter((r) => includesCI(r.job.title, q.q!) || includesCI(r.company.name, q.q!));
    rows.sort((a, b) => +new Date(b.application.updatedAt) - +new Date(a.application.updatedAt));
    return paginate(rows, q.page, q.pageSize ?? 10);
  }),

  /** GET /applications/:id — record-level access check (IDOR protection). */
  get: (id: string) => call('GET', `/applications/${id}`, (s): ApplicationDetail => {
    const a = applications.find((x) => x.id === id) ?? notFound('Application');
    if (s.role === 'student' && a.studentId !== s.studentId) {
      audit(s.user.name, s.role, 'application.read', `Application ${id}`, 'denied', 'Not the owner');
      throw new ApiError(403, 'You do not have access to this application.');
    }
    if (s.role !== 'student') requireAny(s, 'applications.review', 'students.view');
    const v = appView(a, s);
    const st = student(a.studentId);
    return {
      ...v,
      interviews: interviews.filter((i) => i.applicationIds.includes(a.id)),
      notifications: notifications.filter((n) => n.userId === st.userId && (n.kind === 'interview' || n.kind === 'application' || n.kind === 'offer')).slice(0, 5),
      offer: offers.find((o) => o.applicationId === a.id),
    };
  }),

  /** POST /applications/:id/withdraw */
  withdraw: (id: string) => call('POST', `/applications/${id}/withdraw`, (s) => {
    const st = requireStudent(s);
    const a = applications.find((x) => x.id === id && x.studentId === st.id) ?? notFound('Application');
    if (!['applied', 'shortlisted', 'interview'].includes(a.status)) throw new ApiError(409, 'This application can no longer be withdrawn.');
    const now = new Date().toISOString();
    a.status = 'withdrawn'; a.updatedAt = now;
    a.history.push({ status: 'withdrawn', at: now, by: st.name, note: 'Withdrawn by student' });
    audit(st.name, s.role, 'application.withdraw', `Application ${job(a.jobId).title}`);
    return appView(a, s);
  }),

  /** GET /applications — faculty applicant management. */
  listAll: (q: ApplicationQuery = {}) => call('GET', '/applications', (s) => {
    requireAny(s, 'applications.review', 'students.view');
    let rows = applications.map((a) => appView(a, s));
    if (q.status && q.status !== 'all') rows = rows.filter((r) => r.application.status === q.status);
    if (q.companyId) rows = rows.filter((r) => r.company.id === q.companyId);
    if (q.jobId) rows = rows.filter((r) => r.job.id === q.jobId);
    if (q.dept) rows = rows.filter((r) => r.student!.departmentId === q.dept);
    if (q.eligibility) rows = rows.filter((r) => r.application.eligibilitySnapshot.state === q.eligibility);
    if (q.q) rows = rows.filter((r) => includesCI(r.student!.name, q.q!) || includesCI(r.student!.studentCode, q.q!) || includesCI(r.company.name, q.q!) || includesCI(r.job.title, q.q!));
    const sort = q.sort ?? 'recent';
    rows.sort((a, b) => sort === 'cgpa' ? (b.student!.academic.cgpa ?? 0) - (a.student!.academic.cgpa ?? 0) : sort === 'name' ? a.student!.name.localeCompare(b.student!.name) : +new Date(b.application.appliedAt) - +new Date(a.application.appliedAt));
    return paginate(rows, q.page, q.pageSize ?? 10);
  }),

  /**
   * POST /applications/stage — bulk stage update. Faculty cannot silently bypass eligibility:
   * advancing a non-eligible applicant requires an exception with a reason and approving user, which is audited.
   */
  updateStage: (ids: string[], status: ApplicationStatus, note?: string, exception?: { reason: string; approvedBy: string }) => call('POST', '/applications/stage', (s) => {
    requirePerm(s, 'applications.review', 'application');
    if (status === 'offer_received') throw new ApiError(422, 'Offers are created from the Offers & Placements module, not by changing a stage.');
    const order: ApplicationStatus[] = ['applied', 'shortlisted', 'interview', 'selected'];
    const excPolicy = policies.find((p) => p.kind === 'exception_approval' && p.enabled);
    const updated: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const a = applications.find((x) => x.id === id);
      if (!a) { failed.push({ id, reason: 'Application not found' }); continue; }
      const who = `${student(a.studentId).name} · ${job(a.jobId).title}`;
      if (['withdrawn', 'offer_received', 'rejected'].includes(a.status)) { failed.push({ id, reason: `${who}: already ${a.status.replace('_', ' ')}` }); continue; }
      if (status !== 'rejected') {
        if (order.indexOf(status) <= order.indexOf(a.status)) { failed.push({ id, reason: `${who}: already at or beyond ${status}` }); continue; }
        if (a.eligibilitySnapshot.state !== 'eligible') {
          if (!exception) { failed.push({ id, reason: `${who}: not eligible (${a.eligibilitySnapshot.summary}). An approved exception is required.` }); continue; }
          if (excPolicy && (!exception.reason.trim() || !exception.approvedBy.trim())) { failed.push({ id, reason: `${who}: exception needs a reason and approver` }); continue; }
          a.eligibilitySnapshot.exceptionGranted = exception;
          audit(s.user.name, s.role, 'eligibility.exception', `Application ${who}`, 'success', `${exception.reason} (approved by ${exception.approvedBy})`);
        }
      }
      const now = new Date().toISOString();
      a.status = status; a.updatedAt = now;
      a.history.push({ status, at: now, by: s.user.name, note: note || `Moved to ${status}` });
      notify(student(a.studentId).userId, `Application update — ${company(job(a.jobId).companyId).name}`, `Your application for ${job(a.jobId).title} is now ${status.replace('_', ' ')}.`, 'application', `/student/applications/${a.id}`);
      updated.push(id);
    }
    if (updated.length) audit(s.user.name, s.role, `application.${status}`, `${updated.length} application(s)`);
    return { updated, failed };
  }),

  /** GET /applications/export — CSV of authorised rows. */
  exportCsv: (q: ApplicationQuery = {}) => call('GET', '/applications/export', (s) => {
    requirePerm(s, 'reports.view', 'applications export');
    let rows = applications.map((a) => appView(a, s));
    if (q.status && q.status !== 'all') rows = rows.filter((r) => r.application.status === q.status);
    if (q.companyId) rows = rows.filter((r) => r.company.id === q.companyId);
    if (q.dept) rows = rows.filter((r) => r.student!.departmentId === q.dept);
    audit(s.user.name, s.role, 'report.export', `Applications CSV (${rows.length} rows)`);
    const head = 'Student ID,Name,Department,CGPA,Company,Job,Eligibility,Stage,Applied on';
    const body = rows.map((r) => [r.student!.studentCode, r.student!.name, deptName(r.student!.departmentId), r.student!.academic.cgpa ?? '', r.company.name, r.job.title, r.application.eligibilitySnapshot.state, r.application.status, r.application.appliedAt.slice(0, 10)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return [head, ...body].join('\n');
  }),
};

// ------------------------------------------------------------------ Offers
function offerPolicyChecks(st: Student, companyId: string, excludeOfferId?: string) {
  const accepted = offers.filter((o) => o.studentId === st.id && o.status === 'accepted' && o.id !== excludeOfferId);
  const checks: Offer['policyChecks'] = [];
  const max = policies.filter((p) => p.kind === 'max_offers' && p.enabled && (p.scope === 'college' || (p.scope === 'department' && p.scopeValue === st.departmentId)))
    .map((p) => Number(p.params.maxAcceptedOffers)).reduce((m, v) => Math.max(m, v), 0);
  if (max) checks.push({ label: 'Within accepted-offer limit', passed: accepted.length < max, detail: `${accepted.length} of ${max} accepted offers used.` });
  const tier = policies.find((p) => p.kind === 'tier_restriction' && p.enabled);
  if (tier && accepted.length) {
    const rank = { regular: 0, dream: 1, super_dream: 2 } as const;
    const best = Math.max(...accepted.map((o) => rank[company(o.companyId).tier]));
    const ok = best === 0 || rank[company(companyId).tier] > best;
    checks.push({ label: 'Company tier rule', passed: ok, detail: ok ? 'Tier rule satisfied.' : 'Student may only hold offers from a higher tier than existing accepted offers.' });
  }
  return checks;
}
export const offerView = (o: Offer, s: Session): OfferView => ({ offer: o, job: job(o.jobId), company: company(o.companyId), student: s.role === 'student' ? undefined : student(o.studentId) });
const syncPlacement = (studentId: string) => {
  const st = student(studentId);
  if (st.placementStatus === 'opted_out') return;
  st.placementStatus = offers.some((o) => o.studentId === studentId && o.status === 'accepted') ? 'placed' : applications.some((a) => a.studentId === studentId) ? 'in_process' : 'unplaced';
};

export const offersApi = {
  /** GET /offers/me */
  listMine: () => call('GET', '/offers/me', (s) => {
    const st = requireStudent(s);
    return offers.filter((o) => o.studentId === st.id).sort((a, b) => +new Date(b.offeredAt) - +new Date(a.offeredAt)).map((o) => offerView(o, s));
  }),
  /** GET /offers/policies — plain-language policy summary shown to students (read from configured policies). */
  policySummary: () => call('GET', '/offers/policies', () => policies.filter((p) => p.enabled && ['max_offers', 'tier_restriction', 'accepted_offer'].includes(p.kind)).map((p) => ({ id: p.id, name: p.name, description: p.description, params: p.params, scope: p.scope }))),
  /** POST /offers/:id/respond — student responds to an offer; nothing else on the record can change. */
  respond: (id: string, decision: 'accepted' | 'declined') => call('POST', `/offers/${id}/respond`, (s) => {
    const st = requireStudent(s);
    const o = offers.find((x) => x.id === id && x.studentId === st.id) ?? notFound('Offer');
    if (o.status !== 'received') throw new ApiError(409, `This offer is ${o.status} and can no longer be changed.`);
    if (new Date(o.acceptBy) < new Date()) throw new ApiError(409, 'The acceptance deadline has passed. Contact the placement cell.');
    if (decision === 'accepted') {
      const failed = offerPolicyChecks(st, o.companyId, o.id).filter((c) => !c.passed);
      if (failed.length) throw new ApiError(409, `Policy check failed: ${failed.map((f) => f.detail).join(' ')}`);
    }
    o.status = decision;
    syncPlacement(st.id);
    audit(st.name, s.role, `offer.${decision}`, `Offer ${company(o.companyId).name}`);
    return offerView(o, s);
  }),
  /** GET /offers — placement cell. */
  listAll: (q: OfferListQuery = {}) => call('GET', '/offers', (s): OfferList => {
    requirePerm(s, 'offers.manage', 'offers');
    let rows = offers.map((o) => offerView(o, s));
    if (q.status && q.status !== 'all') rows = rows.filter((r) => r.offer.status === q.status);
    if (q.dept) rows = rows.filter((r) => r.student!.departmentId === q.dept);
    if (q.companyId) rows = rows.filter((r) => r.company.id === q.companyId);
    if (q.q) rows = rows.filter((r) => includesCI(r.student!.name, q.q!) || includesCI(r.company.name, q.q!) || includesCI(r.student!.studentCode, q.q!));
    const depts = [...new Set(students.map((x) => x.departmentId))];
    const byDept = depts.map((d) => ({ dept: deptName(d), offers: offers.filter((o) => student(o.studentId).departmentId === d).length, placed: new Set(offers.filter((o) => o.status === 'accepted' && student(o.studentId).departmentId === d).map((o) => o.studentId)).size, students: students.filter((x) => x.departmentId === d).length }));
    const byCompany = companies.map((c) => ({ company: c.name, offers: offers.filter((o) => o.companyId === c.id).length, accepted: offers.filter((o) => o.companyId === c.id && o.status === 'accepted').length })).filter((c) => c.offers);
    const sorted = rows.sort((a, b) => +new Date(b.offer.offeredAt) - +new Date(a.offer.offeredAt));
    const { items, total, page, pageSize } = paginate(sorted, q.page, q.pageSize ?? 10);
    const totals = { offers: offers.length, accepted: offers.filter((o) => o.status === 'accepted').length, placed: new Set(offers.filter((o) => o.status === 'accepted').map((o) => o.studentId)).size };
    return { rows: items, total, page, pageSize, byDept, byCompany, totals, selectedWithoutOffer: applications.filter((a) => a.status === 'selected' && !offers.some((o) => o.applicationId === a.id)).map((a) => appView(a, s)) };
  }),
  /** POST /offers — official offer from a SELECTED application. Policy checks are evaluated and recorded. */
  create: (applicationId: string, ctcLpa: number, acceptBy: string) => call('POST', '/offers', (s) => {
    requirePerm(s, 'offers.manage', 'offer');
    const a = applications.find((x) => x.id === applicationId) ?? notFound('Application');
    if (a.status !== 'selected') throw new ApiError(409, 'Only applications in the Selected stage can receive an offer.');
    if (offers.some((o) => o.applicationId === a.id)) throw new ApiError(409, 'An offer already exists for this application.');
    if (!(ctcLpa > 0)) throw new ApiError(422, 'Enter a valid package.');
    const st = student(a.studentId); const j = job(a.jobId);
    const checks = offerPolicyChecks(st, j.companyId);
    const now = new Date().toISOString();
    const o: Offer = { id: uid('off'), studentId: st.id, jobId: j.id, applicationId: a.id, companyId: j.companyId, ctcLpa, offeredAt: now, acceptBy, status: 'received', policyChecks: checks };
    offers.unshift(o);
    a.status = 'offer_received'; a.updatedAt = now; a.history.push({ status: 'offer_received', at: now, by: s.user.name, note: 'Official offer issued' });
    notify(st.userId, `Offer received — ${company(j.companyId).name}`, `Respond before ${new Date(acceptBy).toLocaleDateString('en-IN')}.`, 'offer', '/student/offers');
    audit(s.user.name, s.role, 'offer.create', `Offer ${company(j.companyId).name} → ${st.studentCode}`);
    return offerView(o, s);
  }),
  /** POST /offers/:id/status — placement cell updates (e.g. withdrawn by company). */
  setStatus: (id: string, status: OfferStatus, reason?: string) => call('POST', `/offers/${id}/status`, (s) => {
    requirePerm(s, 'offers.manage', 'offer');
    const o = offers.find((x) => x.id === id) ?? notFound('Offer');
    if (status === 'accepted') {
      const failed = offerPolicyChecks(student(o.studentId), o.companyId, o.id).filter((c) => !c.passed);
      if (failed.length) throw new ApiError(409, `Policy check failed: ${failed.map((f) => f.detail).join(' ')}`);
    }
    o.status = status;
    syncPlacement(o.studentId);
    notify(student(o.studentId).userId, `Offer update — ${company(o.companyId).name}`, `Your offer is now ${status}.`, 'offer', '/student/offers');
    audit(s.user.name, s.role, `offer.${status}`, `Offer ${company(o.companyId).name} → ${student(o.studentId).studentCode}`, 'success', reason);
    return offerView(o, s);
  }),
};

// ------------------------------------------------------------------ Interviews

const interviewView = (i: Interview, withCandidates: boolean): InterviewView => ({
  interview: i, job: job(i.jobId), company: company(job(i.jobId).companyId),
  candidates: withCandidates ? i.applicationIds.map((id) => applications.find((a) => a.id === id)).filter(Boolean).map((a) => ({ applicationId: a!.id, name: student(a!.studentId).name, studentCode: student(a!.studentId).studentCode, status: a!.status })) : [],
});

export const interviewsApi = {
  /** GET /interviews */
  list: () => call('GET', '/interviews', (s) => {
    if (s.role === 'student') {
      const mine = new Set(applications.filter((a) => a.studentId === s.studentId).map((a) => a.id));
      return interviews.filter((i) => i.applicationIds.some((id) => mine.has(id))).map((i) => interviewView(i, false)).sort((a, b) => +new Date(a.interview.at) - +new Date(b.interview.at));
    }
    requireAny(s, 'applications.review', 'students.view');
    return interviews.map((i) => interviewView(i, true)).sort((a, b) => +new Date(a.interview.at) - +new Date(b.interview.at));
  }),
  /** POST /interviews */
  save: (input: InterviewInput & { id?: string }) => call('POST', '/interviews', (s) => {
    requirePerm(s, 'applications.review', 'interview');
    if (!input.applicationIds.length) throw new ApiError(422, 'Select at least one candidate.');
    if (!input.round.trim() || !input.location.trim()) throw new ApiError(422, 'Round and location/link are required.');
    const ex = input.id ? interviews.find((i) => i.id === input.id) : undefined;
    if (ex) { Object.assign(ex, input, { notified: false }); audit(s.user.name, s.role, 'interview.update', `Interview ${input.round}`); return interviewView(ex, true); }
    const i: Interview = { id: uid('int'), ...input, status: 'scheduled', notified: false };
    interviews.push(i);
    audit(s.user.name, s.role, 'interview.create', `Interview ${input.round} (${job(input.jobId).title})`);
    return interviewView(i, true);
  }),
  /** POST /interviews/:id/status */
  setStatus: (id: string, status: Interview['status']) => call('POST', `/interviews/${id}/status`, (s) => {
    requirePerm(s, 'applications.review', 'interview');
    const i = interviews.find((x) => x.id === id) ?? notFound('Interview');
    i.status = status;
    audit(s.user.name, s.role, `interview.${status}`, `Interview ${i.round}`);
    return interviewView(i, true);
  }),
  /** POST /interviews/:id/notify — sends in-app notifications (email delivery is NOT implemented in this demo). */
  notify: (id: string) => call('POST', `/interviews/${id}/notify`, (s) => {
    requirePerm(s, 'applications.review', 'interview');
    const i = interviews.find((x) => x.id === id) ?? notFound('Interview');
    i.applicationIds.forEach((aid) => {
      const a = applications.find((x) => x.id === aid);
      if (a) notify(student(a.studentId).userId, `Interview scheduled — ${company(job(i.jobId).companyId).name}`, `${i.round} on ${fmt(i.at)} at ${i.location}.`, 'interview', `/student/applications/${a.id}`);
    });
    i.notified = true;
    audit(s.user.name, s.role, 'interview.notify', `Interview ${i.round} (${i.applicationIds.length} students)`);
    return { notified: i.applicationIds.length };
  }),
};
void requireRole;
