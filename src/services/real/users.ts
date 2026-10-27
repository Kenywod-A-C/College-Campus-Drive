import type { User } from '@/types';
import type { UserService } from '../contracts/users';
import { http } from '../http';

export const userService: UserService = {
  async list(q = {}) {
    const { items, total, page, pageSize } = await http.page<User>('/users', { ...q, role: q.role === 'all' ? undefined : q.role, status: q.status === 'all' ? undefined : q.status });
    return { items, total, page, pageSize };
  },
  // The status of an account is changed only through setStatus; roles only here, by an administrator (the server re-checks every rule).
  save: ({ id, name, email, userCode, role, departmentId }) => {
    const body = { name, email, userCode, role, departmentId: departmentId ? Number(departmentId) : null };
    return id ? http.put<User>(`/users/${encodeURIComponent(id)}`, body) : http.post<User>('/users', body);
  },
  setStatus: (id, status) => http.post<User>(`/users/${encodeURIComponent(id)}/status`, { status }),
  resetPassword: (id) => http.post<{ message: string }>(`/users/${encodeURIComponent(id)}/reset-password`),
  importStudents: (rows) => http.post('/users/import', { rows }),
};
