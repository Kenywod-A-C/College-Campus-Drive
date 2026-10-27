import { ApiError, type DocumentRecord, type DocumentType, type NotificationPrefs, type Reminder } from '@/types';
import { audit, companies, defaultPrefs, documents, jobs, notifications, prefs, reminders, uid } from '@/mock/db';
import type { ReminderInput } from '../contracts/notifications';
import { call, includesCI, notFound, requirePerm, requireStudent, type Session } from './client';

// ------------------------------------------------------------------ Documents
const canSee = (d: DocumentRecord, s: Session) => {
  if (s.role === 'admin') return true;
  if (s.role === 'student') return d.ownerStudentId ? d.ownerStudentId === s.studentId : d.access.includes('student');
  return d.access.includes('faculty') && (!d.ownerStudentId || s.permissions.includes('students.view'));
};

export interface UploadInput { title: string; type: DocumentType; fileName: string; fileSizeKb: number; mime: string; companyId?: string; jobId?: string; studentVisible?: boolean }

function validateFile(type: DocumentType, f: { fileName: string; fileSizeKb: number; mime: string }) {
  const personal = type === 'resume' || type === 'certificate';
  const ok = f.mime === 'application/pdf' || (personal && /officedocument.wordprocessingml|msword/.test(f.mime));
  if (!ok) throw new ApiError(422, personal ? 'Only PDF or Word files are accepted.' : 'Only PDF files are accepted for circulars, brochures and eligibility documents.');
  if (f.fileSizeKb > 5 * 1024) throw new ApiError(422, 'File is larger than the 5 MB limit.');
  if (/[\\/]|\.\./.test(f.fileName)) throw new ApiError(422, 'Invalid file name.');
}
// Simulated async text extraction / indexing pipeline (stand-in for the Celery worker + chunker).
function simulateProcessing(d: DocumentRecord) {
  if (d.type === 'resume' || d.type === 'certificate') { d.processing = 'indexed'; return; }
  d.processing = 'queued';
  setTimeout(() => { d.processing = 'processing'; }, 1500);
  setTimeout(() => {
    d.processing = 'indexed';
    d.pages = d.pages ?? 2;
    d.extractedExcerpts = [{ page: 1, text: `Extracted text preview for "${d.title}". (Demo: no real document parsing is performed.)` }];
  }, 4500);
}

export const documentsApi = {
  /** GET /documents */
  list: (q: { q?: string; type?: DocumentType | 'all'; companyId?: string } = {}) => call('GET', '/documents', (s) => {
    let rows = documents.filter((d) => canSee(d, s));
    if (q.type && q.type !== 'all') rows = rows.filter((d) => d.type === q.type);
    if (q.companyId) rows = rows.filter((d) => d.companyId === q.companyId);
    if (q.q) rows = rows.filter((d) => includesCI(d.title, q.q!));
    return rows.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt)).map((d) => ({
      doc: d, companyName: companies.find((c) => c.id === d.companyId)?.name, jobTitle: jobs.find((j) => j.id === d.jobId)?.title,
      canManage: s.role === 'student' ? d.ownerStudentId === s.studentId : s.permissions.includes('documents.upload'),
    }));
  }),
  /** GET /documents/:id — includes extracted text and page references. */
  get: (id: string) => call('GET', `/documents/${id}`, (s) => {
    const d = documents.find((x) => x.id === id) ?? notFound('Document');
    if (!canSee(d, s)) { audit(s.user.name, s.role, 'document.read', `Document ${id}`, 'denied', 'Not authorised'); throw new ApiError(403, 'You do not have access to this document.'); }
    return d;
  }),
  /** POST /documents */
  upload: (input: UploadInput) => call('POST', '/documents', (s) => {
    const personal = input.type === 'resume' || input.type === 'certificate';
    if (s.role === 'student') { if (!personal) throw new ApiError(403, 'Students can only upload resumes and certificates.'); requireStudent(s); }
    else requirePerm(s, 'documents.upload', 'document');
    if (!input.title.trim()) throw new ApiError(422, 'Title is required.');
    validateFile(input.type, input);
    const d: DocumentRecord = {
      id: uid('doc'), title: input.title, type: input.type, uploadedAt: new Date().toISOString(), uploadedBy: s.user.name,
      ownerStudentId: s.role === 'student' ? s.studentId : undefined, companyId: input.companyId, jobId: input.jobId,
      access: s.role === 'student' ? ['student', 'faculty', 'admin'] : input.studentVisible === false ? ['faculty', 'admin'] : ['student', 'faculty', 'admin'],
      sizeKb: input.fileSizeKb, processing: 'queued', version: 1,
    };
    documents.unshift(d);
    simulateProcessing(d);
    audit(s.user.name, s.role, 'document.upload', `Document ${d.title}`);
    return d;
  }),
  /** POST /documents/:id/replace — bumps the version, keeps the same record. */
  replace: (id: string, f: { fileName: string; fileSizeKb: number; mime: string }) => call('POST', `/documents/${id}/replace`, (s) => {
    const d = documents.find((x) => x.id === id) ?? notFound('Document');
    if (s.role === 'student' ? d.ownerStudentId !== s.studentId : false) throw new ApiError(403, 'You can only replace your own documents.');
    if (s.role !== 'student') requirePerm(s, 'documents.upload', 'document');
    validateFile(d.type, f);
    d.version += 1; d.sizeKb = f.fileSizeKb; d.uploadedAt = new Date().toISOString(); d.uploadedBy = s.user.name; d.extractedExcerpts = undefined;
    simulateProcessing(d);
    audit(s.user.name, s.role, 'document.replace', `Document ${d.title} v${d.version}`);
    return d;
  }),
  /** POST /documents/:id/reprocess */
  reprocess: (id: string) => call('POST', `/documents/${id}/reprocess`, (s) => {
    requirePerm(s, 'documents.upload', 'document');
    const d = documents.find((x) => x.id === id) ?? notFound('Document');
    simulateProcessing(d);
    return d;
  }),
  /** DELETE /documents/:id */
  remove: (id: string) => call('DELETE', `/documents/${id}`, (s) => {
    const i = documents.findIndex((x) => x.id === id);
    if (i < 0) notFound('Document');
    const d = documents[i];
    if (s.role === 'student' ? d.ownerStudentId !== s.studentId : false) throw new ApiError(403, 'You can only delete your own documents.');
    if (s.role !== 'student') requirePerm(s, 'documents.upload', 'document');
    documents.splice(i, 1);
    audit(s.user.name, s.role, 'document.delete', `Document ${d.title}`);
    return { ok: true };
  }),
};

