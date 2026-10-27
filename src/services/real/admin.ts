import type { AuditLog, Course, Department, Permission, PlacementPolicy } from '@/types';
import type { AcademicOverview, AcademicYear, AdminConfigService } from '../contracts/admin';
import { http } from '../http';

const enc = encodeURIComponent;

export const adminConfigService: AdminConfigService = {
  roles: () => http.get('/admin/roles'),
  setPermission: (role, perm, enabled) => http.put<Permission[]>(`/admin/roles/${enc(role)}/permissions/${enc(perm)}`, { enabled }),
  policies: () => http.get<PlacementPolicy[]>('/admin/policies'),
  savePolicy: ({ id, ...body }) => (id ? http.put<PlacementPolicy>(`/admin/policies/${enc(id)}`, body) : http.post<PlacementPolicy>('/admin/policies', body)),
  deletePolicy: (id, reason) => http.delete(`/admin/policies/${enc(id)}`, { reason }),
  academic: () => http.get<AcademicOverview>('/admin/academic'),
  saveDepartment: ({ id, ...body }) => (id ? http.put<Department>(`/admin/departments/${enc(id)}`, body) : http.post<Department>('/admin/departments', body)),
  deleteDepartment: (id) => http.delete(`/admin/departments/${enc(id)}`),
  saveCourse: ({ id, departmentId, ...rest }) => {
    const body = { ...rest, departmentId: Number(departmentId) };
    return id ? http.put<Course>(`/admin/courses/${enc(id)}`, body) : http.post<Course>('/admin/courses', body);
  },
  deleteCourse: (id) => http.delete(`/admin/courses/${enc(id)}`),
  saveAcademicYear: ({ id, ...body }) => (id ? http.put<AcademicYear[]>(`/admin/academic-years/${enc(id)}`, body) : http.post<AcademicYear[]>('/admin/academic-years', body)),
  async auditLogs(q = {}) {
    const { items, total, page, pageSize, meta } = await http.page<AuditLog>('/admin/audit-logs', { ...q, result: q.result === 'all' ? undefined : q.result });
    return { items, total, page, pageSize, actions: (meta.actions as string[] | undefined) ?? [] };
  },
};
