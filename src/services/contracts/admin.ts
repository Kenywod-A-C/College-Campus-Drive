import type { AuditLog, Course, Department, Page, Permission, PlacementPolicy, Role } from '@/types';
import type { PermissionMeta } from '@/auth/permissions';

export interface AcademicYear { id: string; label: string; graduationYear: number; active: boolean }
export interface AcademicOverview {
  departments: (Department & { students: number; courses: number })[];
  courses: Course[];
  academicYears: AcademicYear[];
}
export interface AuditQuery { actor?: string; action?: string; resource?: string; result?: AuditLog['result'] | 'all'; from?: string; to?: string; page?: number; pageSize?: number }

/** Roles & permissions (roles.manage, administrators only), policies (policies.manage), academic configuration (administrators), audit log (audit.view). */
export interface AdminConfigService {
  roles(): Promise<{ permissions: PermissionMeta[]; matrix: Record<Role, Permission[]>; userCounts: Record<Role, number> }>;
  setPermission(role: Role, perm: Permission, enabled: boolean): Promise<Permission[]>;
  policies(): Promise<PlacementPolicy[]>;
  savePolicy(p: Omit<PlacementPolicy, 'updatedAt' | 'updatedBy' | 'id'> & { id?: string }): Promise<PlacementPolicy>;
  deletePolicy(id: string, reason: string): Promise<{ ok: boolean }>;
  academic(): Promise<AcademicOverview>;
  saveDepartment(d: Omit<Department, 'id'> & { id?: string }): Promise<Department>;
  deleteDepartment(id: string): Promise<{ ok: boolean }>;
  saveCourse(c: Omit<Course, 'id'> & { id?: string }): Promise<Course>;
  deleteCourse(id: string): Promise<{ ok: boolean }>;
  /** Returns every academic year; exactly one stays active. */
  saveAcademicYear(y: { id?: string; label: string; graduationYear: number; active: boolean }): Promise<AcademicYear[]>;
  auditLogs(q?: AuditQuery): Promise<Page<AuditLog> & { actions: string[] }>;
}
