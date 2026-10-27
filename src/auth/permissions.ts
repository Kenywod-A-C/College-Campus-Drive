import type { Permission, Role } from '@/types';

export const ROLE_HOME: Record<Role, string> = {
  student: '/student/dashboard',
  faculty: '/faculty/dashboard',
  admin: '/admin/dashboard',
};

export const ROLE_LABEL: Record<Role, string> = { student: 'Student', faculty: 'Faculty / Placement Officer', admin: 'Administrator' };

export interface PermissionMeta {
  key: Permission;
  module: string;
  label: string;
  description: string;
}

export const PERMISSIONS: PermissionMeta[] = [
  { key: 'students.view', module: 'Students', label: 'View student records', description: 'See placement profiles, applications and offers of students in scope. Sensitive personal data stays hidden.' },
  { key: 'students.edit', module: 'Students', label: 'Edit student records', description: 'Verify CGPA and update academic records. Students cannot do this themselves.' },
  { key: 'companies.manage', module: 'Placements', label: 'Manage companies', description: 'Create and edit company master records.' },
  { key: 'jobs.create', module: 'Placements', label: 'Create jobs', description: 'Create and edit job postings and eligibility rules.' },
  { key: 'drives.publish', module: 'Placements', label: 'Publish drives', description: 'Publish, close or cancel jobs and hiring drives.' },
  { key: 'applications.review', module: 'Placements', label: 'Review applications', description: 'Shortlist applicants, update stages and record eligibility exceptions.' },
  { key: 'offers.manage', module: 'Placements', label: 'Manage offers', description: 'Create and update official offer records.' },
  { key: 'documents.upload', module: 'Documents', label: 'Upload documents', description: 'Upload circulars, brochures and eligibility documents.' },
  { key: 'reports.view', module: 'Reports', label: 'View reports', description: 'Access placement analytics and CSV exports.' },
  { key: 'users.manage', module: 'Administration', label: 'Manage users', description: 'Create users, assign roles, reset passwords and import students.' },
  { key: 'roles.manage', module: 'Administration', label: 'Manage roles & permissions', description: 'Change the role-permission matrix.' },
  { key: 'policies.manage', module: 'Administration', label: 'Manage placement policies', description: 'Configure offer limits and exception rules.' },
  { key: 'audit.view', module: 'Administration', label: 'View audit logs', description: 'Read the immutable audit trail.' },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: PERMISSIONS.map((p) => p.key),
  faculty: ['students.view', 'students.edit', 'companies.manage', 'jobs.create', 'drives.publish', 'applications.review', 'offers.manage', 'documents.upload', 'reports.view'],
  student: [],
};
