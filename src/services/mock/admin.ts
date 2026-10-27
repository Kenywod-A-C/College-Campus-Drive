import { ApiError, type AuditLog, type Course, type Department, type PlacementPolicy, type Permission, type Role } from '@/types';
import { PERMISSIONS } from '@/auth/permissions';
import { academicYears, applications, audit, auditLogs, companies, courses, departments, jobs, offers, policies, rolePermissions, students, systemSettings, uid, users, documents } from '@/mock/db';
import { call, includesCI, notFound, paginate, requirePerm, requireRole } from './client';

export const adminApi = {
  /** GET /admin/dashboard */
  dashboard: () => call('GET', '/admin/dashboard', (s) => {
    requireRole(s, 'admin');
    const placed = new Set(offers.filter((o) => o.status === 'accepted').map((o) => o.studentId)).size;
    const failedDocs = documents.filter((d) => d.processing === 'failed');
    const inactiveFaculty = users.filter((u) => u.role === 'faculty' && u.status !== 'active');
    const denied = auditLogs.filter((a) => a.result === 'denied').length;
    return {
      metrics: {
        totalUsers: users.length,
        activeStudents: users.filter((u) => u.role === 'student' && u.status === 'active').length,
        facultyAccounts: users.filter((u) => u.role === 'faculty').length,
        companies: companies.length,
        activeJobs: jobs.filter((j) => j.status === 'published').length,
        applications: applications.length,
        offers: offers.length,
      },
      placement: { totalStudents: students.length, placed, pct: Math.round((placed / students.length) * 1000) / 10, accepted: offers.filter((o) => o.status === 'accepted').length, offers: offers.length },
      activity: auditLogs.slice(0, 7),
      alerts: [
        ...failedDocs.map((d) => ({ level: 'error' as const, text: `Document processing failed: ${d.title}`, link: '/admin/documents' })),
        ...inactiveFaculty.map((u) => ({ level: 'warning' as const, text: `${u.name}'s account is ${u.status}`, link: '/admin/users' })),
        ...(denied ? [{ level: 'info' as const, text: `${denied} denied access attempt(s) recorded`, link: '/admin/audit-logs' }] : []),
        ...(students.filter((x) => !x.academic.cgpaVerified).length ? [{ level: 'warning' as const, text: `${students.filter((x) => !x.academic.cgpaVerified).length} student CGPAs await verification`, link: '/admin/students' }] : []),
      ],
    };
  }),

  // ---- Roles & permissions
  /** GET /admin/roles */
  roles: () => call('GET', '/admin/roles', (s) => {
    requirePerm(s, 'roles.manage', 'roles');
    return { permissions: PERMISSIONS, matrix: rolePermissions, userCounts: { admin: users.filter((u) => u.role === 'admin').length, faculty: users.filter((u) => u.role === 'faculty').length, student: users.filter((u) => u.role === 'student').length } };
  }),
  /** PUT /admin/roles/:role/permissions/:perm */
  setPermission: (role: Role, perm: Permission, enabled: boolean) => call('PUT', `/admin/roles/${role}/permissions/${perm}`, (s) => {
    requirePerm(s, 'roles.manage', 'roles');
    if (role === 'student') throw new ApiError(409, 'Student access is limited to their own records and cannot be extended with staff permissions.');
    if (role === 'admin' && !enabled && (perm === 'roles.manage' || perm === 'users.manage')) throw new ApiError(409, 'This permission cannot be removed from Admin: it would lock administrators out.');
    const cur = rolePermissions[role];
    rolePermissions[role] = enabled ? [...new Set([...cur, perm])] : cur.filter((p) => p !== perm);
    audit(s.user.name, s.role, 'role.permissions.update', `Role ${role}`, 'success', `${enabled ? 'Granted' : 'Revoked'} ${perm}`);
    return rolePermissions[role];
  }),

  // ---- Policies
  /** GET /admin/policies */
  policies: () => call('GET', '/admin/policies', (s) => { requirePerm(s, 'policies.manage', 'policies'); return policies; }),
  /** POST /admin/policies */
  savePolicy: (p: Omit<PlacementPolicy, 'updatedAt' | 'updatedBy' | 'id'> & { id?: string }) => call('POST', '/admin/policies', (s) => {
    requirePerm(s, 'policies.manage', 'policy');
    if (!p.name.trim()) throw new ApiError(422, 'Policy name is required.');
    if (p.kind === 'max_offers' && !(Number(p.params.maxAcceptedOffers) >= 1)) throw new ApiError(422, 'Maximum accepted offers must be at least 1.');
    if (p.scope !== 'college' && !p.scopeValue) throw new ApiError(422, 'Choose the department or academic year this policy applies to.');
    const ex = p.id ? policies.find((x) => x.id === p.id) : undefined;
    const meta = { updatedAt: new Date().toISOString(), updatedBy: s.user.name };
    if (ex) { Object.assign(ex, p, meta); audit(s.user.name, s.role, 'policy.update', `Policy ${ex.name}`, 'success', p.enabled ? 'Enabled' : 'Disabled'); return ex; }
    const np: PlacementPolicy = { ...p, id: uid('pol'), ...meta };
    policies.push(np);
    audit(s.user.name, s.role, 'policy.create', `Policy ${np.name}`);
    return np;
  }),
  /** DELETE /admin/policies/:id */
  deletePolicy: (id: string, reason: string) => call('DELETE', `/admin/policies/${id}`, (s) => {
    requirePerm(s, 'policies.manage', 'policy');
    const i = policies.findIndex((p) => p.id === id);
    if (i < 0) notFound('Policy');
    if (!reason.trim()) throw new ApiError(422, 'A reason is required to delete a policy.');
    audit(s.user.name, s.role, 'policy.delete', `Policy ${policies[i].name}`, 'success', reason);
    policies.splice(i, 1);
    return { ok: true };
  }),

  // ---- Departments, courses, academic years
  /** GET /admin/academic */
  academic: () => call('GET', '/admin/academic', (s) => {
    requireRole(s, 'admin');
    return {
      departments: departments.map((d) => ({ ...d, students: students.filter((x) => x.departmentId === d.id).length, courses: courses.filter((c) => c.departmentId === d.id).length })),
      courses, academicYears,
    };
  }),
  saveDepartment: (d: Omit<Department, 'id'> & { id?: string }) => call('POST', '/admin/departments', (s) => {
    requireRole(s, 'admin');
    if (!d.code.trim() || !d.name.trim()) throw new ApiError(422, 'Code and name are required.');
    if (departments.some((x) => x.code.toLowerCase() === d.code.toLowerCase() && x.id !== d.id)) throw new ApiError(409, 'Department code already exists.');
    const ex = d.id ? departments.find((x) => x.id === d.id) : undefined;
    if (ex) { Object.assign(ex, d); audit(s.user.name, s.role, 'department.update', `Department ${ex.code}`); return ex; }
    const nd: Department = { ...d, id: `d_${d.code.toLowerCase().replace(/\W/g, '')}` };
    departments.push(nd);
    audit(s.user.name, s.role, 'department.create', `Department ${nd.code}`);
    return nd;
  }),
  deleteDepartment: (id: string) => call('DELETE', `/admin/departments/${id}`, (s) => {
    requireRole(s, 'admin');
    if (students.some((x) => x.departmentId === id) || courses.some((c) => c.departmentId === id)) throw new ApiError(409, 'This department has students or courses attached and cannot be deleted. Deactivate or move them first.');
    const i = departments.findIndex((d) => d.id === id);
    if (i < 0) notFound('Department');
    audit(s.user.name, s.role, 'department.delete', `Department ${departments[i].code}`);
    departments.splice(i, 1);
    return { ok: true };
  }),
  saveCourse: (c: Omit<Course, 'id'> & { id?: string }) => call('POST', '/admin/courses', (s) => {
    requireRole(s, 'admin');
    if (!c.code.trim() || !c.name.trim()) throw new ApiError(422, 'Code and name are required.');
    const ex = c.id ? courses.find((x) => x.id === c.id) : undefined;
    if (ex) { Object.assign(ex, c); audit(s.user.name, s.role, 'course.update', `Course ${ex.code}`); return ex; }
    const nc: Course = { ...c, id: uid('c') };
    courses.push(nc);
    audit(s.user.name, s.role, 'course.create', `Course ${nc.code}`);
    return nc;
  }),
  deleteCourse: (id: string) => call('DELETE', `/admin/courses/${id}`, (s) => {
    requireRole(s, 'admin');
    const i = courses.findIndex((c) => c.id === id);
    if (i < 0) notFound('Course');
    audit(s.user.name, s.role, 'course.delete', `Course ${courses[i].code}`);
    courses.splice(i, 1);
    return { ok: true };
  }),
  saveAcademicYear: (y: { id?: string; label: string; graduationYear: number; active: boolean }) => call('POST', '/admin/academic-years', (s) => {
    requireRole(s, 'admin');
    if (!/^\d{4}-\d{2}$/.test(y.label)) throw new ApiError(422, 'Label must look like 2026-27.');
    const ex = y.id ? academicYears.find((a) => a.id === y.id) : undefined;
    if (y.active) academicYears.forEach((a) => (a.active = false));
    if (ex) Object.assign(ex, y); else academicYears.push({ id: uid('ay'), label: y.label, graduationYear: y.graduationYear, active: y.active });
    audit(s.user.name, s.role, ex ? 'academic_year.update' : 'academic_year.create', `Academic year ${y.label}`);
    return academicYears;
  }),

  // ---- Audit logs (read-only: there is deliberately no update/delete endpoint)
  /** GET /admin/audit-logs */
  auditLogs: (q: { actor?: string; action?: string; resource?: string; result?: AuditLog['result'] | 'all'; from?: string; to?: string; page?: number; pageSize?: number } = {}) => call('GET', '/admin/audit-logs', (s) => {
    requirePerm(s, 'audit.view', 'audit logs');
    let rows = [...auditLogs];
    if (q.actor) rows = rows.filter((r) => includesCI(r.actor, q.actor!));
    if (q.action) rows = rows.filter((r) => includesCI(r.action, q.action!));
    if (q.resource) rows = rows.filter((r) => includesCI(r.resource, q.resource!));
    if (q.result && q.result !== 'all') rows = rows.filter((r) => r.result === q.result);
    if (q.from) rows = rows.filter((r) => r.at >= new Date(q.from!).toISOString());
    if (q.to) rows = rows.filter((r) => r.at <= new Date(new Date(q.to!).getTime() + 86400000).toISOString());
    rows.sort((a, b) => +new Date(b.at) - +new Date(a.at));
    return { ...paginate(rows, q.page, q.pageSize ?? 12), actions: [...new Set(auditLogs.map((a) => a.action.split('.')[0]))].sort() };
  }),

  // ---- System settings
  /** GET /admin/settings — secrets are never returned: only configuration *status*. */
  settings: () => call('GET', '/admin/settings', (s) => { requireRole(s, 'admin'); return systemSettings; }),
  saveSettings: (patch: Partial<Pick<typeof systemSettings, 'collegeName' | 'collegeEmail' | 'academicYear' | 'placementSeason' | 'notifyEmailEnabled' | 'notifyDigestHour' | 'maintenanceBanner' | 'sessionTimeoutMins'>>) => call('PUT', '/admin/settings', (s) => {
    requireRole(s, 'admin');
    if (patch.collegeName !== undefined && !patch.collegeName.trim()) throw new ApiError(422, 'College name is required.');
    Object.assign(systemSettings, patch);
    audit(s.user.name, s.role, 'settings.update', 'System settings');
    return systemSettings;
  }),
};
