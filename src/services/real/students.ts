import type { Student } from '@/types';
import type { StudentDirectoryService, StudentSelfService, StudentDashboard } from '../contracts/students';
import type { StudentDetail, StudentRow } from '@/types/views';
import { http } from '../http';

export const studentService: StudentSelfService = {
  getProfile: () => http.get<Student>('/student/profile'),
  updateProfile: (patch) => http.patch<Student>('/student/profile', patch),
  dashboard: () => http.get<StudentDashboard>('/student/dashboard'),
};

export const studentDirectoryService: StudentDirectoryService = {
  async list(q = {}) {
    const { items, total, page, pageSize } = await http.page<StudentRow>('/students', { ...q });
    return { items, total, page, pageSize };
  },
  get: (id) => http.get<StudentDetail>(`/students/${encodeURIComponent(id)}`),
  verifyCgpa: (id, cgpa) => http.post<StudentRow>(`/students/${encodeURIComponent(id)}/verify-cgpa`, cgpa === undefined ? {} : { cgpa }),
};
