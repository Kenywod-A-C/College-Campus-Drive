import type { Page, Role, User } from '@/types';

export interface UserInput { id?: string; name: string; email: string; userCode: string; role: Role; departmentId?: string; status?: User['status'] }
export interface ImportRow { studentCode: string; name: string; email: string; departmentCode: string; graduationYear: string; cgpa?: string }
export interface ImportResult { total: number; imported: number; errors: { row: number; field: string; message: string; value: string }[] }

/** Permission: users.manage. Accounts are created "invited"; no password is ever returned. */
export interface UserService {
  list(q?: { q?: string; role?: Role | 'all'; status?: string; dept?: string; page?: number; pageSize?: number }): Promise<Page<User>>;
  save(input: UserInput): Promise<User>;
  setStatus(id: string, status: 'active' | 'inactive'): Promise<User>;
  resetPassword(id: string): Promise<{ message: string }>;
  importStudents(rows: ImportRow[]): Promise<ImportResult>;
}