// ------------------------------------------------------------------ Reminders
export const remindersApi = {
  /** GET /reminders */
  list: () => call('GET', '/reminders', (s) => {
    const st = requireStudent(s);
    return reminders.filter((r) => r.studentId === st.id).sort((a, b) => +new Date(a.at) - +new Date(b.at)).map((r) => ({ reminder: r, jobTitle: jobs.find((j) => j.id === r.jobId)?.title, companyName: companies.find((c) => c.id === jobs.find((j) => j.id === r.jobId)?.companyId)?.name }));
  }),
  /** POST /reminders, PUT /reminders/:id */
  save: (input: ReminderInput) => call('POST', input.id ? `/reminders/${input.id}` : '/reminders', (s) => {
    const st = requireStudent(s);
    if (!input.title.trim()) throw new ApiError(422, 'Describe what you want to be reminded about.');
    if (isNaN(+new Date(input.at))) throw new ApiError(422, 'Choose a valid date and time.');
    const ex = input.id ? reminders.find((r) => r.id === input.id && r.studentId === st.id) : undefined;
    if (input.id && !ex) notFound('Reminder');
    if (ex) { Object.assign(ex, { title: input.title, at: input.at, jobId: input.jobId || undefined, kind: input.jobId ? ex.kind === 'custom' ? 'drive' : ex.kind : 'custom' }); return ex; }
    const r: Reminder = { id: uid('rem'), studentId: st.id, title: input.title, at: input.at, jobId: input.jobId || undefined, kind: input.kind ?? (input.jobId ? 'drive' : 'custom'), done: false };
    reminders.push(r);
    return r;
  }),
  /** POST /reminders/:id/toggle */
  toggle: (id: string) => call('POST', `/reminders/${id}/toggle`, (s) => {
    const st = requireStudent(s);
    const r = reminders.find((x) => x.id === id && x.studentId === st.id) ?? notFound('Reminder');
    r.done = !r.done;
    return r;
  }),
  /** DELETE /reminders/:id */
  remove: (id: string) => call('DELETE', `/reminders/${id}`, (s) => {
    const st = requireStudent(s);
    const i = reminders.findIndex((x) => x.id === id && x.studentId === st.id);
    if (i < 0) notFound('Reminder');
    reminders.splice(i, 1);
    return { ok: true };
  }),
};

// ------------------------------------------------------------------ Notifications
export const notificationsApi = {
  /** GET /notifications */
  list: () => call('GET', '/notifications', (s) => notifications.filter((n) => n.userId === s.user.id).sort((a, b) => +new Date(b.at) - +new Date(a.at))),
  /** POST /notifications/:id/read */
  markRead: (id: string) => call('POST', `/notifications/${id}/read`, (s) => {
    const n = notifications.find((x) => x.id === id && x.userId === s.user.id) ?? notFound('Notification');
    n.read = true;
    return n;
  }, { delay: 40 }),
  /** POST /notifications/read-all */
  markAllRead: () => call('POST', '/notifications/read-all', (s) => { notifications.filter((n) => n.userId === s.user.id).forEach((n) => (n.read = true)); return { ok: true }; }, { delay: 40 }),
  /** GET /notifications/preferences */
  getPrefs: () => call('GET', '/notifications/preferences', (s) => (prefs[s.user.id] ??= defaultPrefs())),
  /** PUT /notifications/preferences */
  setPrefs: (p: NotificationPrefs) => call('PUT', '/notifications/preferences', (s) => { prefs[s.user.id] = p; return p; }),
};
